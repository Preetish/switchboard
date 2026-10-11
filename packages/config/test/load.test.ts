import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const readFile = (file: string) => readFileSync(file, "utf8");

function load(yaml: string, files: Record<string, string> = {}) {
  return loadConfig(yaml, "/cfg/switchboard.yaml", (file) => {
    const content = files[file];
    if (content === undefined) throw new Error("ENOENT");
    return content;
  });
}

const MINIMAL = `
org: { name: Acme, slug: acme }
reps:
  - { email: Ana@Acme.com, name: Ana, timezone: Europe/Paris, workingHours: { days: [mon, fri], hours: "08:30-16:00" } }
teams:
  - key: sales
    members: [ana@acme.com]
forms:
  - slug: demo
    name: Demo
    fields:
      - { key: email, label: Email, type: email, required: true }
      - { key: country, label: Country, type: select, required: true, options: [DE, US] }
    rules: rules/demo.yaml
`;

const RULES = `
rules:
  - name: Germany
    when: { form.country: DE, form.email_domain: { nin: [gmail.com] } }
    route: { team: sales, strategy: round_robin }
fallback: { team: sales, strategy: round_robin }
`;

describe("loadConfig", () => {
  it("builds a plan: lowercased emails, parsed working hours, rule files resolved relative to the config", () => {
    const result = load(MINIMAL, { "/cfg/rules/demo.yaml": RULES });
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.plan.reps[0]).toEqual({
      email: "ana@acme.com",
      name: "Ana",
      timezone: "Europe/Paris",
      workingHours: { days: [1, 5], startMinute: 510, endMinute: 960 },
    });
    expect(result.plan.teams[0]).toEqual({
      key: "sales",
      name: "sales",
      members: [{ rep: "ana@acme.com", weight: 1, weeklyCapacity: 0, active: true }],
    });
    expect(result.plan.forms[0]!.ruleSet?.rules[0]?.name).toBe("Germany");
  });

  it("accepts inline rules and warns when a form has none", () => {
    const inline = MINIMAL.replace(
      "rules: rules/demo.yaml",
      "rules: { rules: [], fallback: { action: fallback_queue } }",
    );
    expect(load(inline).ok).toBe(true);
    const none = MINIMAL.replace("    rules: rules/demo.yaml\n", "");
    const result = load(none);
    expect(result.ok && result.warnings.join()).toMatch(/no rules/);
  });

  it("reports a missing rule file with where to look", () => {
    const result = load(MINIMAL);
    expect(!result.ok && result.errors.join()).toMatch(/rules\/demo\.yaml.*file not found/);
  });

  it("collects every cross-reference problem at once", () => {
    const broken = `
org: { name: Acme, slug: acme }
reps:
  - { email: ana@acme.com, name: Ana, timezone: Nowhere/City }
teams:
  - { key: sales, members: [ana@acme.com, ghost@acme.com] }
forms:
  - slug: demo
    name: Demo
    fields: [{ key: email, label: Email, type: email, required: true }]
    rules:
      rules:
        - { name: Size, when: { form.size: { gte: 10 } }, route: { team: enterprise, strategy: round_robin } }
      fallback: { to: nobody@acme.com }
`;
    const result = load(broken);
    if (result.ok) throw new Error("expected errors");
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/timezone: "Nowhere\/City" is not an IANA zone/),
        expect.stringMatching(/ghost@acme\.com is not in reps/),
        expect.stringMatching(/form\.size is not a field of this form/),
        expect.stringMatching(/team "enterprise" is not defined in teams/),
        expect.stringMatching(/fallback: nobody@acme\.com is not in reps/),
      ]),
    );
  });

  it("rejects working hours that end before they start", () => {
    const result = load(
      MINIMAL.replace('hours: "08:30-16:00"', 'hours: "18:00-09:00"'),
      { "/cfg/rules/demo.yaml": RULES },
    );
    expect(!result.ok && result.errors.join()).toMatch(/end must be after the start/);
  });

  it("validates the shipped demo and starter configs", () => {
    for (const file of ["examples/switchboard.demo.yaml", "switchboard.example.yaml"]) {
      const absolute = path.join(repoRoot, file);
      const result = loadConfig(readFile(absolute), absolute, readFile);
      expect(result.ok ? "ok" : result.errors).toBe("ok");
    }
  });
});

describe("attribution in config", () => {
  const withRules = (rules: string, extra = "") =>
    MINIMAL.replace("    rules: rules/demo.yaml", `    rules:\n${rules}`) + extra;

  it("accepts rules on attribution fields and a HubSpot property map", () => {
    const result = load(
      withRules(
        `      rules:
        - { name: Paid, when: { attribution.utm_medium: cpc, attribution.first.utm_source: google }, route: { team: sales, strategy: round_robin } }
      fallback: { team: sales, strategy: round_robin }`,
        `hubspot:
  properties: { utm_source: utm_source, first.utm_campaign: first_campaign, cookies.ga: ga_client_id }
`,
      ),
    );
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.plan.org.settings).toEqual({
      hubspotProperties: { utm_source: "utm_source", "first.utm_campaign": "first_campaign", "cookies.ga": "ga_client_id" },
    });
  });

  it("rejects unknown attribution fields in rules and in the HubSpot map", () => {
    const result = load(
      withRules(
        `      rules:
        - { name: Typo, when: { attribution.utm_sauce: google }, route: { team: sales, strategy: round_robin } }
      fallback: { team: sales, strategy: round_robin }`,
        `hubspot:
  properties: { email: email_prop }
`,
      ),
    );
    if (result.ok) throw new Error("expected errors");
    const text = result.errors.join("\n");
    expect(text).toMatch(/attribution\.utm_sauce isn't an attribution field/);
    expect(text).toMatch(/hubspot\.properties\.email: not an attribution field/);
  });

  it("rejects HubSpot property names HubSpot wouldn't accept", () => {
    const result = load(MINIMAL + 'hubspot:\n  properties: { utm_source: "Not Valid" }\n', {
      "/cfg/rules/demo.yaml": RULES,
    });
    expect(!result.ok && result.errors.join()).toMatch(/HubSpot property names are lowercase/);
  });
});

describe("themes in config", () => {
  it("stores the org theme and per-form overrides and custom CSS", () => {
    const yaml = MINIMAL.replace(
      "    rules: rules/demo.yaml",
      '    rules: rules/demo.yaml\n    theme: { accent: "#e4002b", layout: plain }\n    customCss: ".sb-title { font-weight: 600 }"',
    ) + 'theme: { accent: "#0b5fff", radius: 4, font: { family: "Inter, sans-serif" } }\n';
    const result = load(yaml, { "/cfg/rules/demo.yaml": RULES });
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.plan.org.settings.theme).toEqual({ accent: "#0B5FFF", radius: 4, font: { family: "Inter, sans-serif" } });
    expect(result.plan.forms[0]!.settings).toMatchObject({
      theme: { accent: "#E4002B", layout: "plain" },
      customCss: ".sb-title { font-weight: 600 }",
    });
  });

  it("reports theme and custom CSS problems with their location", () => {
    const yaml = MINIMAL.replace(
      "    rules: rules/demo.yaml",
      '    rules: rules/demo.yaml\n    theme: { accent: blue }\n    customCss: "@import url(https://x)"',
    ) + "theme: { radius: 99 }\n";
    const result = load(yaml, { "/cfg/rules/demo.yaml": RULES });
    if (result.ok) throw new Error("expected errors");
    const text = result.errors.join("\n");
    expect(text).toMatch(/forms\[0\] \(demo\) theme\.accent: use a hex color/);
    expect(text).toMatch(/forms\[0\] \(demo\) customCss: @import, url\(\)/);
    expect(text).toMatch(/theme\.radius: a whole number of pixels/);
  });
});

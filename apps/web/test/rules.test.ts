import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadConfig,
  loadConfigObject,
  toConfigObject,
  type ConfigInput,
} from "@switchboard/config";
import type { FormField, WhenClause } from "@switchboard/core";
import { describe, expect, it } from "vitest";
import { buildConfig, draftsFromConfig } from "../src/app/setup/reps-teams";
import {
  ANY_LEAD,
  CRM_OWNER,
  EMAIL_TYPE,
  buildRulesConfig,
  changeSource,
  move,
  newRule,
  placeRuleErrors,
  routeFromKey,
  routeKey,
  routeOptions,
  ruleWarnings,
  rulesDraftsFromConfig,
  sentenceFromWhen,
  sourcesFor,
  whenFromSentence,
  type FormRulesDraft,
  type RuleDraft,
} from "../src/app/setup/rules";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const FIELDS: FormField[] = [
  { key: "email", label: "Work email", type: "email", required: true },
  { key: "company_size", label: "Company size", type: "number", required: true },
  {
    key: "country",
    label: "Country",
    type: "select",
    required: true,
    options: ["Germany", "Austria", "US"],
  },
];

const BASE: ConfigInput = {
  org: { name: "Acme", slug: "acme" },
  reps: [
    { email: "ana@acme.com", name: "Ana", timezone: "UTC" },
    { email: "ben@acme.com", name: "Ben", timezone: "UTC" },
  ],
  teams: [{ key: "sales", name: "Sales", members: ["ana@acme.com", "ben@acme.com"] }],
  forms: [
    {
      slug: "demo",
      name: "Demo",
      fields: FIELDS,
      rules: {
        rules: [
          {
            name: "Owner",
            when: { [CRM_OWNER]: { exists: true } },
            route: { to: CRM_OWNER },
          },
          {
            name: "Personal",
            when: { "form.email": { freeEmail: true } },
            route: { action: "self_serve_link", message: "Sign up" },
          },
          {
            name: "Big",
            when: { "form.company_size": { gte: 500 } },
            route: { team: "sales", strategy: "existing_owner" },
          },
          {
            name: "DACH",
            when: { "form.country": { in: ["Germany", "Austria"] } },
            route: { to: "ben@acme.com" },
          },
          {
            name: "Paid",
            when: { "attribution.utm_medium": { eq: "cpc" } },
            route: { action: "fallback_queue" },
          },
          {
            name: "Regex",
            when: { "form.country": { matches: "^G" } },
            route: { team: "sales", strategy: "round_robin" },
          },
          {
            name: "Everyone else",
            when: {},
            route: { team: "sales", strategy: "round_robin" },
          },
        ],
        fallback: { team: "sales", strategy: "round_robin" },
      },
    },
    { slug: "contact", name: "Contact", fields: [FIELDS[0]!] },
  ],
};

const loaded = (config: ConfigInput) => {
  const result = loadConfigObject(JSON.parse(JSON.stringify(config)));
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.plan;
};

const draftsOf = (config: ConfigInput) =>
  rulesDraftsFromConfig(config) as FormRulesDraft[];

describe("rule sentences", () => {
  it("reads each simple rule as a sentence and keeps the rest advanced", () => {
    const [demo] = draftsOf(BASE);
    expect(demo!.rules.map((rule) => rule.when)).toEqual([
      { source: CRM_OWNER, operator: "exists", value: "" },
      { source: EMAIL_TYPE, operator: "is", value: "free" },
      { source: "form.company_size", operator: "at_least", value: "500" },
      { source: "form.country", operator: "any_of", value: "Germany, Austria" },
      { source: "attribution.utm_medium", operator: "is", value: "cpc" },
      { advanced: { "form.country": { matches: "^G" } } },
      { source: ANY_LEAD, operator: "is", value: "" },
    ]);
  });

  it("round trips every rule row through the config object unchanged", () => {
    const config = buildRulesConfig(BASE, draftsOf(BASE));
    expect(config).toEqual(BASE);
    expect(loadConfigObject(config).ok).toBe(true);
  });

  it("keeps rules the sentence can't say exactly as advanced", () => {
    const advanced: WhenClause[] = [
      { "form.country": "Germany" }, // bare shorthand
      { "form.country": { eq: "Germany" }, "form.company_size": { gte: 5 } }, // two conditions
      { "form.company_size": { eq: "500" } }, // a number field compared as text
      { "form.country": { in: ["A, B"] } }, // a value with a comma
      { "form.country": { neq: "US" } },
      { "form.email_domain": { freeEmail: true } }, // not the email field
      { "attribution.referrer": { exists: true } }, // not a UTM or click field
      { "crm.contact.id": { exists: true } },
    ];
    for (const when of advanced) {
      expect(sentenceFromWhen(when, FIELDS)).toBeNull();
    }
  });

  it("builds numbers for number fields and text for the rest", () => {
    expect(
      whenFromSentence(
        { source: "form.company_size", operator: "any_of", value: "10, 20 ," },
        FIELDS,
      ),
    ).toEqual({
      "form.company_size": { in: [10, 20] },
    });
    expect(
      whenFromSentence(
        { source: "form.country", operator: "is", value: " 500 " },
        FIELDS,
      ),
    ).toEqual({
      "form.country": { eq: "500" },
    });
    expect(
      whenFromSentence({ source: EMAIL_TYPE, operator: "is", value: "work" }, FIELDS),
    ).toEqual({
      "form.email": { workEmail: true },
    });
    expect(
      whenFromSentence(
        { source: CRM_OWNER, operator: "is", value: "ana@acme.com" },
        FIELDS,
      ),
    ).toEqual({
      [CRM_OWNER]: { eq: "ana@acme.com" },
    });
  });

  it("offers the engine's inputs with operators per source", () => {
    const sources = sourcesFor(FIELDS);
    const byId = new Map(sources.map((source) => [source.id, source]));
    expect(byId.get("form.company_size")?.operators).toEqual([
      "is",
      "any_of",
      "at_least",
      "exists",
    ]);
    expect(byId.get("form.country")?.operators).toEqual([
      "is",
      "any_of",
      "contains",
      "exists",
    ]);
    expect(byId.get(CRM_OWNER)?.operators).toEqual(["exists", "is"]);
    expect(byId.has("form.email_domain")).toBe(true);
    expect(byId.has("attribution.gclid")).toBe(true);
    expect(byId.has("attribution.first.utm_source")).toBe(true);
    expect(byId.has("attribution.referrer")).toBe(false);
    // No email field: no email domain and no free/work email.
    const noEmail = sourcesFor([FIELDS[1]!]).map((source) => source.id);
    expect(noEmail).not.toContain("form.email_domain");
    expect(noEmail).not.toContain(EMAIL_TYPE);
  });

  it("keeps the value when switching between fields", () => {
    const sources = new Map(sourcesFor(FIELDS).map((source) => [source.id, source]));
    const sentence = {
      source: "form.country",
      operator: "contains" as const,
      value: "Ger",
    };
    expect(changeSource(sentence, sources.get("form.company_size")!)).toEqual({
      source: "form.company_size",
      operator: "is",
      value: "Ger",
    });
    expect(changeSource(sentence, sources.get(CRM_OWNER)!)).toEqual({
      source: CRM_OWNER,
      operator: "exists",
      value: "",
    });
  });
});

describe("saving rules", () => {
  it("gives back the same config, and the same plan, when nothing was edited", () => {
    const demo = readFileSync(
      path.join(repoRoot, "examples/switchboard.demo.yaml"),
      "utf8",
    );
    const result = loadConfig(
      demo,
      path.join(repoRoot, "examples/switchboard.demo.yaml"),
      (file) => readFileSync(file, "utf8"),
    );
    if (!result.ok) throw new Error(result.errors.join("\n"));
    const base = toConfigObject(result.plan);
    const { reps, teams } = draftsFromConfig(base);

    const saved = buildRulesConfig(
      buildConfig(base, reps, teams),
      rulesDraftsFromConfig(base),
    );
    expect(buildRulesConfig(base, rulesDraftsFromConfig(base))).toEqual(base);
    expect(loaded(saved)).toEqual(result.plan);
  });

  it("leaves a form without rules without a rule set", () => {
    const config = buildRulesConfig(BASE, draftsOf(BASE));
    expect(config.forms[1]).not.toHaveProperty("rules");
  });

  it("writes edits, new rules, and the order shown", () => {
    const drafts = draftsOf(BASE);
    const demo = drafts[0]!;
    const added = newRule("new-1", demo, ["sales"]);
    added.when = { source: "form.country", operator: "is", value: "US" };
    demo.rules = move([...demo.rules.slice(0, 4), added], 4, 0);
    demo.fallback = routeFromKey("queue", demo.fallback);
    drafts[1]!.rules = [
      {
        ...newRule("new-2", drafts[1]!, []),
        when: { source: "form.email_domain", operator: "contains", value: "acme" },
      },
    ];

    const config = buildRulesConfig(BASE, drafts);
    expect(config.forms[0]!.rules).toEqual({
      rules: [
        {
          name: "New rule",
          when: { "form.country": { eq: "US" } },
          route: { team: "sales", strategy: "round_robin" },
        },
        ...(BASE.forms[0]!.rules as { rules: unknown[] }).rules.slice(0, 4),
      ],
      fallback: { action: "fallback_queue" },
    });
    expect(config.forms[1]!.rules).toEqual({
      rules: [
        {
          name: "New rule",
          when: { "form.email_domain": { contains: "acme" } },
          route: { action: "fallback_queue" },
        },
      ],
      fallback: { action: "fallback_queue" },
    });
    expect(loadConfigObject(config).ok).toBe(true);
  });

  it("names new rules uniquely", () => {
    const demo = draftsOf(BASE)[1]!;
    demo.rules.push(newRule("a", demo, []));
    expect(newRule("b", demo, []).name).toBe("New rule 2");
  });
});

describe("ruleWarnings", () => {
  const rule = (id: string, when: RuleDraft["when"]): RuleDraft => ({
    id,
    name: id,
    when,
    route: { action: "fallback_queue" },
  });

  it("flags rules below a rule that matches every lead, like the validator", () => {
    const rules = [
      rule("a", { source: "form.country", operator: "is", value: "US" }),
      rule("all", { source: ANY_LEAD, operator: "is", value: "" }),
      rule("b", { source: "form.country", operator: "exists", value: "" }),
      rule("c", { advanced: { "form.country": { matches: "^G" } } }),
    ];
    const warnings = ruleWarnings(rules);
    expect([...warnings.keys()]).toEqual(["b", "c"]);
    expect(warnings.get("b")).toMatch(/never runs: "all" above it matches every lead/);

    const drafts = draftsOf(BASE);
    drafts[0]!.rules = rules;
    const result = loadConfigObject(buildRulesConfig(BASE, drafts));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toMatch(/rules\.2: unreachable/);
  });

  it("flags a value left empty or a non-number to compare", () => {
    expect(
      ruleWarnings([
        rule("a", { source: "form.country", operator: "is", value: " " }),
      ]).get("a"),
    ).toMatch(/Add a value/);
    expect(
      ruleWarnings([rule("a", { source: "form.country", operator: "exists", value: "" })])
        .size,
    ).toBe(0);
    expect(
      ruleWarnings([
        rule("a", { source: "form.company_size", operator: "at_least", value: "lots" }),
      ]).get("a"),
    ).toMatch(/needs a number/);
  });
});

describe("routes", () => {
  it("keeps the current route exactly when it is picked again", () => {
    const route = { action: "self_serve_link" as const, message: "Sign up" };
    expect(routeFromKey(routeKey(route), route)).toBe(route);
    expect(
      routeFromKey("team:dach", { team: "sales", strategy: "existing_owner" }),
    ).toEqual({
      team: "dach",
      strategy: "existing_owner",
    });
    expect(routeFromKey(`to:${CRM_OWNER}`, route)).toEqual({ to: CRM_OWNER });
  });

  it("offers teams, reps, the HubSpot owner, self serve, and the queue", () => {
    const reps = [{ email: "Ana@Acme.com", name: "Ana" }];
    const teams = [{ key: "sales", name: "Sales" }];
    const labels = routeOptions(
      reps,
      teams,
      { action: "fallback_queue" },
      { fallback: false },
    );
    expect(labels).toEqual([
      { key: "team:sales", label: "team Sales" },
      { key: "to:ana@acme.com", label: "rep Ana" },
      { key: `to:${CRM_OWNER}`, label: "the HubSpot contact owner" },
      { key: "self_serve", label: "self serve" },
      { key: "queue", label: "the fallback queue" },
    ]);
    // The fallback can't use the owner; a target no longer offered stays listed.
    const fallback = routeOptions(
      reps,
      teams,
      { to: "gone@acme.com" },
      { fallback: true },
    );
    expect(fallback.map((option) => option.key)).toEqual([
      "to:gone@acme.com",
      "team:sales",
      "to:ana@acme.com",
      "self_serve",
      "queue",
    ]);
  });
});

describe("placeRuleErrors", () => {
  const errorsFor = (edit: (demo: FormRulesDraft) => void) => {
    const drafts = draftsOf(BASE);
    edit(drafts[0]!);
    const result = loadConfigObject(buildRulesConfig(BASE, drafts));
    if (result.ok) throw new Error("expected errors");
    return { drafts, errors: result.errors };
  };

  it("puts the rule set's shape errors next to the rule they name", () => {
    const { drafts, errors } = errorsFor((demo) => {
      demo.rules[2] = {
        ...demo.rules[2]!,
        when: { source: "form.company_size", operator: "at_least", value: "lots" },
      };
    });
    const placed = placeRuleErrors(errors, drafts);
    expect(placed.rules.get(drafts[0]!.rules[2]!.id)).toEqual([
      expect.stringMatching(/^when\.form\.company_size: /),
    ]);
    expect(placed.other).toEqual([]);

    const fallback = errorsFor((demo) => {
      demo.fallback = { to: CRM_OWNER };
    });
    expect(placeRuleErrors(fallback.errors, fallback.drafts).fallbacks.get(0)).toEqual([
      expect.stringMatching(/^to: fallback can't route/),
    ]);
  });

  it("puts reference errors next to the rule they name and the rest in a list", () => {
    const { drafts, errors } = errorsFor((demo) => {
      demo.rules[3] = {
        ...demo.rules[3]!,
        route: { team: "nope", strategy: "round_robin" },
      };
      demo.fallback = { to: "nobody@acme.com" };
    });
    const placed = placeRuleErrors([...errors, "reps: add at least one rep"], drafts);
    expect(placed.rules.get(drafts[0]!.rules[3]!.id)).toEqual([
      'team "nope" is not defined in teams',
    ]);
    expect(placed.fallbacks.get(0)).toEqual(["nobody@acme.com is not in reps"]);
    expect(placed.other).toEqual(["reps: add at least one rep"]);
  });
});

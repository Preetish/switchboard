import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, loadConfigObject, type ConfigInput } from "@switchboard/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFormsConfig, formsDraftsFromConfig } from "../src/app/setup/forms";
import { buildConfig, placeErrors } from "../src/app/setup/reps-teams";
import { buildRulesConfig } from "../src/app/setup/rules";
import {
  PLACEHOLDER_DOMAIN,
  TEMPLATES,
  configFromTemplate,
  draftsFromTemplate,
  hasExistingSetup,
  placeholderErrors,
} from "../src/app/setup/templates";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const BASE: ConfigInput = {
  org: { name: "Acme", slug: "acme" },
  theme: { accent: "#0B5FFF" },
  hubspot: { properties: { utm_source: "utm_source" } },
  reps: [{ email: "ana@acme.com", name: "Ana", timezone: "UTC" }],
  teams: [{ key: "sales", name: "Sales", members: ["ana@acme.com"] }],
  forms: [
    {
      slug: "contact",
      name: "Contact",
      submitLabel: "Send",
      selfServeUrl: "https://acme.com/signup",
      customCss: ".x { color: red; }",
      fields: [{ key: "email", label: "Email", type: "email", required: true }],
      rules: { rules: [], fallback: { team: "sales", strategy: "round_robin" } },
    },
    {
      slug: "partners",
      name: "Partners",
      fields: [{ key: "email", label: "Email", type: "email", required: true }],
    },
  ],
};

const loaded = (config: ConfigInput) => {
  const result = loadConfigObject(JSON.parse(JSON.stringify(config)));
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.plan;
};

afterEach(() => vi.restoreAllMocks());

describe("templates", () => {
  it("offers the four templates", () => {
    expect(TEMPLATES.map((template) => template.name)).toEqual([
      "B2B SaaS demo",
      "Territory split",
      "Paid campaign fast lane",
      "Blank",
    ]);
  });

  it.each(TEMPLATES)("$name gives a config the validator accepts", ({ id }) => {
    const config = configFromTemplate(id, BASE);
    const plan = loaded(config);
    expect(plan.forms).toHaveLength(1);
    expect(plan.forms[0]!.ruleSet).not.toBeNull();
    // The saved reps stay listed with no teams; the teams have placeholders only.
    expect(plan.reps.slice(0, 1).map((rep) => rep.email)).toEqual(["ana@acme.com"]);
    const placeholders = plan.reps.slice(1).map((rep) => rep.email);
    expect(placeholders.length).toBeGreaterThan(0);
    expect(placeholders.every((email) => email.endsWith(`@${PLACEHOLDER_DOMAIN}`))).toBe(
      true,
    );
    const members = plan.teams.flatMap((team) => team.members.map((m) => m.rep));
    expect(new Set(members)).toEqual(new Set(placeholders));
  });

  it.each(TEMPLATES)(
    "$name keeps the org, the default theme, and the first form's link and settings",
    ({ id }) => {
      const config = configFromTemplate(id, BASE);
      expect(config.org).toEqual(BASE.org);
      expect(config.theme).toEqual(BASE.theme);
      expect(config.hubspot).toEqual(BASE.hubspot);
      expect(config.forms[0]).toMatchObject({
        slug: "contact",
        submitLabel: "Send",
        selfServeUrl: "https://acme.com/signup",
        customCss: ".x { color: red; }",
      });
    },
  );

  it.each(TEMPLATES)(
    "$name loads into the editors and saves back unchanged",
    ({ id }) => {
      const drafts = draftsFromTemplate(id, BASE, "Europe/Berlin");
      expect(drafts.reps.map((rep) => rep.savedEmail)).toEqual([
        "ana@acme.com",
        ...drafts.reps.slice(1).map(() => null),
      ]);
      expect(drafts.reps.slice(1).every((rep) => rep.timezone === "Europe/Berlin")).toBe(
        true,
      );
      const saved = buildRulesConfig(
        buildFormsConfig(
          buildConfig(drafts.config, drafts.reps, drafts.teams),
          drafts.forms,
          formsDraftsFromConfig(drafts.config).theme,
        ),
        drafts.ruleForms,
      );
      expect(saved).toEqual(drafts.config);
    },
  );

  it("B2B SaaS demo routes as examples/rules.saas.yaml does", () => {
    const config = configFromTemplate("saas", BASE);
    // The same config with the form's rules read from the example file.
    const fromFile = {
      ...config,
      forms: [{ ...config.forms[0]!, rules: "rules.saas.yaml" }],
    };
    const configPath = path.join(repoRoot, "examples/switchboard.yaml");
    const result = loadConfig(JSON.stringify(fromFile), configPath, (file) =>
      readFileSync(file, "utf8"),
    );
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.plan.forms[0]!.ruleSet).toEqual(loaded(config).forms[0]!.ruleSet);
    expect(result.plan.teams.map((team) => team.key)).toEqual([
      "enterprise",
      "dach",
      "default",
    ]);
  });

  it("Paid campaign fast lane sends paid mediums to the fast lane and the rest round robin", () => {
    const ruleSet = loaded(configFromTemplate("paid", BASE)).forms[0]!.ruleSet!;
    expect(ruleSet.rules).toHaveLength(1);
    expect(Object.keys(ruleSet.rules[0]!.when)).toEqual(["attribution.utm_medium"]);
    expect(ruleSet.rules[0]!.route).toEqual({
      team: "fast-lane",
      strategy: "round_robin",
    });
    expect(ruleSet.fallback).toEqual({ team: "default", strategy: "round_robin" });
  });

  it("Blank has one form, one team, and the fallback only", () => {
    const plan = loaded(configFromTemplate("blank", BASE));
    expect(plan.teams).toHaveLength(1);
    expect(plan.forms[0]!.ruleSet).toEqual({
      rules: [],
      fallback: { team: "default", strategy: "round_robin" },
    });
  });

  it("choosing a template applies nothing and leaves the current config as it was", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const before = structuredClone(BASE);
    for (const { id } of TEMPLATES) {
      const drafts = draftsFromTemplate(id, BASE);
      // Editing the drafts doesn't reach the template either.
      drafts.config.forms[0]!.fields.pop();
      drafts.forms[0]!.fields[0]!.label = "Edited";
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(BASE).toEqual(before);
    expect(configFromTemplate("saas", BASE).forms[0]!.fields).toHaveLength(6);
  });
});

describe("replacing the draft", () => {
  it("warns when the draft has reps, teams, rules, or more than one form", () => {
    const empty: ConfigInput = {
      org: BASE.org,
      reps: [],
      forms: [{ slug: "contact", name: "Contact", fields: [] }],
    };
    expect(hasExistingSetup(empty)).toBe(false);
    expect(hasExistingSetup({ ...empty, teams: [] })).toBe(false);
    expect(hasExistingSetup({ ...empty, reps: BASE.reps })).toBe(true);
    expect(hasExistingSetup({ ...empty, teams: BASE.teams })).toBe(true);
    expect(hasExistingSetup({ ...empty, forms: [BASE.forms[0]!] })).toBe(true);
    expect(hasExistingSetup({ ...empty, forms: [...empty.forms, BASE.forms[1]!] })).toBe(
      true,
    );
    expect(hasExistingSetup(BASE)).toBe(true);
  });

  it("stops a save with placeholder reps, with the error on each rep", () => {
    // Ana (saved), then the fast lane and sales placeholders.
    const { reps } = draftsFromTemplate("paid", BASE);
    reps[1] = { ...reps[1]!, name: "Ben", email: "ben@acme.com" };
    const placed = placeErrors(placeholderErrors(reps));
    expect([...placed.reps.keys()]).toEqual([2]);
    expect(placed.reps.get(2)![0]).toMatch(/template placeholder/);
    expect(placed.other).toEqual([]);
    // A saved rep is never a placeholder, whatever its email.
    expect(placeholderErrors([{ ...reps[2]!, savedEmail: reps[2]!.email }])).toEqual([]);
  });
});

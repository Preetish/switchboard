import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadRuleSetYaml, parseRuleSetYaml, validateRuleSet } from "../src/rules/index.js";

describe("validateRuleSet", () => {
  it("accepts the README example rule set", () => {
    const result = validateRuleSet({
      rules: [
        { name: "Existing owner wins", when: { "crm.contact.owner": "exists" }, route: { to: "crm.contact.owner" } },
        { name: "Enterprise", when: { "form.company_size": { gte: 500 } }, route: { team: "enterprise", strategy: "round_robin" } },
        { name: "Personal email", when: { "form.email_domain": { in: ["gmail.com", "outlook.com"] } }, route: { action: "self_serve_link" } },
      ],
      fallback: { team: "default", strategy: "round_robin" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ruleSet.rules).toHaveLength(3);
      expect(result.ruleSet.fallback).toEqual({ team: "default", strategy: "round_robin" });
    }
  });

  it("accepts a bare scalar as eq shorthand and exists as the exists operator", () => {
    const result = validateRuleSet({
      rules: [{ name: "US only", when: { "form.country": "US" }, route: { action: "fallback_queue" } }],
      fallback: { action: "self_serve_link" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ruleSet.rules[0]?.when["form.country"]).toEqual({ eq: "US" });
    }
  });

  it("rejects a rule without a name", () => {
    const result = validateRuleSet({
      rules: [{ when: {}, route: { action: "fallback_queue" } }],
      fallback: { team: "default", strategy: "round_robin" },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("rules.0.name"))).toBe(true);
  });

  it("rejects unknown operators", () => {
    const result = validateRuleSet({
      rules: [{ name: "Bad", when: { "form.size": { equal: 5 } }, route: { team: "a", strategy: "round_robin" } }],
      fallback: { team: "d", strategy: "round_robin" },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("form.size"))).toBe(true);
  });

  it("rejects an empty condition object", () => {
    const result = validateRuleSet({
      rules: [{ name: "Empty when entry", when: { "form.size": {} }, route: { team: "a", strategy: "round_robin" } }],
      fallback: { team: "d", strategy: "round_robin" },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects unknown route shapes", () => {
    const result = validateRuleSet({
      rules: [{ name: "Bad route", when: {}, route: { user: "jane@corp.com" } }],
      fallback: { team: "d", strategy: "round_robin" },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown strategy", () => {
    const result = validateRuleSet({
      rules: [{ name: "Bad strategy", when: {}, route: { team: "a", strategy: "lottery" } }],
      fallback: { team: "d", strategy: "round_robin" },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate rule names", () => {
    const rule = { name: "Dup", when: {}, route: { team: "a", strategy: "round_robin" } };
    const result = validateRuleSet({ rules: [rule, { ...rule }], fallback: { team: "d", strategy: "round_robin" } });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/unique/);
  });

  it("rejects a missing fallback", () => {
    const result = validateRuleSet({
      rules: [{ name: "R", when: {}, route: { action: "fallback_queue" } }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-object rule set and reports the root path", () => {
    const result = validateRuleSet(["not", "a", "rule", "set"]);
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.startsWith("root")).toBe(true);
  });

  it("rejects an invalid regex with a readable error", () => {
    const result = validateRuleSet({
      rules: [{ name: "Regex", when: { "form.company": { matches: "([unclosed" } }, route: { action: "fallback_queue" } }],
      fallback: { team: "d", strategy: "round_robin" },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("invalid regular expression"))).toBe(true);
  });

  it("rejects unknown top-level keys", () => {
    const result = validateRuleSet({
      rules: [],
      fallback: { team: "d", strategy: "round_robin" },
      extra: true,
    });
    expect(result.ok).toBe(false);
  });
});

describe("loadRuleSetYaml", () => {
  const examplesDir = fileURLToPath(new URL("../../../examples", import.meta.url));

  it("loads every shipped example rule set", () => {
    const files = readdirSync(examplesDir).filter((f) => /^rules\..+\.yaml$/.test(f));
    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const file of files) {
      const result = loadRuleSetYaml(readFileSync(`${examplesDir}/${file}`, "utf8"));
      if (!result.ok) {
        throw new Error(`${file} failed validation: ${result.errors.join("; ")}`);
      }
      expect(result.ruleSet.rules.length).toBeGreaterThan(0);
      if (file === "rules.example.yaml") {
        expect(result.ruleSet.rules[0]?.name).toBe("Existing owner wins");
        expect(result.ruleSet.rules[0]?.when["crm.contact.owner"]).toEqual({ exists: true });
        expect(result.ruleSet.rules[2]?.route).toEqual({ action: "self_serve_link" });
      }
    }
  });

  it("reports malformed YAML", () => {
    const result = loadRuleSetYaml("rules: [unclosed");
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  it("reports YAML that is not a mapping", () => {
    const result = loadRuleSetYaml("- just\n- a\n- list\n");
    expect(result.ok).toBe(false);
  });

  it("accepts JSON rule files (JSON is a YAML subset)", () => {
    const json = JSON.stringify({
      rules: [{ name: "R", when: { "form.size": { gte: 10 } }, route: { team: "t", strategy: "round_robin" } }],
      fallback: { team: "d", strategy: "round_robin" },
    });
    expect(loadRuleSetYaml(json).ok).toBe(true);
  });

  it("parseRuleSetYaml returns the raw value without validating", () => {
    const parsed = parseRuleSetYaml("rules: []\nfallback: { team: d, strategy: round_robin }\n");
    expect(parsed.ok).toBe(true);
    expect(validateRuleSet(parsed.value).ok).toBe(true);
  });
});

describe("validateRuleSet — catches mistakes before they misroute leads", () => {
  const base = { fallback: { team: "default", strategy: "round_robin" } };
  const errorsFor = (value: unknown) => {
    const result = validateRuleSet(value);
    return result.ok ? [] : result.errors;
  };

  it("rejects paths that aren't form.* or crm.* (typos never match)", () => {
    const errors = errorsFor({
      ...base,
      rules: [{ name: "Typo", when: { "from.country": "DE" }, route: { action: "self_serve_link" } }],
    });
    expect(errors.join("\n")).toMatch(/paths start with form\. or crm\./);
  });

  it("rejects empty in/nin lists", () => {
    const errors = errorsFor({
      ...base,
      rules: [{ name: "Empty", when: { "form.country": { in: [] } }, route: { action: "self_serve_link" } }],
    });
    expect(errors.join("\n")).toMatch(/at least one value/);
  });

  it("rejects exists: false combined with value operators", () => {
    const errors = errorsFor({
      ...base,
      rules: [
        { name: "Contradiction", when: { "form.country": { exists: false, eq: "DE" } }, route: { action: "self_serve_link" } },
      ],
    });
    expect(errors.join("\n")).toMatch(/exists: false/);
  });

  it("rejects rules that a catch-all above makes unreachable", () => {
    const errors = errorsFor({
      ...base,
      rules: [
        { name: "Everyone", when: {}, route: { action: "self_serve_link" } },
        { name: "Never runs", when: { "form.country": "DE" }, route: { team: "dach", strategy: "round_robin" } },
      ],
    });
    expect(errors.join("\n")).toMatch(/unreachable: rule "Everyone"/);
  });

  it("rejects a fallback that routes to a path which may be empty", () => {
    const errors = errorsFor({ rules: [], fallback: { to: "crm.contact.owner" } });
    expect(errors.join("\n")).toMatch(/fallback can't route to a form\.\/crm\. path/);
  });

  it("still accepts a catch-all as the last rule", () => {
    expect(
      validateRuleSet({
        ...base,
        rules: [
          { name: "DACH", when: { "form.country": "DE" }, route: { team: "dach", strategy: "round_robin" } },
          { name: "Everyone else", when: {}, route: { action: "self_serve_link" } },
        ],
      }).ok,
    ).toBe(true);
  });
});

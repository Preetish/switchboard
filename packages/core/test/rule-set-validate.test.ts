import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadRuleSetYaml, parseRuleSetYaml, validateRuleSet } from "../src/rules/index.js";

describe("validateRuleSet", () => {
  it("accepts the brief's example rule set", () => {
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
  const examplePath = fileURLToPath(new URL("../../../examples/rules.example.yaml", import.meta.url));

  it("loads the shipped example rule file", () => {
    const text = readFileSync(examplePath, "utf8");
    const result = loadRuleSetYaml(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ruleSet.rules).toHaveLength(4);
      expect(result.ruleSet.rules[0]?.name).toBe("Existing owner wins");
      expect(result.ruleSet.rules[0]?.when["crm.contact.owner"]).toEqual({ exists: true });
      expect(result.ruleSet.rules[2]?.route).toEqual({ action: "self_serve_link" });
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

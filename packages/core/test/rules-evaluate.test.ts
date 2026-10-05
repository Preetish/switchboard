import { describe, expect, it } from "vitest";
import { evaluate, matchCondition, resolvePath } from "../src/rules/index.js";
import type { RuleSet } from "../src/rules/index.js";

const fallback = { team: "default", strategy: "round_robin" } as const;

function ruleSet(rules: RuleSet["rules"], fb: RuleSet["fallback"] = fallback): RuleSet {
  return { rules, fallback: fb };
}

describe("evaluate — routing precedence", () => {
  it("first matching rule wins", () => {
    const rs = ruleSet([
      { name: "Enterprise", when: { "form.company_size": { gte: 500 } }, route: { team: "enterprise", strategy: "round_robin" } },
      { name: "Catch all", when: {}, route: { action: "self_serve_link" } },
    ]);
    const result = evaluate(rs, { "form.company_size": "500" });
    expect(result.matchedRule).toBe("Enterprise");
    expect(result.action).toEqual({ team: "enterprise", strategy: "round_robin" });
  });

  it("falls through earlier rules that fail and matches a later one", () => {
    const rs = ruleSet([
      { name: "Enterprise", when: { "form.company_size": { gte: 500 } }, route: { team: "enterprise", strategy: "round_robin" } },
      { name: "SMB", when: {}, route: { team: "smb", strategy: "round_robin" } },
    ]);
    const result = evaluate(rs, { "form.company_size": "120" });
    expect(result.matchedRule).toBe("SMB");
  });

  it("uses the fallback action when no rule matches and flags it as unmatched", () => {
    const rs = ruleSet(
      [{ name: "US", when: { "form.country": "US" }, route: { team: "us", strategy: "round_robin" } }],
      { action: "fallback_queue" },
    );
    const result = evaluate(rs, { "form.country": "DE" });
    expect(result.matchedRule).toBeNull();
    expect(result.action).toEqual({ action: "fallback_queue" });
  });

  it("empty rule list goes straight to fallback", () => {
    const rs = ruleSet([]);
    expect(evaluate(rs, {}).matchedRule).toBeNull();
  });

  it("records a trace with the first failing path for every unmatched rule", () => {
    const rs = ruleSet([
      { name: "Owner", when: { "crm.contact.owner": "exists" }, route: { to: "crm.contact.owner" } },
      { name: "Enterprise", when: { "form.company_size": { gte: 500 } }, route: { team: "e", strategy: "round_robin" } },
      { name: "Always", when: {}, route: { action: "self_serve_link" } },
    ]);
    const result = evaluate(rs, { "form.company_size": "30" });
    expect(result.trace).toEqual([
      { rule: "Owner", matched: false, failedOn: "crm.contact.owner" },
      { rule: "Enterprise", matched: false, failedOn: "form.company_size" },
    ]);
    expect(result.matchedRule).toBe("Always");
  });
});

describe("evaluate — operators", () => {
  const cases: Array<{
    label: string;
    condition: Record<string, unknown>;
    input: unknown;
    matched: boolean;
  }> = [
    { label: "gte matches numeric string form value", condition: { gte: 500 }, input: "500", matched: true },
    { label: "gte rejects below threshold", condition: { gte: 500 }, input: "499", matched: false },
    { label: "gt is exclusive", condition: { gt: 500 }, input: 500, matched: false },
    { label: "lt matches numbers", condition: { lt: 10 }, input: 9, matched: true },
    { label: "lte is inclusive", condition: { lte: 10 }, input: 10, matched: true },
    { label: "numeric ops reject non-numeric strings", condition: { gte: 5 }, input: "big", matched: false },
    { label: "numeric ops reject empty strings", condition: { gte: 5 }, input: "", matched: false },
    { label: "eq matches exact string", condition: { eq: "US" }, input: "US", matched: true },
    { label: "eq is case-sensitive", condition: { eq: "US" }, input: "us", matched: false },
    { label: "eq coerces string to number", condition: { eq: 500 }, input: "500", matched: true },
    { label: "eq coerces number to string", condition: { eq: "500" }, input: 500, matched: true },
    { label: "eq does not coerce empty string to zero", condition: { eq: 0 }, input: "", matched: false },
    { label: "eq matches booleans", condition: { eq: true }, input: true, matched: true },
    { label: "eq fails on missing value", condition: { eq: "US" }, input: undefined, matched: false },
    { label: "neq passes on different value", condition: { neq: "US" }, input: "DE", matched: true },
    { label: "neq fails on equal value", condition: { neq: "US" }, input: "US", matched: false },
    { label: "neq fails on missing value", condition: { neq: "US" }, input: null, matched: false },
    { label: "in matches a member", condition: { in: ["gmail.com", "outlook.com"] }, input: "gmail.com", matched: true },
    { label: "in fails on non-member", condition: { in: ["gmail.com"] }, input: "corp.com", matched: false },
    { label: "in fails on missing value", condition: { in: ["gmail.com"] }, input: undefined, matched: false },
    { label: "nin passes on non-member", condition: { nin: ["gmail.com"] }, input: "corp.com", matched: true },
    { label: "nin fails on member", condition: { nin: ["gmail.com"] }, input: "gmail.com", matched: false },
    { label: "exists passes on present value", condition: { exists: true }, input: "owner-1", matched: true },
    { label: "exists fails on null", condition: { exists: true }, input: null, matched: false },
    { label: "exists fails on empty string", condition: { exists: true }, input: "", matched: false },
    { label: "exists:false passes on missing owner", condition: { exists: false }, input: null, matched: true },
    { label: "contains matches substring", condition: { contains: "corp" }, input: "acme corp inc", matched: true },
    { label: "contains fails on absent substring", condition: { contains: "corp" }, input: "acme gmbh", matched: false },
    { label: "matches regex", condition: { matches: "^[A-Z]{2}$" }, input: "DE", matched: true },
    { label: "matches fails on non-matching value", condition: { matches: "^[A-Z]{2}$" }, input: "Germany", matched: false },
    { label: "freeEmail detects a free provider", condition: { freeEmail: true }, input: "jane@gmail.com", matched: true },
    { label: "freeEmail rejects a work domain", condition: { freeEmail: true }, input: "jane@corp.com", matched: false },
    { label: "workEmail accepts a work domain", condition: { workEmail: true }, input: "jane@corp.com", matched: true },
    { label: "workEmail rejects a free provider", condition: { workEmail: true }, input: "jane@gmail.com", matched: false },
    { label: "workEmail fails on missing value", condition: { workEmail: true }, input: "", matched: false },
  ];

  for (const { label, condition, input, matched } of cases) {
    it(label, () => {
      expect(matchCondition(input, condition as never)).toBe(matched);
    });
  }

  it("ANDs all operators in one condition object", () => {
    expect(matchCondition("520", { gte: 500, lte: 1000 })).toBe(true);
    expect(matchCondition("5200", { gte: 500, lte: 1000 })).toBe(false);
  });
});

describe("evaluate — input shapes", () => {
  it("resolves flat dotted keys directly", () => {
    const rs = ruleSet([{ name: "R", when: { "form.country": "US" }, route: { action: "fallback_queue" } }]);
    expect(evaluate(rs, { "form.country": "US" }).matchedRule).toBe("R");
  });

  it("resolves nested objects via dotted paths", () => {
    const rs = ruleSet([{ name: "R", when: { "crm.contact.owner": "exists" }, route: { to: "crm.contact.owner" } }]);
    expect(evaluate(rs, { crm: { contact: { owner: "u1" } } }).matchedRule).toBe("R");
    expect(evaluate(rs, { crm: { contact: {} } }).matchedRule).toBeNull();
  });

  it("prefers an exact flat key over a nested walk", () => {
    const inputs = { "a.b": "flat", a: { b: "nested" } };
    expect(resolvePath(inputs, "a.b")).toBe("flat");
  });

  it("treats an empty when clause as a catch-all", () => {
    const rs = ruleSet([{ name: "Catch all", when: {}, route: { action: "self_serve_link" } }]);
    expect(evaluate(rs, {}).matchedRule).toBe("Catch all");
  });
});

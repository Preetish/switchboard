import { describe, expect, it } from "vitest";
import { crmPathsIn, FREE_EMAIL_DOMAINS, isFreeEmail, resolvePath } from "../src/rules/index.js";
import type { RuleSet } from "../src/rules/index.js";

const base: RuleSet = {
  rules: [],
  fallback: { team: "default", strategy: "round_robin" },
};

describe("crmPathsIn", () => {
  it("collects crm paths from when clauses and dynamic routes", () => {
    const rs: RuleSet = {
      rules: [
        { name: "Owner", when: { "crm.contact.owner": "exists" }, route: { to: "crm.contact.owner" } },
        { name: "Deal", when: { "form.size": { gte: 500 }, "crm.account.id": "exists" }, route: { team: "e", strategy: "round_robin" } },
      ],
      fallback: { team: "default", strategy: "round_robin" },
    };
    expect(crmPathsIn(rs)).toEqual(["crm.account.id", "crm.contact.owner"]);
  });

  it("includes crm routes in the fallback", () => {
    const rs: RuleSet = { ...base, fallback: { to: "crm.contact.owner" } };
    expect(crmPathsIn(rs)).toEqual(["crm.contact.owner"]);
  });

  it("returns an empty list when the rule set has no crm references", () => {
    const rs: RuleSet = {
      rules: [{ name: "R", when: { "form.country": "US" }, route: { action: "self_serve_link" } }],
      fallback: { action: "fallback_queue" },
    };
    expect(crmPathsIn(rs)).toEqual([]);
  });
});

describe("isFreeEmail", () => {
  it("detects common free providers from a full address", () => {
    expect(isFreeEmail("jane@gmail.com")).toBe(true);
    expect(isFreeEmail("JANE@Outlook.COM")).toBe(true);
    expect(isFreeEmail("jane@proton.me")).toBe(true);
  });

  it("detects free providers from a bare domain", () => {
    expect(isFreeEmail("gmail.com")).toBe(true);
    expect(isFreeEmail(" corp.com ")).toBe(false);
  });

  it("returns false for work domains and non-email input", () => {
    expect(isFreeEmail("jane@acme-corp.com")).toBe(false);
    expect(isFreeEmail("not-an-email")).toBe(false);
    expect(isFreeEmail(null)).toBe(false);
  });

  it("ships a compact provider list", () => {
    expect(FREE_EMAIL_DOMAINS.length).toBeGreaterThan(10);
  });
});

describe("resolvePath edge cases", () => {
  it("returns undefined when walking into primitives", () => {
    expect(resolvePath({ a: 5 }, "a.b")).toBeUndefined();
    expect(resolvePath({}, "a")).toBeUndefined();
  });

  it("does not walk the prototype chain", () => {
    expect(resolvePath({}, "__proto__")).toBeUndefined();
    expect(resolvePath({ crm: {} }, "crm.constructor.name")).toBeUndefined();
  });

  it("returns null values as-is so exists conditions see them", () => {
    expect(resolvePath({ "crm.contact.owner": null }, "crm.contact.owner")).toBeNull();
  });
});

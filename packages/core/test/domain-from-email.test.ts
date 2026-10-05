import { describe, expect, it } from "vitest";
import { domainFromEmail } from "../src/domain-from-email.js";

describe("domainFromEmail", () => {
  it("extracts the domain from a plain address", () => {
    expect(domainFromEmail("jane@example.com")).toBe("example.com");
  });

  it("lowercases the domain", () => {
    expect(domainFromEmail("jane@EXAMPLE.COM")).toBe("example.com");
  });

  it("keeps subdomains so rules can match them explicitly", () => {
    expect(domainFromEmail("jane@corp.example.co.uk")).toBe("corp.example.co.uk");
  });

  it("handles a local part containing an @ after trimming", () => {
    expect(domainFromEmail('"a@b"@example.com')).toBe("example.com");
  });

  it("ignores surrounding whitespace", () => {
    expect(domainFromEmail("  jane@example.com  ")).toBe("example.com");
  });

  it("returns null for a missing domain", () => {
    expect(domainFromEmail("jane@")).toBeNull();
  });

  it("returns null for a domain with no dot", () => {
    expect(domainFromEmail("jane@localhost")).toBeNull();
  });

  it("returns null for empty or non-string input", () => {
    expect(domainFromEmail("")).toBeNull();
    expect(domainFromEmail("   ")).toBeNull();
    expect(domainFromEmail(null)).toBeNull();
    expect(domainFromEmail(undefined)).toBeNull();
  });
});

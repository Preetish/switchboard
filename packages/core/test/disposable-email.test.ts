import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DISPOSABLE_EMAIL_DOMAINS,
  isDisposableEmail,
} from "../src/rules/disposable-email.js";

describe("isDisposableEmail", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("flags known disposable addresses", () => {
    expect(isDisposableEmail("lead@mailinator.com")).toBe(true);
    expect(isDisposableEmail("lead@yopmail.com")).toBe(true);
    expect(isDisposableEmail("lead@temp-mail.org")).toBe(true);
  });

  it("accepts bare domains too", () => {
    expect(isDisposableEmail("guerrillamail.com")).toBe(true);
    expect(isDisposableEmail("GuerrillaMail.COM")).toBe(true);
  });

  it("is case-insensitive on the domain", () => {
    expect(isDisposableEmail("Lead@MAILINATOR.COM")).toBe(true);
  });

  it("passes real providers through", () => {
    expect(isDisposableEmail("jane@corp.com")).toBe(false);
    expect(isDisposableEmail("jane@gmail.com")).toBe(false);
    // Exact-domain match, like the free-email list: a lookalike host on its
    // own domain is not on the list.
    expect(isDisposableEmail("mailinator.com.evil-corp.com")).toBe(false);
    expect(isDisposableEmail("sub.mailinator.com")).toBe(false);
  });

  it("returns false for missing or malformed values", () => {
    expect(isDisposableEmail(undefined)).toBe(false);
    expect(isDisposableEmail(null)).toBe(false);
    expect(isDisposableEmail(42)).toBe(false);
    expect(isDisposableEmail("")).toBe(false);
    expect(isDisposableEmail("   ")).toBe(false);
    expect(isDisposableEmail("not-an-email")).toBe(false);
  });

  it("keeps the list lowercase and unique", () => {
    const set = new Set(DISPOSABLE_EMAIL_DOMAINS);
    expect(set.size).toBe(DISPOSABLE_EMAIL_DOMAINS.length);
    for (const domain of DISPOSABLE_EMAIL_DOMAINS) {
      expect(domain).toBe(domain.toLowerCase());
    }
  });
});

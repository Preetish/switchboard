import { afterEach, describe, expect, it, vi } from "vitest";
import { adminConfigured, verifyAdminCredentials } from "@/lib/admin-credentials";

describe("verifyAdminCredentials", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts the configured email and password", () => {
    vi.stubEnv("ADMIN_EMAIL", "admin@corp.com");
    vi.stubEnv("ADMIN_PASSWORD", "hunter2secret");
    expect(verifyAdminCredentials("admin@corp.com", "hunter2secret")).toEqual({
      id: "admin",
      email: "admin@corp.com",
      name: "Admin",
    });
  });

  it("accepts the email case-insensitively and trims it", () => {
    vi.stubEnv("ADMIN_EMAIL", "admin@corp.com");
    vi.stubEnv("ADMIN_PASSWORD", "hunter2secret");
    expect(verifyAdminCredentials("  ADMIN@corp.com ", "hunter2secret")?.email).toBe(
      "admin@corp.com",
    );
  });

  it("rejects a wrong password, wrong email, or both", () => {
    vi.stubEnv("ADMIN_EMAIL", "admin@corp.com");
    vi.stubEnv("ADMIN_PASSWORD", "hunter2secret");
    expect(verifyAdminCredentials("admin@corp.com", "wrong")).toBeNull();
    expect(verifyAdminCredentials("other@corp.com", "hunter2secret")).toBeNull();
    expect(verifyAdminCredentials("other@corp.com", "wrong")).toBeNull();
  });

  it("rejects non-string input", () => {
    vi.stubEnv("ADMIN_EMAIL", "admin@corp.com");
    vi.stubEnv("ADMIN_PASSWORD", "hunter2secret");
    expect(verifyAdminCredentials(undefined, "hunter2secret")).toBeNull();
    expect(verifyAdminCredentials("admin@corp.com", undefined)).toBeNull();
    expect(verifyAdminCredentials(42, "hunter2secret")).toBeNull();
  });

  it("fails closed when the admin is not configured", () => {
    vi.stubEnv("ADMIN_EMAIL", "");
    vi.stubEnv("ADMIN_PASSWORD", "");
    expect(verifyAdminCredentials("admin@corp.com", "hunter2secret")).toBeNull();
    expect(adminConfigured()).toBe(false);
  });

  it("is not configured when only one variable is set", () => {
    vi.stubEnv("ADMIN_EMAIL", "admin@corp.com");
    vi.stubEnv("ADMIN_PASSWORD", "");
    expect(adminConfigured()).toBe(false);
  });

  it("configuration requires AUTH_SECRET to sign the session", () => {
    vi.stubEnv("ADMIN_EMAIL", "admin@corp.com");
    vi.stubEnv("ADMIN_PASSWORD", "hunter2secret");
    vi.stubEnv("AUTH_SECRET", "");
    expect(adminConfigured()).toBe(false);
    vi.stubEnv("AUTH_SECRET", "s3cret");
    expect(adminConfigured()).toBe(true);
  });
});

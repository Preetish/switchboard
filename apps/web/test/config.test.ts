import { describe, expect, it } from "vitest";
import { checkConfig, enforceConfig } from "../config-check.mjs";

const GOOD = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://u:p@db:5432/sb",
  AUTH_SECRET: "a".repeat(64),
  ADMIN_EMAIL: "admin@acme.test",
  ADMIN_PASSWORD: "correct horse battery staple",
  APP_BASE_URL: "https://switchboard.acme.test",
} as NodeJS.ProcessEnv;

describe("checkConfig", () => {
  it("accepts a sound production config", () => {
    expect(checkConfig(GOOD)).toEqual({ errors: [], warnings: [] });
  });

  it("rejects the old compose demo secret and password", () => {
    const { errors } = checkConfig({
      ...GOOD,
      AUTH_SECRET: "dev-only-demo-secret-change-me",
      ADMIN_PASSWORD: "admin1234",
    });
    expect(errors.join("\n")).toMatch(/AUTH_SECRET is a published or short value/);
    expect(errors.join("\n")).toMatch(/ADMIN_PASSWORD is a published default/);
  });

  it("requires the encryption key once an OAuth provider is configured", () => {
    const { errors } = checkConfig({
      ...GOOD,
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "secret",
    });
    expect(errors).toContain(
      "TOKEN_ENCRYPTION_KEY is required when Google or HubSpot is configured (OAuth tokens are encrypted at rest).",
    );
  });

  it("flags half-configured providers and malformed values", () => {
    const { errors } = checkConfig({
      ...GOOD,
      HUBSPOT_CLIENT_ID: "id",
      TOKEN_ENCRYPTION_KEY: "short",
      SPEED_TO_LEAD_MINUTES: "0",
      TRUSTED_PROXY_HOPS: "-1",
      SMTP_URL: "not a url",
    });
    expect(errors).toEqual(
      expect.arrayContaining([
        "Set both HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET, or neither.",
        "TOKEN_ENCRYPTION_KEY must be 64 hex characters (`openssl rand -hex 32`).",
        "SPEED_TO_LEAD_MINUTES must be a whole number of minutes (1 or more).",
        "TRUSTED_PROXY_HOPS must be a whole number from 0 to 10.",
        "SMTP_URL is not a URL (expected smtps://user:pass@host:465).",
      ]),
    );
  });

  it("warns about plain http on a public host", () => {
    expect(checkConfig({ ...GOOD, APP_BASE_URL: "http://sb.acme.test" }).warnings).toHaveLength(1);
    expect(checkConfig({ ...GOOD, APP_BASE_URL: "http://localhost:3000" }).warnings).toEqual([]);
  });
});

describe("enforceConfig", () => {
  it("throws in production", () => {
    expect(() => enforceConfig({ ...GOOD, AUTH_SECRET: "" })).toThrow(/will not start/);
  });

  it("only warns in development", () => {
    expect(() =>
      enforceConfig({ ...GOOD, NODE_ENV: "development", AUTH_SECRET: "" }),
    ).not.toThrow();
  });
});

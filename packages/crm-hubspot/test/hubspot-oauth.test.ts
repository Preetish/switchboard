import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HubspotAuthError,
  authorizationUrl,
  exchangeCode,
  refreshAccessToken,
  type HubspotOAuthConfig,
} from "../src/index.js";

const config: HubspotOAuthConfig = {
  clientId: "client-123",
  clientSecret: "secret-456",
  redirectUri: "http://localhost:3000/api/integrations/hubspot/callback",
};

const jsonFetch = (status: number, payload: unknown) => {
  const stub = vi.fn(async () => new Response(JSON.stringify(payload), { status }));
  vi.stubGlobal("fetch", stub);
  return stub;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("authorizationUrl", () => {
  it("builds the consent URL with scopes and state", () => {
    const url = new URL(authorizationUrl(config, "state-abc"));
    expect(url.origin + url.pathname).toBe("https://app.hubspot.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("scope")).toBe(
      "crm.objects.contacts.read crm.objects.contacts.write crm.objects.owners.read",
    );
    expect(url.searchParams.get("state")).toBe("state-abc");
  });
});

describe("exchangeCode", () => {
  it("posts the authorization-code grant and returns the token set", async () => {
    const stub = jsonFetch(200, {
      access_token: "at-1",
      refresh_token: "rt-1",
      expires_in: 1800,
      scope: "crm.objects.contacts.read",
    });
    const before = Date.now();
    const tokens = await exchangeCode(config, "code-789");
    expect(tokens.accessToken).toBe("at-1");
    expect(tokens.refreshToken).toBe("rt-1");
    expect(tokens.scope).toContain("contacts.read");
    expect(tokens.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 1800_000);

    const [, init] = stub.mock.calls[0]!;
    expect(init.method).toBe("POST");
    const body = new URLSearchParams(init.body);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("code-789");
    expect(body.get("client_id")).toBe("client-123");
    expect(body.get("client_secret")).toBe("secret-456");
    expect(body.get("redirect_uri")).toBe(config.redirectUri);
  });

  it("raises HubspotAuthError with HubSpot's description on rejection", async () => {
    jsonFetch(400, {
      error: "invalid_grant",
      error_description: "The authorization code has expired.",
    });
    await expect(exchangeCode(config, "bad")).rejects.toThrow(HubspotAuthError);
    await expect(exchangeCode(config, "bad")).rejects.toThrow(/has expired/);
  });

  it("raises HubspotAuthError on non-JSON failures", async () => {
    jsonFetch(502, "<html>bad gateway</html>");
    await expect(exchangeCode(config, "bad")).rejects.toThrow(/HTTP 502/);
  });

  it("raises HubspotAuthError when the endpoint is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("getaddrinfo ENOTFOUND");
      }),
    );
    await expect(exchangeCode(config, "bad")).rejects.toThrow(HubspotAuthError);
    await expect(exchangeCode(config, "bad")).rejects.toThrow(/unreachable/);
  });
});

describe("refreshAccessToken", () => {
  it("posts the refresh grant and carries the old refresh token forward", async () => {
    const stub = jsonFetch(200, { access_token: "at-2", expires_in: 1800 });
    const tokens = await refreshAccessToken(config, "rt-kept");
    expect(tokens.accessToken).toBe("at-2");
    expect(tokens.refreshToken).toBeUndefined();

    const [, init] = stub.mock.calls[0]!;
    const body = new URLSearchParams(init.body);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt-kept");
  });
});

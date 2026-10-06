import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GoogleAuthError,
  authorizationUrl,
  exchangeCode,
  refreshAccessToken,
  type GoogleOAuthConfig,
} from "../src/index.js";

const config: GoogleOAuthConfig = {
  clientId: "client-123",
  clientSecret: "secret-456",
  redirectUri: "http://localhost:3000/api/integrations/google/callback",
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
  it("builds the consent URL with offline access, scopes, and state", () => {
    const url = new URL(authorizationUrl(config, "state-abc"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.events",
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("state-abc");
  });
});

describe("exchangeCode", () => {
  it("posts the authorization-code grant and returns the token set", async () => {
    const stub = jsonFetch(200, {
      access_token: "at-1",
      refresh_token: "rt-1",
      expires_in: 3600,
      scope: "https://www.googleapis.com/auth/calendar.freebusy",
    });
    const before = Date.now();
    const tokens = await exchangeCode(config, "code-789");
    expect(tokens.accessToken).toBe("at-1");
    expect(tokens.refreshToken).toBe("rt-1");
    expect(tokens.scope).toContain("calendar.freebusy");
    expect(tokens.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 3600_000);

    const [, init] = stub.mock.calls[0]!;
    expect(init.method).toBe("POST");
    const body = new URLSearchParams(init.body);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("code-789");
    expect(body.get("client_id")).toBe("client-123");
    expect(body.get("client_secret")).toBe("secret-456");
    expect(body.get("redirect_uri")).toBe(config.redirectUri);
  });

  it("raises GoogleAuthError with Google's description on rejection", async () => {
    jsonFetch(400, { error: "invalid_grant", error_description: "Code was already redeemed." });
    await expect(exchangeCode(config, "bad")).rejects.toThrow(GoogleAuthError);
    await expect(exchangeCode(config, "bad")).rejects.toThrow(/already redeemed/);
  });

  it("raises GoogleAuthError on non-JSON failures", async () => {
    jsonFetch(502, "<html>bad gateway</html>");
    await expect(exchangeCode(config, "bad")).rejects.toThrow(/HTTP 502/);
  });

  it("raises GoogleAuthError when the endpoint is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }));
    await expect(exchangeCode(config, "bad")).rejects.toThrow(/unreachable.*ENOTFOUND/s);
  });

  it("times out (~2s default, configurable) instead of hanging", async () => {
    const stub = vi.fn(
      (_input: unknown, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), {
            once: true,
          });
        }),
    );
    vi.stubGlobal("fetch", stub);
    await expect(exchangeCode(config, "code", 10)).rejects.toThrow(/unreachable/);
    expect(stub).toHaveBeenCalledOnce();
  });
});

describe("refreshAccessToken", () => {
  it("posts the refresh grant and omits the refresh token when Google does", async () => {
    const stub = jsonFetch(200, { access_token: "at-2", expires_in: 1800 });
    const tokens = await refreshAccessToken(config, "rt-keep");
    expect(tokens.accessToken).toBe("at-2");
    expect(tokens.refreshToken).toBeUndefined();

    const [, init] = stub.mock.calls[0]!;
    const body = new URLSearchParams(init.body);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt-keep");
  });
});

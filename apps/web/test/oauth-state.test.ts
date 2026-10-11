import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CONNECT_LINK_TTL_MS,
  newOAuthState,
  readCookie,
  signConnectLink,
  verifyConnectLink,
  verifyOAuthState,
} from "../src/lib/oauth-state";

const REP = "6f1c1e2a-3b4c-4d5e-8f90-123456789abc";
const OTHER = "0a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d";

beforeEach(() => {
  process.env.AUTH_SECRET = "test-secret-for-oauth-state";
});
afterEach(() => {
  delete process.env.AUTH_SECRET;
});

describe("OAuth state", () => {
  it("round-trips the rep it was issued for", () => {
    const state = newOAuthState("google", REP)!;
    expect(verifyOAuthState("google", state, state)).toEqual({ userId: REP });
  });

  it("round-trips org-wide connections as userId null", () => {
    const state = newOAuthState("hubspot", null)!;
    expect(verifyOAuthState("hubspot", state, state)).toEqual({ userId: null });
  });

  it("rejects a state that does not match the cookie", () => {
    const state = newOAuthState("google", REP)!;
    expect(verifyOAuthState("google", state, newOAuthState("google", REP)!)).toBeNull();
    expect(verifyOAuthState("google", state, undefined)).toBeNull();
    expect(verifyOAuthState("google", null, state)).toBeNull();
  });

  it("rejects a state edited to point at another rep (cookie edited too)", () => {
    const [nonce, , signature] = newOAuthState("google", REP)!.split(".");
    const forged = `${nonce}.${OTHER}.${signature}`;
    expect(verifyOAuthState("google", forged, forged)).toBeNull();
  });

  it("does not accept a HubSpot state for Google", () => {
    const state = newOAuthState("hubspot", null)!;
    expect(verifyOAuthState("google", state, state)).toBeNull();
  });

  it("refuses to issue or verify without AUTH_SECRET", () => {
    const state = newOAuthState("google", REP)!;
    delete process.env.AUTH_SECRET;
    expect(newOAuthState("google", REP)).toBeNull();
    expect(verifyOAuthState("google", state, state)).toBeNull();
  });
});

describe("rep connect links", () => {
  it("verify for the rep they were signed for", () => {
    const query = new URLSearchParams(signConnectLink(REP, 1_000)!);
    expect(verifyConnectLink(query, 2_000)).toBe(REP);
  });

  it("expire after the TTL", () => {
    const query = new URLSearchParams(signConnectLink(REP, 1_000)!);
    expect(verifyConnectLink(query, 1_000 + CONNECT_LINK_TTL_MS + 1)).toBeNull();
  });

  it("cannot be re-pointed at another rep", () => {
    const query = new URLSearchParams(signConnectLink(REP, 1_000)!);
    query.set("rep", OTHER);
    expect(verifyConnectLink(query, 2_000)).toBeNull();
  });

  it("cannot have their expiry extended", () => {
    const query = new URLSearchParams(signConnectLink(REP, 1_000)!);
    query.set("exp", String(Number(query.get("exp")) + 1));
    expect(verifyConnectLink(query, 2_000)).toBeNull();
  });
});

describe("readCookie", () => {
  it("finds a cookie among others and keeps '=' inside values", () => {
    expect(readCookie("a=1; sb_oauth_state=x.y=z; b=2", "sb_oauth_state")).toBe("x.y=z");
    expect(readCookie(null, "sb_oauth_state")).toBeUndefined();
  });
});

import { createHmac, randomBytes } from "node:crypto";
import { secretsMatch } from "./crypto";

/**
 * OAuth `state` values and rep connect links, both signed with
 * `AUTH_SECRET`.
 *
 * The state round-trips through the provider and must equal the httpOnly
 * cookie set when the flow started (CSRF guard). It also names the rep the
 * connection is for, so it is signed: a rep cannot edit the cookie and the
 * query string to attach their calendar to someone else.
 *
 * Connect links let an admin send each rep a URL that starts the Google
 * consent flow for that rep only — reps never need the admin password.
 */

export type OAuthProvider = "google" | "hubspot";

export const STATE_COOKIE: Record<OAuthProvider, string> = {
  google: "sb_oauth_state",
  hubspot: "sb_oauth_state_hubspot",
};

/** How long a rep connect link stays valid. */
export const CONNECT_LINK_TTL_MS = 7 * 24 * 60 * 60_000;

const ORG_OWNER = "org";

function secret(): string | null {
  return process.env.AUTH_SECRET || null;
}

function mac(message: string, key: string): string {
  return createHmac("sha256", key).update(message).digest("base64url");
}

/** A fresh signed state for `provider`, bound to a rep (or the whole org). */
export function newOAuthState(provider: OAuthProvider, userId: string | null): string | null {
  const key = secret();
  if (!key) return null;
  const nonce = randomBytes(16).toString("hex");
  const owner = userId ?? ORG_OWNER;
  return `${nonce}.${owner}.${mac(`${provider}:${nonce}:${owner}`, key)}`;
}

/**
 * Verify a callback's state against the cookie and its signature. Returns
 * the owner it was issued for (`userId` null = org-wide), or null when the
 * state is missing, mismatched, or forged.
 */
export function verifyOAuthState(
  provider: OAuthProvider,
  state: string | null,
  cookieValue: string | undefined,
): { userId: string | null } | null {
  const key = secret();
  if (!key || !state || !cookieValue || !secretsMatch(state, cookieValue)) return null;
  const [nonce, owner, signature, ...rest] = state.split(".");
  if (!nonce || !owner || !signature || rest.length > 0) return null;
  if (!secretsMatch(signature, mac(`${provider}:${nonce}:${owner}`, key))) return null;
  return { userId: owner === ORG_OWNER ? null : owner };
}

/** Query string for a rep's Google connect link (`?rep=…&exp=…&sig=…`). */
export function signConnectLink(userId: string, now: number = Date.now()): string | null {
  const key = secret();
  if (!key) return null;
  const exp = String(now + CONNECT_LINK_TTL_MS);
  const sig = mac(`connect-link:${userId}:${exp}`, key);
  return new URLSearchParams({ rep: userId, exp, sig }).toString();
}

/** The rep a connect link was issued for, or null when forged or expired. */
export function verifyConnectLink(
  params: URLSearchParams,
  now: number = Date.now(),
): string | null {
  const key = secret();
  const rep = params.get("rep");
  const exp = params.get("exp");
  const sig = params.get("sig");
  if (!key || !rep || !exp || !sig) return null;
  if (!/^\d+$/.test(exp) || Number(exp) < now) return null;
  return secretsMatch(sig, mac(`connect-link:${rep}:${exp}`, key)) ? rep : null;
}

export function readCookie(cookieHeader: string | null, name: string): string | undefined {
  for (const cookie of cookieHeader?.split(";") ?? []) {
    const [cookieName, ...rest] = cookie.trim().split("=");
    if (cookieName === name) return rest.join("=");
  }
  return undefined;
}

export const STATE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 600,
};

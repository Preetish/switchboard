import { randomBytes } from "node:crypto";
import { computeSlots, DEFAULT_WORKING_HOURS } from "@switchboard/core";
import {
  DEFAULT_TIMEOUT_MS,
  GoogleAuthError,
  GoogleApiError,
  exchangeCode,
  fetchFreeBusy,
  refreshAccessToken,
  type GoogleOAuthConfig,
  type GoogleTokenSet,
} from "@switchboard/calendar-google";
import { and, eq, gt, lt, or } from "drizzle-orm";
import {
  bookings,
  integrations,
  orgs,
  users,
  type Database,
  type WorkingHours,
} from "@switchboard/db";
import { decryptJson, encryptJson, getEncryptionKey, secretsMatch } from "@/lib/crypto";
import { releaseExpiredHolds } from "./holds";

/**
 * Google Calendar integration plumbing: configuration from env, the OAuth
 * connect/callback handshake, and encrypted token lifecycle in the
 * `integrations` table. Tokens are decrypted only in memory, refreshed
 * lazily shortly before expiry, and re-encrypted on update.
 */

export const DEFAULT_ORG_SLUG = process.env.ORG_SLUG ?? "acme";

/** OAuth state cookie: random value compared in the callback (CSRF guard). */
export const OAUTH_STATE_COOKIE = "sb_oauth_state";

export function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export function googleConfig(): GoogleOAuthConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    redirectUri: `${appBaseUrl()}/api/integrations/google/callback`,
  };
}

/**
 * Interim guard for the connect/callback routes until Auth.js lands
 * (roadmap task 13): only a holder of `ADMIN_SETUP_KEY` may start the
 * Google handshake that stores an integration for the org.
 */
export function adminKeyOk(key: string | undefined | null): boolean {
  const expected = process.env.ADMIN_SETUP_KEY;
  if (!expected || !key) return false;
  return secretsMatch(key, expected);
}

/** The single org in single-org mode (see docs/decisions.md, task 5). */
export async function findOrg(db: Database): Promise<{ id: string; name: string } | null> {
  const [row] = await db
    .select({ id: orgs.id, name: orgs.name })
    .from(orgs)
    .where(eq(orgs.slug, DEFAULT_ORG_SLUG))
    .limit(1);
  return row ?? null;
}

/**
 * The encrypted blob's shape. `expiresAtMs` is epoch milliseconds because
 * JSON round-trips Dates as strings — a Date here would crash the expiry
 * check on load.
 */
type StoredGoogleTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAtMs: number;
  scope?: string;
};

function toStored(tokens: GoogleTokenSet): StoredGoogleTokens {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAtMs: tokens.expiresAt.getTime(),
    scope: tokens.scope,
  };
}

export async function loadGoogleTokens(
  db: Database,
  orgId: string,
): Promise<GoogleTokenSet | null> {
  const [row] = await db
    .select({ tokenCipher: integrations.tokenCipher })
    .from(integrations)
    .where(
      and(eq(integrations.orgId, orgId), eq(integrations.provider, "google_calendar")),
    )
    .limit(1);
  if (!row) return null;
  try {
    const stored = decryptJson<StoredGoogleTokens>(row.tokenCipher, getEncryptionKey());
    return {
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      expiresAt: new Date(stored.expiresAtMs),
      scope: stored.scope,
    };
  } catch {
    // Unreadable blob (key rotated/lost) counts as not connected; the admin
    // reconnects and overwrites the row.
    return null;
  }
}

async function saveGoogleTokens(
  db: Database,
  orgId: string,
  tokens: GoogleTokenSet,
): Promise<void> {
  const tokenCipher = encryptJson(toStored(tokens), getEncryptionKey());
  await db
    .insert(integrations)
    .values({
      orgId,
      provider: "google_calendar",
      tokenCipher,
      scopes: tokens.scope ?? null,
      status: "connected",
    })
    .onConflictDoUpdate({
      target: [integrations.orgId, integrations.provider],
      set: { tokenCipher, scopes: tokens.scope ?? null, status: "connected", updatedAt: new Date() },
    });
}

export function newStateValue(): string {
  return randomBytes(16).toString("hex");
}

/** Complete the OAuth handshake; returns a stable error code on failure. */
export async function connectGoogle(
  db: Database,
  orgId: string,
  code: string,
): Promise<{ ok: true } | { ok: false; error: "google_not_configured" | "exchange_failed" }> {
  const config = googleConfig();
  if (!config) return { ok: false, error: "google_not_configured" };
  try {
    const tokens = await exchangeCode(config, code, DEFAULT_TIMEOUT_MS);
    await saveGoogleTokens(db, orgId, tokens);
    return { ok: true };
  } catch (cause) {
    console.error(
      `Google token exchange failed: ${cause instanceof GoogleAuthError ? cause.message : String(cause)}`,
    );
    return { ok: false, error: "exchange_failed" };
  }
}

/**
 * A valid access token, refreshing it shortly before expiry (60s skew) and
 * carrying the stored refresh token forward when Google omits it. Returns
 * null when the org is not connected or the refresh call fails — callers
 * degrade to local availability instead of failing the request.
 */
export async function getValidAccessToken(
  db: Database,
  orgId: string,
): Promise<string | null> {
  const tokens = await loadGoogleTokens(db, orgId);
  if (!tokens?.refreshToken) return tokens?.accessToken ?? null;
  if (tokens.expiresAt.getTime() - Date.now() > 60_000) return tokens.accessToken;

  const config = googleConfig();
  if (!config) return null;
  try {
    const refreshed = await refreshAccessToken(
      config,
      tokens.refreshToken,
      DEFAULT_TIMEOUT_MS,
    );
    const merged: GoogleTokenSet = {
      ...refreshed,
      refreshToken: refreshed.refreshToken ?? tokens.refreshToken,
    };
    await saveGoogleTokens(db, orgId, merged);
    return merged.accessToken;
  } catch (cause) {
    // Surface the reason to the caller context; availability degrades.
    console.error(
      `Google token refresh failed: ${cause instanceof GoogleAuthError ? cause.message : String(cause)}`,
    );
    return null;
  }
}

export type Availability = {
  rep: { name: string; timeZone: string };
  workingHours: WorkingHours;
  from: Date;
  to: Date;
  durationMinutes: number;
  /** Where busy windows came from: Google Calendar, or local bookings only. */
  source: "google" | "local";
  calendarError?: string;
  slots: { start: string; end: string }[];
};

/** Lead time before the earliest bookable slot (a lead cannot book the past). */
const LEAD_MINUTES = 60;
const MINUTE_MS = 60_000;

/**
 * Bookable slots for one rep over the next `days` days: confirmed bookings
 * from the local DB plus, when connected, Google free/busy. A Google failure
 * (timeout/error) is logged, flagged in the response, and never blocks the
 * slots that local data can still offer.
 */
export async function getAvailability(
  db: Database,
  userId: string,
  durationMinutes: number,
  days: number,
): Promise<Availability | null> {
  const [rep] = await db
    .select({
      name: users.name,
      timeZone: users.timezone,
      workingHours: users.workingHours,
      orgId: users.orgId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!rep) return null;

  const now = Date.now();
  const from = new Date(now + LEAD_MINUTES * MINUTE_MS);
  const to = new Date(now + days * 24 * 60 * MINUTE_MS);
  const workingHours = rep.workingHours ?? undefined;

  // Expired holds release lazily; remaining holds and confirmed bookings both
  // block their slots.
  await releaseExpiredHolds(db);
  const localBusy = await db
    .select({ start: bookings.startAt, end: bookings.endAt })
    .from(bookings)
    .where(
      and(
        eq(bookings.userId, userId),
        or(eq(bookings.status, "confirmed"), eq(bookings.status, "hold")),
        lt(bookings.startAt, to),
        gt(bookings.endAt, from),
      ),
    );

  const busy = localBusy.map((interval) => ({ start: interval.start, end: interval.end }));
  let source: Availability["source"] = "local";
  let calendarError: string | undefined;

  const accessToken = await getValidAccessToken(db, rep.orgId);
  if (accessToken) {
    try {
      const freeBusy = await fetchFreeBusy({
        accessToken,
        timeMin: from,
        timeMax: to,
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
      busy.push(...freeBusy.busy);
      source = "google";
    } catch (cause) {
      calendarError =
        cause instanceof GoogleApiError || cause instanceof GoogleAuthError
          ? cause.message
          : "Google Calendar lookup failed.";
    }
  }

  const slots = computeSlots({
    timeZone: rep.timeZone,
    workingHours,
    from,
    to,
    durationMinutes,
    busy,
  });

  return {
    rep: { name: rep.name, timeZone: rep.timeZone },
    workingHours: workingHours ?? DEFAULT_WORKING_HOURS,
    from,
    to,
    durationMinutes,
    source,
    calendarError,
    slots: slots.map((slot) => ({ start: slot.start.toISOString(), end: slot.end.toISOString() })),
  };
}

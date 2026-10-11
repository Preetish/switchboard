import { computeSlots } from "@switchboard/core";
import {
  DEFAULT_TIMEOUT_MS,
  GoogleAuthError,
  GoogleApiError,
  exchangeCode,
  fetchFreeBusy,
  missingCalendarScopes,
  refreshAccessToken,
  type GoogleOAuthConfig,
} from "@switchboard/calendar-google";
import { and, eq, gt, lt, or } from "drizzle-orm";
import { bookings, orgs, users, type Database, type WorkingHours } from "@switchboard/db";
import { secretsMatch } from "@/lib/crypto";
import { releaseExpiredHolds } from "./holds";
import { getValidAccessToken, saveTokens, type TokenOwner } from "./token-store";

/**
 * Google Calendar integration: configuration from env, completing the OAuth
 * handshake, and availability. Each rep connects their own calendar, so
 * tokens are stored per rep (see `token-store.ts`) and free/busy and event
 * creation always act as the rep the lead was routed to.
 */

export const DEFAULT_ORG_SLUG = process.env.ORG_SLUG ?? "acme";

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
 * Automation key for the CSV export route: scripted exports authenticate
 * with `ADMIN_SETUP_KEY` instead of the admin session cookie. The admin
 * pages and OAuth handshakes use Auth.js sessions.
 */
export function adminKeyOk(key: string | undefined | null): boolean {
  const expected = process.env.ADMIN_SETUP_KEY;
  if (!expected || !key) return false;
  return secretsMatch(key, expected);
}

/** The single org in single-org mode (`ORG_SLUG`). */
export async function findOrg(
  db: Database,
): Promise<{ id: string; name: string } | null> {
  const [row] = await db
    .select({ id: orgs.id, name: orgs.name })
    .from(orgs)
    .where(eq(orgs.slug, DEFAULT_ORG_SLUG))
    .limit(1);
  return row ?? null;
}

export type GoogleConnectError =
  "google_not_configured" | "exchange_failed" | "scope_missing";

/**
 * Complete the OAuth handshake for one rep; returns a stable error code on
 * failure. A consent screen where the rep unticked a calendar scope is
 * rejected here rather than failing later at booking time.
 */
export async function connectGoogle(
  db: Database,
  owner: TokenOwner & { userId: string },
  code: string,
): Promise<{ ok: true } | { ok: false; error: GoogleConnectError }> {
  const config = googleConfig();
  if (!config) return { ok: false, error: "google_not_configured" };
  try {
    const tokens = await exchangeCode(config, code, DEFAULT_TIMEOUT_MS);
    if (missingCalendarScopes(tokens.scope).length > 0) {
      return { ok: false, error: "scope_missing" };
    }
    await saveTokens(db, "google_calendar", owner, tokens, tokens.email ?? null);
    return { ok: true };
  } catch (cause) {
    console.error(
      `Google token exchange failed: ${cause instanceof GoogleAuthError ? cause.message : String(cause)}`,
    );
    return { ok: false, error: "exchange_failed" };
  }
}

/**
 * A valid access token for one rep's Google Calendar, or null when that rep
 * has not connected (or the refresh failed) — callers degrade to local
 * availability instead of failing the request.
 */
export async function getGoogleAccessToken(
  db: Database,
  owner: TokenOwner & { userId: string },
): Promise<string | null> {
  const config = googleConfig();
  return getValidAccessToken(
    db,
    "google_calendar",
    owner,
    config
      ? (refreshToken) => refreshAccessToken(config, refreshToken, DEFAULT_TIMEOUT_MS)
      : null,
  );
}

/**
 * Public availability for the booking UI: the rep's display name and zone
 * and open slots. Working hours, calendar error text, and free/busy details
 * stay server-side.
 */
export type Availability = {
  rep: { name: string; timeZone: string };
  durationMinutes: number;
  /** True when the live calendar could not be read and only local bookings count. */
  degraded: boolean;
  slots: { start: string; end: string }[];
};

/** Lead time before the earliest bookable slot (a lead cannot book the past). */
export const LEAD_MINUTES = 60;
/** Furthest ahead a lead may look or book. */
export const MAX_HORIZON_DAYS = 42;
const MINUTE_MS = 60_000;

/**
 * Whether `startAt` is a slot the rep actually offers for this duration:
 * inside their working hours, on the slot grid, after the lead time, and
 * within the booking horizon. Busy time is checked separately (the database
 * constraint and the live free/busy re-check).
 */
export function isOfferedSlot(
  rep: { timeZone: string; workingHours: WorkingHours | null },
  startAt: Date,
  durationMinutes: number,
  now: number = Date.now(),
): boolean {
  const earliest = now + LEAD_MINUTES * MINUTE_MS;
  const latest = now + MAX_HORIZON_DAYS * 24 * 60 * MINUTE_MS;
  const end = startAt.getTime() + durationMinutes * MINUTE_MS;
  if (startAt.getTime() < earliest || end > latest) return false;
  const slots = computeSlots({
    timeZone: rep.timeZone,
    workingHours: rep.workingHours ?? undefined,
    from: startAt,
    to: new Date(end),
    durationMinutes,
  });
  return slots.some((slot) => slot.start.getTime() === startAt.getTime());
}

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
  const to = new Date(now + Math.min(days, MAX_HORIZON_DAYS) * 24 * 60 * MINUTE_MS);
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

  const busy = localBusy.map((interval) => ({
    start: interval.start,
    end: interval.end,
  }));
  let degraded = false;

  const accessToken = await getGoogleAccessToken(db, { orgId: rep.orgId, userId });
  if (accessToken) {
    try {
      const freeBusy = await fetchFreeBusy({
        accessToken,
        timeMin: from,
        timeMax: to,
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
      busy.push(...freeBusy.busy);
    } catch (cause) {
      degraded = true;
      console.error(
        `Google free/busy failed for rep ${userId}; offering times from local bookings only: ${
          cause instanceof GoogleApiError || cause instanceof GoogleAuthError
            ? cause.message
            : String(cause)
        }`,
      );
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
    durationMinutes,
    degraded,
    slots: slots.map((slot) => ({
      start: slot.start.toISOString(),
      end: slot.end.toISOString(),
    })),
  };
}

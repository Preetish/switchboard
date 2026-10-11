import {
  DEFAULT_TIMEOUT_MS,
  HubspotApiError,
  HubspotAuthError,
  exchangeCode,
  findContactByEmail,
  getOwner,
  logMeeting,
  refreshAccessToken,
  upsertContact,
  type HubspotOAuthConfig,
  type HubspotTokenSet,
} from "@switchboard/crm-hubspot";
import { and, eq } from "drizzle-orm";
import { bookings, integrations, type Database } from "@switchboard/db";
import { decryptJson, encryptJson, getEncryptionKey } from "@/lib/crypto";

/**
 * HubSpot integration plumbing, mirroring `integrations.ts` (Google): env
 * config, OAuth handshake completion, encrypted token lifecycle, and the
 * write-back helpers. CRM lookups are best-effort — a HubSpot outage or
 * timeout degrades routing to non-CRM rules instead of dropping the lead
 * (routing-brief edge case: fall back, log the failure).
 */

export function hubspotConfig(): HubspotOAuthConfig | null {
  const clientId = process.env.HUBSPOT_CLIENT_ID;
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    redirectUri: `${appBaseUrl()}/api/integrations/hubspot/callback`,
  };
}

function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

/** Same stored shape as Google tokens: epoch-ms survives JSON round-trips. */
type StoredHubspotTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAtMs: number;
  scope?: string;
};

async function loadHubspotTokens(
  db: Database,
  orgId: string,
): Promise<HubspotTokenSet | null> {
  const [row] = await db
    .select({ tokenCipher: integrations.tokenCipher })
    .from(integrations)
    .where(and(eq(integrations.orgId, orgId), eq(integrations.provider, "hubspot")))
    .limit(1);
  if (!row) return null;
  try {
    const stored = decryptJson<StoredHubspotTokens>(row.tokenCipher, getEncryptionKey());
    return {
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      expiresAt: new Date(stored.expiresAtMs),
      scope: stored.scope,
    };
  } catch {
    // Unreadable blob (key rotated/lost) counts as not connected.
    return null;
  }
}

async function saveHubspotTokens(
  db: Database,
  orgId: string,
  tokens: HubspotTokenSet,
): Promise<void> {
  const stored: StoredHubspotTokens = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAtMs: tokens.expiresAt.getTime(),
    scope: tokens.scope,
  };
  const tokenCipher = encryptJson(stored, getEncryptionKey());
  await db
    .insert(integrations)
    .values({
      orgId,
      provider: "hubspot",
      tokenCipher,
      scopes: tokens.scope ?? null,
      status: "connected",
    })
    .onConflictDoUpdate({
      target: [integrations.orgId, integrations.provider],
      set: {
        tokenCipher,
        scopes: tokens.scope ?? null,
        status: "connected",
        updatedAt: new Date(),
      },
    });
}

/** Complete the OAuth handshake; returns a stable error code on failure. */
export async function connectHubspot(
  db: Database,
  orgId: string,
  code: string,
): Promise<
  { ok: true } | { ok: false; error: "hubspot_not_configured" | "exchange_failed" }
> {
  const config = hubspotConfig();
  if (!config) return { ok: false, error: "hubspot_not_configured" };
  try {
    const tokens = await exchangeCode(config, code, DEFAULT_TIMEOUT_MS);
    await saveHubspotTokens(db, orgId, tokens);
    return { ok: true };
  } catch (cause) {
    console.error(
      `HubSpot token exchange failed: ${cause instanceof HubspotAuthError ? cause.message : String(cause)}`,
    );
    return { ok: false, error: "exchange_failed" };
  }
}

/**
 * A valid access token, refreshing it shortly before expiry (HubSpot tokens
 * live ~30 minutes, so this is the common path). Returns null when the org is
 * not connected or the refresh call fails.
 */
async function getValidHubspotAccessToken(
  db: Database,
  orgId: string,
): Promise<string | null> {
  const tokens = await loadHubspotTokens(db, orgId);
  if (!tokens?.refreshToken) return tokens?.accessToken ?? null;
  if (tokens.expiresAt.getTime() - Date.now() > 60_000) return tokens.accessToken;

  const config = hubspotConfig();
  if (!config) return null;
  try {
    const refreshed = await refreshAccessToken(
      config,
      tokens.refreshToken,
      DEFAULT_TIMEOUT_MS,
    );
    const merged: HubspotTokenSet = {
      ...refreshed,
      refreshToken: refreshed.refreshToken ?? tokens.refreshToken,
    };
    await saveHubspotTokens(db, orgId, merged);
    return merged.accessToken;
  } catch (cause) {
    console.error(
      `HubSpot token refresh failed: ${cause instanceof HubspotAuthError ? cause.message : String(cause)}`,
    );
    return null;
  }
}

export type CrmContext = {
  contact: {
    id: string;
    /** HubSpot owner's email — the value behind `crm.contact.owner`. */
    owner: string | null;
    ownerId: string | null;
  };
};

/** Overall budget for the pre-routing CRM lookup so form submits stay fast. */
const CRM_CONTEXT_BUDGET_MS = 3_000;

/**
 * Race `promise` against a deadline. A failure after the deadline would
 * otherwise be an unhandled rejection; it is logged here because it can no
 * longer reach the caller. A failure before the deadline propagates to the
 * caller's catch (logged there once).
 */
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let deadlineHit = false;
  promise.catch((cause: unknown) => {
    if (!deadlineHit) return;
    console.error(
      `HubSpot lookup finished late: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  });
  return Promise.race([
    promise,
    new Promise<null>((resolve) =>
      setTimeout(() => {
        deadlineHit = true;
        resolve(null);
      }, ms),
    ),
  ]);
}

/**
 * The `crm.*` inputs for one lead: their HubSpot contact and owner email.
 * Never throws — not connected, HubSpot down, or over budget all yield null
 * and the rules engine simply sees no CRM data (non-CRM rules still route).
 */
export async function fetchCrmContext(
  db: Database,
  orgId: string,
  email: string,
): Promise<CrmContext | null> {
  try {
    const accessToken = await getValidHubspotAccessToken(db, orgId);
    if (!accessToken) return null;
    // True once the lookup resolved — including "no contact for this lead",
    // which is the normal state for a brand-new inbound lead, not an error.
    let lookupFinished = false;
    const context = await withDeadline(
      (async () => {
        const contact = await findContactByEmail({
          accessToken,
          email,
          timeoutMs: DEFAULT_TIMEOUT_MS,
        });
        if (!contact) {
          lookupFinished = true;
          return null;
        }
        let owner: string | null = null;
        if (contact.ownerId) {
          const ownerRow = await getOwner({
            accessToken,
            ownerId: contact.ownerId,
            timeoutMs: DEFAULT_TIMEOUT_MS,
          });
          owner = ownerRow?.email ? ownerRow.email.toLowerCase() : null;
        }
        lookupFinished = true;
        return { contact: { id: contact.id, owner, ownerId: contact.ownerId } };
      })(),
      CRM_CONTEXT_BUDGET_MS,
    );
    if (!context && !lookupFinished) {
      console.error(
        "HubSpot contact lookup did not finish in time; routing continues without CRM data.",
      );
    }
    return context;
  } catch (cause) {
    console.error(
      `HubSpot contact lookup failed: ${
        cause instanceof HubspotApiError ? cause.message : String(cause)
      }`,
    );
    return null;
  }
}

/** Form keys we know how to map onto HubSpot contact properties. */
function submissionToHubspotProperties(
  data: Record<string, string>,
): Record<string, string | null> {
  const properties: Record<string, string | null> = {};
  const name = data.name?.trim();
  if (name) {
    const spaceAt = name.indexOf(" ");
    properties.firstname = spaceAt === -1 ? name : name.slice(0, spaceAt);
    properties.lastname = spaceAt === -1 ? "" : name.slice(spaceAt + 1);
  }
  const company = data.company?.trim();
  if (company) properties.company = company;
  return properties;
}

/**
 * Upsert the lead into HubSpot (create-or-update keyed on email, so retries
 * never create duplicate CRM records), so every booked demo lands in the CRM.
 * Best-effort: failures are logged and never block the routing response.
 */
export async function upsertCrmContact(
  db: Database,
  orgId: string,
  submission: { id: string; email: string | null; data: Record<string, string> },
): Promise<boolean> {
  if (!submission.email) return false;
  const accessToken = await getValidHubspotAccessToken(db, orgId);
  if (!accessToken) return false;
  try {
    await upsertContact({
      accessToken,
      email: submission.email,
      properties: submissionToHubspotProperties(submission.data),
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
    return true;
  } catch (cause) {
    console.error(
      `HubSpot contact upsert failed (submission ${submission.id}): ${
        cause instanceof HubspotApiError ? cause.message : String(cause)
      }`,
    );
    return false;
  }
}

/**
 * Log the confirmed booking on the contact's HubSpot timeline. Idempotent via
 * `bookings.crm_meeting_id`: once stored, repeat calls skip the API entirely.
 * Best-effort — a HubSpot failure never unbooks a confirmed meeting.
 */
export async function logCrmMeeting(
  db: Database,
  orgId: string,
  booking: {
    id: string;
    crmMeetingId: string | null;
    startAt: Date;
    endAt: Date;
    leadEmail: string | null;
    leadName: string | null;
    repName: string;
    meetLink: string | null;
  },
): Promise<string | null> {
  if (booking.crmMeetingId) return booking.crmMeetingId;
  if (!booking.leadEmail) return null;
  try {
    const accessToken = await getValidHubspotAccessToken(db, orgId);
    if (!accessToken) return null;
    const contact = await findContactByEmail({
      accessToken,
      email: booking.leadEmail,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
    if (!contact) return null;
    const { meetingId } = await logMeeting({
      accessToken,
      contactId: contact.id,
      title: `${booking.leadName ?? "New meeting"} × ${booking.repName}`,
      startAt: booking.startAt,
      endAt: booking.endAt,
      body: booking.meetLink ? `Meeting link: ${booking.meetLink}` : undefined,
      ownerId: contact.ownerId,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
    await db
      .update(bookings)
      .set({ crmMeetingId: meetingId })
      .where(eq(bookings.id, booking.id));
    return meetingId;
  } catch (cause) {
    console.error(
      `HubSpot meeting log failed (booking ${booking.id}): ${
        cause instanceof HubspotApiError ? cause.message : String(cause)
      }`,
    );
    return null;
  }
}

import {
  DEFAULT_TIMEOUT_MS,
  HubspotApiError,
  HubspotAuthError,
  exchangeCode,
  findContactByEmail,
  findOwnerByEmail,
  getOwner,
  logMeeting,
  refreshAccessToken,
  upsertContact,
  type HubspotOAuthConfig,
} from "@switchboard/crm-hubspot";
import { eq } from "drizzle-orm";
import { bookings, submissions, type Database } from "@switchboard/db";
import { appBaseUrl } from "./integrations";
import { getValidAccessToken, saveTokens } from "./token-store";

/**
 * HubSpot integration plumbing: env config, OAuth handshake completion, and
 * the lookup/write-back helpers. HubSpot is one org-wide connection (tokens
 * in `token-store.ts` with no rep). CRM lookups are best-effort — a HubSpot
 * outage or timeout degrades routing to non-CRM rules instead of dropping
 * the lead, and the failure is logged.
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
    await saveTokens(db, "hubspot", { orgId, userId: null }, tokens);
    return { ok: true };
  } catch (cause) {
    console.error(
      `HubSpot token exchange failed: ${cause instanceof HubspotAuthError ? cause.message : String(cause)}`,
    );
    return { ok: false, error: "exchange_failed" };
  }
}

/**
 * A valid access token (HubSpot tokens live ~30 minutes, so refreshing is
 * the common path). Null when the org is not connected or the refresh fails.
 */
function getValidHubspotAccessToken(db: Database, orgId: string): Promise<string | null> {
  const config = hubspotConfig();
  return getValidAccessToken(
    db,
    "hubspot",
    { orgId, userId: null },
    config
      ? (refreshToken) => refreshAccessToken(config, refreshToken, DEFAULT_TIMEOUT_MS)
      : null,
  );
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
 * Write a lead to HubSpot (create-or-update keyed on email, so retries never
 * create duplicate CRM records). Runs as a queued job: throws on failures
 * worth retrying (rate limits, HubSpot outages) and returns quietly when
 * there is nothing to do (no email, not connected, already synced).
 */
export async function syncLeadToCrm(db: Database, submissionId: string): Promise<void> {
  const [submission] = await db
    .select({
      orgId: submissions.orgId,
      email: submissions.email,
      data: submissions.data,
      crmSyncedAt: submissions.crmSyncedAt,
    })
    .from(submissions)
    .where(eq(submissions.id, submissionId))
    .limit(1);
  if (!submission?.email || submission.crmSyncedAt) return;
  const accessToken = await getValidHubspotAccessToken(db, submission.orgId);
  if (!accessToken) return;
  try {
    await upsertContact({
      accessToken,
      email: submission.email,
      properties: submissionToHubspotProperties(submission.data),
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  } catch (cause) {
    if (cause instanceof HubspotApiError && !cause.retryable) {
      console.error(`HubSpot rejected contact for submission ${submissionId}: ${cause.message}`);
      return;
    }
    throw cause;
  }
  await db
    .update(submissions)
    .set({ crmSyncedAt: new Date() })
    .where(eq(submissions.id, submissionId));
}

/**
 * Log the confirmed booking on the contact's HubSpot timeline. Idempotent via
 * `bookings.crm_meeting_id`: once stored, repeat calls skip the API entirely.
 * Runs in the booking follow-up job: retryable HubSpot failures throw so the
 * job retries; a failure never unbooks a confirmed meeting.
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
    repEmail: string;
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
    // The meeting belongs to the rep who took it. When the rep has no
    // HubSpot owner record, fall back to the contact's owner.
    const repOwner = await findOwnerByEmail({
      accessToken,
      email: booking.repEmail,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    }).catch(() => null);
    const { meetingId } = await logMeeting({
      accessToken,
      contactId: contact.id,
      title: `${booking.leadName ?? "New meeting"} × ${booking.repName}`,
      startAt: booking.startAt,
      endAt: booking.endAt,
      body: booking.meetLink ? `Meeting link: ${booking.meetLink}` : undefined,
      ownerId: repOwner?.id ?? contact.ownerId,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
    await db
      .update(bookings)
      .set({ crmMeetingId: meetingId })
      .where(eq(bookings.id, booking.id));
    return meetingId;
  } catch (cause) {
    if (cause instanceof HubspotApiError && cause.retryable) throw cause;
    console.error(
      `HubSpot meeting log failed (booking ${booking.id}): ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    return null;
  }
}

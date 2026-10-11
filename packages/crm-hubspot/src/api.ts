/**
 * HubSpot CRM v3 operations over plain `fetch`: contact lookup by email,
 * owner lookup, idempotent contact upsert, and meeting logging (the "logged
 * meeting" write-back). Every call takes a timeout (default ~2s, so a slow
 * portal never stalls a lead) and raises `HubspotApiError` instead of hanging.
 */

import { DEFAULT_TIMEOUT_MS } from "./oauth.js";

export const HUBSPOT_API_BASE = "https://api.hubapi.com";

export class HubspotApiError extends Error {
  /** HTTP status when HubSpot answered; undefined for network failures. */
  readonly status: number | undefined;
  /** Seconds HubSpot asked us to wait (429 `Retry-After`), when given. */
  readonly retryAfterSeconds: number | undefined;

  constructor(
    message: string,
    options: { status?: number; retryAfterSeconds?: number } = {},
  ) {
    super(message);
    this.name = "HubspotApiError";
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }

  /** Worth retrying later: rate limited, HubSpot-side errors, or unreachable. */
  get retryable(): boolean {
    return this.status === undefined || this.status === 429 || this.status >= 500;
  }
}

export type HubspotContact = {
  id: string;
  email: string | null;
  ownerId: string | null;
};

export type HubspotOwner = {
  id: string;
  email: string | null;
  name: string | null;
};

type ContactResponse = {
  id?: string;
  properties?: { email?: string; hubspot_owner_id?: string };
};

type OwnerResponse = {
  id?: number | string;
  email?: string;
  firstName?: string;
  lastName?: string;
};

async function apiRequest<T>(
  options: { path: string } & RequestInit & { accessToken: string; timeoutMs: number },
): Promise<T> {
  const { accessToken, timeoutMs, path, ...rest } = options;
  let response: Response;
  try {
    response = await fetch(`${HUBSPOT_API_BASE}${path}`, {
      ...rest,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        ...rest.headers,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    throw new HubspotApiError(
      `HubSpot API unreachable: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const retryAfter = Number(response.headers.get("retry-after"));
    // The path is left out of the message: contact lookups put the lead's
    // email in it, and these messages end up in logs.
    throw new HubspotApiError(
      `HubSpot API returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      {
        status: response.status,
        retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      },
    );
  }
  return (await response.json().catch(() => null)) as T;
}

/**
 * The contact for an email, or null when HubSpot has none. Uses the `email`
 * secondary ID property so leads are matched the way the form knows them.
 */
export async function findContactByEmail(options: {
  accessToken: string;
  email: string;
  timeoutMs?: number;
}): Promise<HubspotContact | null> {
  const path = `/crm/v3/objects/contacts/${encodeURIComponent(options.email.toLowerCase())}?idProperty=email&properties=email,hubspot_owner_id`;
  try {
    const payload = await apiRequest<ContactResponse>({
      ...options,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      path,
    });
    if (!payload.id) return null;
    return {
      id: payload.id,
      email: payload.properties?.email ?? null,
      ownerId: payload.properties?.hubspot_owner_id ?? null,
    };
  } catch (cause) {
    if (cause instanceof HubspotApiError && cause.status === 404) {
      return null;
    }
    throw cause;
  }
}

function toOwner(payload: OwnerResponse | undefined): HubspotOwner | null {
  if (payload?.id === undefined) return null;
  const name = [payload.firstName, payload.lastName].filter(Boolean).join(" ");
  return {
    id: String(payload.id),
    email: payload.email ?? null,
    name: name || null,
  };
}

/**
 * The HubSpot owner behind `hubspot_owner_id` (their email drives routing).
 * Null when the owner no longer exists; deactivated owners are included so
 * a contact owned by someone who left still resolves (and then simply
 * matches no active rep).
 */
export async function getOwner(options: {
  accessToken: string;
  ownerId: string;
  timeoutMs?: number;
}): Promise<HubspotOwner | null> {
  try {
    const payload = await apiRequest<OwnerResponse>({
      ...options,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      path: `/crm/v3/owners/${encodeURIComponent(options.ownerId)}?idProperty=id&archived=false`,
    });
    return toOwner(payload);
  } catch (cause) {
    if (cause instanceof HubspotApiError && cause.status === 404) return null;
    throw cause;
  }
}

/**
 * The HubSpot owner with this email, or null. Used to put a logged meeting
 * on the rep who actually took it (not on whoever owns the contact).
 */
export async function findOwnerByEmail(options: {
  accessToken: string;
  email: string;
  timeoutMs?: number;
}): Promise<HubspotOwner | null> {
  const query = new URLSearchParams({ email: options.email.toLowerCase(), limit: "1" });
  const payload = await apiRequest<{ results?: OwnerResponse[] }>({
    accessToken: options.accessToken,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    path: `/crm/v3/owners/?${query.toString()}`,
  });
  return toOwner(payload?.results?.[0]);
}

export type UpsertContactInput = {
  accessToken: string;
  email: string;
  properties?: Record<string, string | null>;
  timeoutMs?: number;
};

/**
 * Create-or-update the contact for an email in one call — HubSpot's
 * `batch/upsert` endpoint is idempotent by construction: keyed on
 * `idProperty=email`, a repeat write updates the same contact instead of
 * creating a duplicate. Returns the contact id.
 */
export async function upsertContact(input: UpsertContactInput): Promise<{ id: string }> {
  const email = input.email.toLowerCase();
  const payload = await apiRequest<{ results?: Array<{ id?: string }> }>({
    accessToken: input.accessToken,
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    method: "POST",
    path: "/crm/v3/objects/contacts/batch/upsert",
    body: JSON.stringify({
      inputs: [
        {
          idProperty: "email",
          id: email,
          properties: { email, ...input.properties },
        },
      ],
    }),
  });
  const id = payload?.results?.[0]?.id;
  if (!id) {
    throw new HubspotApiError("HubSpot contact upsert returned no id.");
  }
  return { id };
}

export type LogMeetingInput = {
  accessToken: string;
  contactId: string;
  title: string;
  startAt: Date;
  endAt: Date;
  /** Rep-facing notes; the Meet link lands here when Google created one. */
  body?: string;
  /** HubSpot owner id, when known, so the meeting lands on the right rep. */
  ownerId?: string | null;
  timeoutMs?: number;
};

/**
 * HubSpot-defined association type for "Meeting to contact" (the direction
 * matters: 199 is "Contact to meeting" and is rejected here).
 */
export const MEETING_TO_CONTACT_ASSOCIATION = 200;

/**
 * Log a meeting on the contact's timeline, associated to the contact.
 * Callers keep this idempotent by storing the returned id on the booking and
 * skipping repeat calls (see `apps/web/src/lib/crm.ts`).
 */
export async function logMeeting(input: LogMeetingInput): Promise<{ meetingId: string }> {
  const payload = await apiRequest<{ id?: string }>({
    accessToken: input.accessToken,
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    method: "POST",
    path: "/crm/v3/objects/meetings",
    body: JSON.stringify({
      properties: {
        hs_timestamp: input.startAt.toISOString(),
        hs_meeting_title: input.title,
        ...(input.body ? { hs_meeting_body: input.body } : {}),
        hs_meeting_start_time: input.startAt.toISOString(),
        hs_meeting_end_time: input.endAt.toISOString(),
        ...(input.ownerId ? { hubspot_owner_id: input.ownerId } : {}),
      },
      associations: [
        {
          to: { id: input.contactId },
          types: [
            {
              associationCategory: "HUBSPOT_DEFINED",
              associationTypeId: MEETING_TO_CONTACT_ASSOCIATION,
            },
          ],
        },
      ],
    }),
  });
  if (!payload?.id) {
    throw new HubspotApiError("HubSpot meeting creation returned no id.");
  }
  return { meetingId: payload.id };
}

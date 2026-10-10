/**
 * HubSpot CRM v3 operations over plain `fetch`: contact lookup by email,
 * owner lookup, idempotent contact upsert, and meeting logging (the "logged
 * meeting" write-back). Every call takes a timeout (default ~2s, per the
 * routing brief) and raises `HubspotApiError` instead of hanging.
 */

import { DEFAULT_TIMEOUT_MS } from "./oauth.js";

export const HUBSPOT_API_BASE = "https://api.hubapi.com";

export class HubspotApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HubspotApiError";
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
      `HubSpot API unreachable (${path}): ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new HubspotApiError(
      `HubSpot API returned HTTP ${response.status} for ${path}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
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
    if (cause instanceof HubspotApiError && cause.message.includes("HTTP 404")) {
      return null;
    }
    throw cause;
  }
}

/** The HubSpot owner behind `hubspot_owner_id` (their email drives routing). */
export async function getOwner(options: {
  accessToken: string;
  ownerId: string;
  timeoutMs?: number;
}): Promise<HubspotOwner | null> {
  const payload = await apiRequest<OwnerResponse>({
    ...options,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    path: `/crm/v3/objects/owners/${encodeURIComponent(options.ownerId)}`,
  });
  if (payload.id === undefined) return null;
  const name = [payload.firstName, payload.lastName].filter(Boolean).join(" ");
  return {
    id: String(payload.id),
    email: payload.email ?? null,
    name: name || null,
  };
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
 * creating a duplicate (routing-brief rule 4). Returns the contact id.
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

/** Association type id for HubSpot-defined "Meeting to contact". */
const MEETING_TO_CONTACT_ASSOCIATION = 199;

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

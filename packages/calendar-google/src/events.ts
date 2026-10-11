/**
 * Google Calendar event creation — plain `fetch`. Creates the event on the
 * rep's calendar with a Meet link (`conferenceData`) and the lead as an
 * attendee. Failures raise `GoogleEventError` and the caller degrades (the
 * booking stays confirmed locally and the rep follows up).
 */

import { DEFAULT_TIMEOUT_MS } from "./oauth.js";

export const GOOGLE_EVENTS_ENDPOINT = "https://www.googleapis.com/calendar/v3/calendars";

export class GoogleEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleEventError";
  }
}

export type CalendarEventInput = {
  accessToken: string;
  summary: string;
  start: Date;
  end: Date;
  /** Lead and rep emails to invite; Google emails them the invite. */
  attendeeEmails: string[];
  description?: string;
  calendarId?: string;
  /**
   * Client-chosen event id (base32hex: a–v and 0–9, 5–1024 chars). With an
   * id, a retry after a timeout cannot create a second event: Google answers
   * 409 and the existing event is returned instead.
   */
  eventId?: string;
  timeoutMs?: number;
};

export type CalendarEvent = {
  eventId: string;
  meetLink: string | null;
  htmlLink: string | null;
};

type EventResponse = {
  id?: string;
  hangoutLink?: string;
  htmlLink?: string;
  error?: { message?: string };
};

export async function createCalendarEvent(
  options: CalendarEventInput,
): Promise<CalendarEvent> {
  const calendarId = options.calendarId ?? "primary";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${GOOGLE_EVENTS_ENDPOINT}/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1&sendUpdates=all`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...(options.eventId ? { id: options.eventId } : {}),
        summary: options.summary,
        description: options.description,
        start: { dateTime: options.start.toISOString(), timeZone: "UTC" },
        end: { dateTime: options.end.toISOString(), timeZone: "UTC" },
        attendees: options.attendeeEmails.map((email) => ({ email })),
        conferenceData: {
          createRequest: {
            // Stable per event when the caller supplies an id, so a retried
            // insert does not ask Meet for a second conference.
            requestId: options.eventId ?? crypto.randomUUID(),
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
        reminders: { useDefault: true },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    throw new GoogleEventError(
      `Google Calendar unreachable: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  if (response.status === 409 && options.eventId) {
    // A previous attempt already created this event (e.g. it timed out on
    // our side after Google committed it). Return that one.
    return getCalendarEvent({ ...options, eventId: options.eventId, calendarId });
  }
  const payload = (await response.json().catch(() => null)) as EventResponse | null;
  if (!response.ok || !payload?.id) {
    throw new GoogleEventError(
      payload?.error?.message ?? `Google Calendar event creation returned HTTP ${response.status}.`,
    );
  }
  return {
    eventId: payload.id,
    meetLink: payload.hangoutLink ?? null,
    htmlLink: payload.htmlLink ?? null,
  };
}

/** Read one event (used to recover an event a timed-out insert created). */
export async function getCalendarEvent(options: {
  accessToken: string;
  eventId: string;
  calendarId?: string;
  timeoutMs?: number;
}): Promise<CalendarEvent> {
  const calendarId = options.calendarId ?? "primary";
  const url = `${GOOGLE_EVENTS_ENDPOINT}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(options.eventId)}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { authorization: `Bearer ${options.accessToken}` },
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new GoogleEventError(
      `Google Calendar unreachable: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  const payload = (await response.json().catch(() => null)) as EventResponse | null;
  if (!response.ok || !payload?.id) {
    throw new GoogleEventError(
      payload?.error?.message ?? `Google Calendar event lookup returned HTTP ${response.status}.`,
    );
  }
  return {
    eventId: payload.id,
    meetLink: payload.hangoutLink ?? null,
    htmlLink: payload.htmlLink ?? null,
  };
}

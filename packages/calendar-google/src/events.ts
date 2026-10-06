/**
 * Google Calendar event creation — plain `fetch`, ~2s timeout per the
 * routing brief. Creates the event with a Meet link (`conferenceData`) and
 * the lead as an attendee; failures raise `GoogleApiError` and the caller
 * degrades (booking stays confirmed locally, a plain link goes out by email).
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
        summary: options.summary,
        description: options.description,
        start: { dateTime: options.start.toISOString(), timeZone: "UTC" },
        end: { dateTime: options.end.toISOString(), timeZone: "UTC" },
        attendees: options.attendeeEmails.map((email) => ({ email })),
        conferenceData: {
          createRequest: {
            // Random per call so retries create a fresh conference request.
            requestId: crypto.randomUUID(),
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

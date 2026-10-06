/**
 * Google Calendar free/busy lookup — plain `fetch`, ~2s timeout per the
 * routing brief. Failures raise `GoogleApiError`; the caller degrades
 * gracefully (availability falls back to local bookings only).
 */

import { DEFAULT_TIMEOUT_MS } from "./oauth.js";

export const GOOGLE_FREEBUSY_ENDPOINT =
  "https://www.googleapis.com/calendar/v3/freeBusy";

export class GoogleApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleApiError";
  }
}

export type FreeBusyResult = {
  calendarId: string;
  busy: { start: Date; end: Date }[];
};

type FreeBusyResponse = {
  calendars?: Record<
    string,
    { busy?: { start?: string; end?: string }[]; errors?: { reason?: string }[] }
  >;
  error?: { message?: string };
};

export async function fetchFreeBusy(options: {
  accessToken: string;
  timeMin: Date;
  timeMax: Date;
  calendarId?: string;
  timeoutMs?: number;
}): Promise<FreeBusyResult> {
  const calendarId = options.calendarId ?? "primary";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let response: Response;
  try {
    response = await fetch(GOOGLE_FREEBUSY_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        timeMin: options.timeMin.toISOString(),
        timeMax: options.timeMax.toISOString(),
        items: [{ id: calendarId }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    throw new GoogleApiError(
      `Google free/busy unreachable: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  const payload = (await response.json().catch(() => null)) as FreeBusyResponse | null;
  if (!response.ok) {
    throw new GoogleApiError(
      payload?.error?.message ?? `Google free/busy returned HTTP ${response.status}.`,
    );
  }
  const calendar = payload?.calendars?.[calendarId];
  if (!calendar) {
    throw new GoogleApiError(`Google free/busy response has no "${calendarId}" calendar.`);
  }
  if (calendar.errors?.length) {
    const reason = calendar.errors.map((error) => error.reason ?? "unknown").join(", ");
    throw new GoogleApiError(`Google free/busy calendar error: ${reason}.`);
  }
  const busy = (calendar.busy ?? []).flatMap((interval) =>
    interval.start && interval.end
      ? [{ start: new Date(interval.start), end: new Date(interval.end) }]
      : [],
  );
  return { calendarId, busy };
}

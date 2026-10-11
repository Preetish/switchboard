import {
  DEFAULT_TIMEOUT_MS,
  GoogleApiError,
  GoogleAuthError,
  GoogleEventError,
  createCalendarEvent,
  fetchFreeBusy,
} from "@switchboard/calendar-google";
import { and, eq } from "drizzle-orm";
import { bookings, orgs, users, type Database } from "@switchboard/db";
import { isUuid } from "./http";
import { getGoogleAccessToken, isOfferedSlot } from "./integrations";
import { scheduleBookingFollowup } from "./jobs";
import { findActiveBooking, findRoutedLead } from "./lead-access";
import { smtpConfigured } from "./email";
import { releaseExpiredHolds } from "./holds";

/**
 * Booking creation for a routed lead. The lead may only book the rep routing
 * chose for them, only at a slot that rep actually offers, and only once:
 *
 * 1. The submission must exist and its latest decision must name this rep.
 * 2. A lead with a live booking gets it back (idempotent; one per lead).
 * 3. The start must be on the rep's slot grid inside working hours, after
 *    the lead time and within the horizon.
 * 4. The slot is claimed with a `hold` row; the `bookings_no_overlap`
 *    exclusion constraint makes overlapping claims fail atomically.
 * 5. The rep's Google Calendar is re-checked and the event created (with a
 *    Meet link), then the hold is confirmed. A crash after the hold leaves
 *    the slot reserved until lazy cleanup expires it (~5 minutes). If the
 *    calendar call fails, the booking is still confirmed locally and the
 *    confirmation email carries a plain booking link instead.
 */

const MINUTE_MS = 60_000;

const MIN_DURATION_MINUTES = 15;
const MAX_DURATION_MINUTES = 240;

export type BookingInput = {
  userId: string;
  startAt: Date;
  durationMinutes: number;
  submissionId: string;
  idempotencyKey?: string | null;
};

export type ParsedBookingInput =
  { ok: true; input: BookingInput } | { ok: false; error: string };

/** Validate the API body shape before anything touches the database. */
export function parseBookingInput(body: unknown): ParsedBookingInput {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Expected a JSON body." };
  }
  const raw = body as Record<string, unknown>;
  if (!isUuid(raw.userId)) {
    return { ok: false, error: "userId must be a rep's UUID." };
  }
  if (!isUuid(raw.submissionId)) {
    return { ok: false, error: "submissionId is required (the lead's submission UUID)." };
  }
  const startAt = typeof raw.startAt === "string" ? new Date(raw.startAt) : null;
  if (!startAt || Number.isNaN(startAt.getTime())) {
    return { ok: false, error: "startAt must be an ISO date string." };
  }
  if (
    !Number.isInteger(raw.durationMinutes) ||
    (raw.durationMinutes as number) < MIN_DURATION_MINUTES ||
    (raw.durationMinutes as number) > MAX_DURATION_MINUTES
  ) {
    return {
      ok: false,
      error: `durationMinutes must be an integer between ${MIN_DURATION_MINUTES} and ${MAX_DURATION_MINUTES}.`,
    };
  }
  if (raw.idempotencyKey !== undefined && raw.idempotencyKey !== null) {
    if (typeof raw.idempotencyKey !== "string" || raw.idempotencyKey.length > 128) {
      return {
        ok: false,
        error: "idempotencyKey must be a string of at most 128 characters.",
      };
    }
  }
  return {
    ok: true,
    input: {
      userId: raw.userId,
      startAt,
      durationMinutes: raw.durationMinutes as number,
      submissionId: raw.submissionId,
      idempotencyKey: (raw.idempotencyKey as string | undefined) ?? null,
    },
  };
}

function pgErrorCode(cause: unknown): string | undefined {
  return cause instanceof Error ? (cause as { code?: string }).code : undefined;
}

export type BookingFailure =
  | { status: "not_found"; error: string }
  | { status: "invalid"; error: string }
  | { status: "slot_taken"; error: string };

export type BookingRecord = {
  id: string;
  userId: string;
  startAt: string;
  endAt: string;
  status: "hold" | "confirmed";
  meetLink: string | null;
};

export type BookingSuccess = {
  status: "created";
  duplicate: boolean;
  booking: BookingRecord;
  /** True when the calendar event could not be created (booked locally only). */
  calendarFailed: boolean;
  /** A confirmation email will be sent to the lead. */
  emailQueued: boolean;
  /** A calendar event exists, so the lead got an invite from the rep's calendar. */
  invited: boolean;
};

/** Serialize a stored row into the API shape. */
function toRecord(row: {
  id: string;
  userId: string;
  startAt: Date;
  endAt: Date;
  status: string;
  meetLink: string | null;
}): BookingRecord {
  return {
    id: row.id,
    userId: row.userId,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    status: row.status as "hold" | "confirmed",
    meetLink: row.meetLink,
  };
}

function duplicateOf(
  row: Parameters<typeof toRecord>[0] & { calendarEventId: string | null },
): BookingSuccess {
  return {
    status: "created",
    duplicate: true,
    booking: toRecord(row),
    calendarFailed: false,
    emailQueued: false,
    invited: Boolean(row.calendarEventId),
  };
}

const SLOT_TAKEN: BookingFailure = {
  status: "slot_taken",
  error: "That time was just taken. Pick another one.",
};

export async function createBooking(
  db: Database,
  input: BookingInput,
): Promise<BookingFailure | BookingSuccess> {
  const lead = await findRoutedLead(db, input.submissionId);
  if (!lead) return { status: "not_found", error: "We couldn't find your request." };
  if (lead.repId !== input.userId) {
    return { status: "invalid", error: "That rep isn't available for this request." };
  }

  // One live booking per lead: retries (with or without a key) get it back.
  const existing = await findActiveBooking(db, lead.submissionId);
  if (existing) return duplicateOf(existing);

  const [rep] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      timezone: users.timezone,
      workingHours: users.workingHours,
      orgId: users.orgId,
      orgName: orgs.name,
    })
    .from(users)
    .innerJoin(orgs, eq(users.orgId, orgs.id))
    .where(and(eq(users.id, input.userId), eq(users.orgId, lead.orgId)))
    .limit(1);
  if (!rep) return { status: "not_found", error: "That rep is no longer available." };

  if (
    !isOfferedSlot(
      { timeZone: rep.timezone, workingHours: rep.workingHours },
      input.startAt,
      input.durationMinutes,
    )
  ) {
    return { status: "invalid", error: "That time isn't available. Pick another one." };
  }
  const endAt = new Date(input.startAt.getTime() + input.durationMinutes * MINUTE_MS);
  const leadEmail = lead.email;

  await releaseExpiredHolds(db);

  let hold: typeof bookings.$inferSelect;
  try {
    const rows = await db
      .insert(bookings)
      .values({
        orgId: rep.orgId,
        userId: rep.id,
        submissionId: lead.submissionId,
        decisionId: lead.decisionId,
        startAt: input.startAt,
        endAt,
        status: "hold",
        idempotencyKey: input.idempotencyKey ?? null,
      })
      .returning();
    hold = rows[0]!;
  } catch (cause) {
    const code = pgErrorCode(cause);
    // 23P01: the exclusion constraint — the rep is busy for part of this time.
    if (code === "23P01") return SLOT_TAKEN;
    // 23505: a concurrent request for this lead booked first; return it.
    if (code === "23505") {
      const winner = await findActiveBooking(db, lead.submissionId);
      if (winner) return duplicateOf(winner);
    }
    throw cause;
  }

  const calendar = await reserveCalendar(db, { orgId: rep.orgId, userId: rep.id }, {
    bookingId: hold.id,
    start: input.startAt,
    end: endAt,
    summary: `Meeting with ${rep.name} (${rep.orgName})`,
    description: "Booked via Switchboard.",
    leadEmail,
  });

  if (calendar.slotTaken) {
    // Live free/busy contradicted the slot; release the hold.
    await db.delete(bookings).where(eq(bookings.id, hold.id));
    return SLOT_TAKEN;
  }

  const confirmedRows = await db
    .update(bookings)
    .set({
      status: "confirmed",
      calendarEventId: calendar.eventId,
      meetLink: calendar.meetLink,
    })
    .where(and(eq(bookings.id, hold.id), eq(bookings.status, "hold")))
    .returning();
  const row =
    confirmedRows[0] ??
    // Defensive: the hold was just created and nothing else confirms it.
    (await db.select().from(bookings).where(eq(bookings.id, hold.id)).limit(1))[0];
  if (!row) throw new Error(`Booking row disappeared after confirm: ${hold.id}`);

  // Confirmation email and the CRM meeting log run on the job queue, with
  // retries; a failure there never unbooks the meeting.
  await scheduleBookingFollowup(db, row.id);

  return {
    status: "created",
    duplicate: false,
    booking: toRecord(row),
    calendarFailed: Boolean(calendar.error),
    emailQueued: Boolean(leadEmail) && smtpConfigured(),
    invited: Boolean(calendar.eventId) && Boolean(leadEmail),
  };
}

/**
 * Event creation is a write that emails the lead an invite, so it gets a
 * longer budget than reads, and a deterministic event id derived from the
 * booking: a retry after a timeout finds the event Google already created
 * instead of sending a second invite.
 */
const EVENT_TIMEOUT_MS = 10_000;

/** Google event ids use base32hex (a–v, 0–9); a dashless UUID fits. */
export function googleEventId(bookingId: string): string {
  return `sb${bookingId.replace(/-/g, "").toLowerCase()}`;
}

type CalendarReservation = {
  slotTaken: boolean;
  eventId: string | null;
  meetLink: string | null;
  error?: string;
};

/**
 * Create the Google event for the held slot. A successful free/busy response
 * that shows the slot busy releases the hold (409); a free/busy *failure*
 * degrades — an outage never blocks a booking. Event-creation failure keeps
 * the booking confirmed locally and surfaces the reason for the email
 * fallback.
 */
async function reserveCalendar(
  db: Database,
  rep: { orgId: string; userId: string },
  event: {
    bookingId: string;
    start: Date;
    end: Date;
    summary: string;
    description: string;
    leadEmail: string | null;
  },
): Promise<CalendarReservation> {
  // The rep's own calendar: free/busy re-check and the event both act as them.
  const accessToken = await getGoogleAccessToken(db, rep);
  if (!accessToken) {
    return { slotTaken: false, eventId: null, meetLink: null };
  }

  try {
    const freeBusy = await fetchFreeBusy({
      accessToken,
      timeMin: event.start,
      timeMax: event.end,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
    const clash = freeBusy.busy.some(
      (interval) => event.start < interval.end && interval.start < event.end,
    );
    if (clash) return { slotTaken: true, eventId: null, meetLink: null };
  } catch (cause) {
    console.error(
      `Booking slot re-check against Google failed (booking proceeds): ${
        cause instanceof GoogleApiError || cause instanceof GoogleAuthError
          ? cause.message
          : String(cause)
      }`,
    );
  }

  // The rep organizes the event on their own calendar; the lead is invited.
  const attendees = event.leadEmail ? [event.leadEmail] : [];
  try {
    const created = await createCalendarEvent({
      accessToken,
      summary: event.summary,
      start: event.start,
      end: event.end,
      description: event.description,
      attendeeEmails: attendees,
      eventId: googleEventId(event.bookingId),
      timeoutMs: EVENT_TIMEOUT_MS,
    });
    return { slotTaken: false, eventId: created.eventId, meetLink: created.meetLink };
  } catch (cause) {
    const error =
      cause instanceof GoogleEventError || cause instanceof GoogleApiError
        ? cause.message
        : "Google Calendar event creation failed.";
    console.error(`Booking calendar event failed: ${error}`);
    return { slotTaken: false, eventId: null, meetLink: null, error };
  }
}

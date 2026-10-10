import {
  DEFAULT_TIMEOUT_MS,
  GoogleApiError,
  GoogleAuthError,
  GoogleEventError,
  createCalendarEvent,
  fetchFreeBusy,
} from "@switchboard/calendar-google";
import { and, eq } from "drizzle-orm";
import { bookings, orgs, submissions, users, type Database } from "@switchboard/db";
import { getValidAccessToken } from "./integrations";
import { releaseExpiredHolds } from "./holds";
import { sendConfirmationEmail } from "./email";

/**
 * Booking creation: claim the slot with a short `hold` row (the unique index
 * on `user_id + start_at` makes the claim atomic), create the Google Calendar
 * event with a Meet link, then confirm. A crash after the hold leaves the slot
 * reserved until lazy cleanup expires it (~5 minutes, per the routing brief).
 * If the calendar call fails after ~2s the booking is still confirmed locally
 * and the confirmation email carries a plain booking link instead.
 */

const MINUTE_MS = 60_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_DURATION_MINUTES = 15;
const MAX_DURATION_MINUTES = 240;

export type BookingInput = {
  userId: string;
  startAt: Date;
  durationMinutes: number;
  submissionId?: string | null;
  idempotencyKey?: string | null;
};

export type ParsedBookingInput =
  | { ok: true; input: BookingInput }
  | { ok: false; error: string };

/** Validate the API body shape before anything touches the database. */
export function parseBookingInput(body: unknown): ParsedBookingInput {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Expected a JSON body." };
  }
  const raw = body as Record<string, unknown>;
  if (typeof raw.userId !== "string" || !UUID_RE.test(raw.userId)) {
    return { ok: false, error: "userId must be a rep's UUID." };
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
  if (raw.submissionId !== undefined && raw.submissionId !== null) {
    if (typeof raw.submissionId !== "string" || !UUID_RE.test(raw.submissionId)) {
      return { ok: false, error: "submissionId must be a UUID when provided." };
    }
  }
  if (raw.idempotencyKey !== undefined && raw.idempotencyKey !== null) {
    if (typeof raw.idempotencyKey !== "string" || raw.idempotencyKey.length > 128) {
      return { ok: false, error: "idempotencyKey must be a string of at most 128 characters." };
    }
  }
  return {
    ok: true,
    input: {
      userId: raw.userId,
      startAt,
      durationMinutes: raw.durationMinutes as number,
      submissionId: (raw.submissionId as string | undefined) ?? null,
      idempotencyKey: (raw.idempotencyKey as string | undefined) ?? null,
    },
  };
}

/** Plain booking link offered by email when the calendar event cannot be created. */
export function fallbackBookingUrl(): string | null {
  return process.env.FALLBACK_BOOKING_URL ?? null;
}

function pgUniqueViolation(cause: unknown): boolean {
  return cause instanceof Error && (cause as { code?: string }).code === "23505";
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
  calendarEventId: string | null;
  meetLink: string | null;
};

export type BookingSuccess = {
  status: "created";
  duplicate: boolean;
  booking: BookingRecord;
  calendarError?: string;
  emailSent: boolean;
};

/** Serialize a stored row into the API shape. */
function toRecord(row: {
  id: string;
  userId: string;
  startAt: Date;
  endAt: Date;
  status: string;
  calendarEventId: string | null;
  meetLink: string | null;
}): BookingRecord {
  return {
    id: row.id,
    userId: row.userId,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    status: row.status as "hold" | "confirmed",
    calendarEventId: row.calendarEventId,
    meetLink: row.meetLink,
  };
}

async function findByIdempotencyKey(
  db: Database,
  key: string,
): Promise<BookingSuccess | null> {
  const [row] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.idempotencyKey, key))
    .limit(1);
  return row ? { status: "created", duplicate: true, booking: toRecord(row), emailSent: false } : null;
}

export async function createBooking(
  db: Database,
  input: BookingInput,
): Promise<BookingFailure | BookingSuccess> {
  const [rep] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      timezone: users.timezone,
      orgId: users.orgId,
      orgName: orgs.name,
    })
    .from(users)
    .innerJoin(orgs, eq(users.orgId, orgs.id))
    .where(eq(users.id, input.userId))
    .limit(1);
  if (!rep) return { status: "not_found", error: "Rep not found." };

  const endAt = new Date(input.startAt.getTime() + input.durationMinutes * MINUTE_MS);
  if (input.startAt.getTime() <= Date.now()) {
    return { status: "invalid", error: "The slot start must be in the future." };
  }

  // Lead context for the confirmation email; a submission must belong to the
  // same org as the rep, or the reference is bad — the booking would otherwise
  // carry a dangling FK that fails on insert.
  let leadEmail: string | null = null;
  let leadName: string | null = null;
  if (input.submissionId) {
    const [submission] = await db
      .select({ email: submissions.email, data: submissions.data, orgId: submissions.orgId })
      .from(submissions)
      .where(eq(submissions.id, input.submissionId))
      .limit(1);
    if (!submission || submission.orgId !== rep.orgId) {
      return {
        status: "invalid",
        error: "submissionId does not match a submission in this org.",
      };
    }
    leadEmail = submission.email;
    leadName = typeof submission.data?.name === "string" ? submission.data.name : null;
  }

  // Idempotent retries return the original booking instead of creating a second one.
  if (input.idempotencyKey) {
    const existing = await findByIdempotencyKey(db, input.idempotencyKey);
    if (existing) return existing;
  }

  await releaseExpiredHolds(db);

  let inserted: typeof bookings.$inferSelect | undefined;
  try {
    const rows = await db
      .insert(bookings)
      .values({
        orgId: rep.orgId,
        userId: rep.id,
        submissionId: input.submissionId ?? null,
        startAt: input.startAt,
        endAt,
        status: "hold",
        idempotencyKey: input.idempotencyKey ?? null,
      })
      .returning();
    inserted = rows[0];
  } catch (cause) {
    // Unique violation: either the slot is claimed, or a concurrent request
    // with the same idempotency key already created the booking.
    if (input.idempotencyKey) {
      const existing = await findByIdempotencyKey(db, input.idempotencyKey);
      if (existing) return existing;
    }
    if (pgUniqueViolation(cause)) {
      return { status: "slot_taken", error: "That slot is no longer available." };
    }
    throw cause;
  }
  // The slot is now claimed atomically by the unique index; `inserted` is
  // only ever missing under a conflict handled above.
  const hold = inserted!;

  const calendar = await reserveCalendar(db, rep.orgId, {
    start: input.startAt,
    end: endAt,
    summary: `${rep.orgName} — ${leadName ?? "New meeting"}`,
    description: `Booked via Switchboard (submission ${input.submissionId ?? "n/a"}).`,
    leadEmail,
    repEmail: rep.email,
  });

  if (calendar.slotTaken) {
    // Live free/busy contradicted the stale slot; release the hold.
    await db.delete(bookings).where(eq(bookings.id, hold.id));
    return { status: "slot_taken", error: "That slot is no longer available." };
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
  let row = confirmedRows[0];
  if (!row) {
    // Defensive: the hold cannot expire (it was just created) and nothing
    // else deletes it, so the update always returns the row.
    const reselected = await db.select().from(bookings).where(eq(bookings.id, hold.id)).limit(1);
    row = reselected[0];
  }
  if (!row) throw new Error(`Booking row disappeared after confirm: ${hold.id}`);

  const emailSent = leadEmail
    ? await sendConfirmationEmail({
        to: leadEmail,
        leadName,
        orgName: rep.orgName,
        repName: rep.name,
        repEmail: rep.email,
        startAt: input.startAt,
        repTimeZone: rep.timezone,
        meetLink: calendar.meetLink,
        fallbackUrl: calendar.meetLink ? null : fallbackBookingUrl(),
      })
    : false;

  return {
    status: "created",
    duplicate: false,
    booking: toRecord(row),
    calendarError: calendar.error,
    emailSent,
  };
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
  orgId: string,
  event: {
    start: Date;
    end: Date;
    summary: string;
    description: string;
    leadEmail: string | null;
    repEmail: string;
  },
): Promise<CalendarReservation> {
  const accessToken = await getValidAccessToken(db, orgId);
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

  const attendees = event.leadEmail ? [event.leadEmail, event.repEmail] : [event.repEmail];
  try {
    const created = await createCalendarEvent({
      accessToken,
      summary: event.summary,
      start: event.start,
      end: event.end,
      description: event.description,
      attendeeEmails: attendees,
      timeoutMs: DEFAULT_TIMEOUT_MS,
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

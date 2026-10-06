import { and, eq, lt } from "drizzle-orm";
import { bookings, type Database } from "@switchboard/db";

/**
 * Slot holds: a `hold` booking row claims a slot while the calendar event is
 * created. Holds expire after ~5 minutes (per the routing brief) and are
 * released by lazy cleanup — every reader (availability, booking) deletes the
 * expired ones first, so no background job is needed.
 */

export const HOLD_MINUTES = 5;
const MINUTE_MS = 60_000;

/** Delete holds whose reservation window passed (lazy; runs on read paths). */
export async function releaseExpiredHolds(db: Database): Promise<void> {
  await db
    .delete(bookings)
    .where(
      and(
        eq(bookings.status, "hold"),
        lt(bookings.createdAt, new Date(Date.now() - HOLD_MINUTES * MINUTE_MS)),
      ),
    );
}

/**
 * Slot computation: turn a rep's working hours and busy windows into concrete
 * bookable slots. Pure and I/O-free like the rest of core — the caller passes
 * busy intervals (Google free/busy, existing bookings) in, and gets UTC slot
 * instants back. DST and half-hour offsets are handled by the `Intl`-based
 * wall-time conversion in `tz.ts`.
 */

import type { BusyInterval, WorkingHours } from "./types.js";
import {
  addDaysUtc,
  diffDaysUtc,
  isValidTimeZone,
  wallTimeToUtc,
  zonedParts,
} from "./tz.js";

/** Mon–Fri 09:00–17:00; used when a rep has no stored working hours. */
export const DEFAULT_WORKING_HOURS: WorkingHours = {
  days: [1, 2, 3, 4, 5],
  startMinute: 9 * 60,
  endMinute: 17 * 60,
};

export type SlotOptions = {
  /** IANA time zone the working hours are local to (the rep's zone). */
  timeZone: string;
  /** Defaults to `DEFAULT_WORKING_HOURS` when omitted. */
  workingHours?: WorkingHours;
  /** Earliest allowed slot start (e.g. now + lead time). */
  from: Date;
  /** Latest allowed slot end. */
  to: Date;
  durationMinutes: number;
  /** Time between slot starts; defaults to `durationMinutes`. */
  stepMinutes?: number;
  busy?: BusyInterval[];
};

function assertWorkingHours(hours: WorkingHours): void {
  if (
    !Array.isArray(hours.days) ||
    hours.days.length === 0 ||
    hours.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
  ) {
    throw new Error("workingHours.days must list weekdays as integers 0 (Sun) … 6 (Sat).");
  }
  if (
    !Number.isInteger(hours.startMinute) ||
    !Number.isInteger(hours.endMinute) ||
    hours.startMinute < 0 ||
    hours.endMinute > 24 * 60 ||
    hours.startMinute >= hours.endMinute
  ) {
    throw new Error(
      "workingHours must satisfy 0 <= startMinute < endMinute <= 1440 (overnight shifts are not supported).",
    );
  }
}

function overlapsAny(slot: BusyInterval, busy: BusyInterval[]): boolean {
  return busy.some((interval) => slot.start < interval.end && interval.start < slot.end);
}

/**
 * Compute available slots inside `[from, to]`, walking the rep's local
 * calendar day by day: slots are cut from working hours in the rep's zone,
 * converted to UTC, filtered by the window, and dropped when they overlap a
 * busy interval. Adjacent busy intervals do not conflict (a slot may start
 * exactly when a busy window ends).
 */
export function computeSlots(options: SlotOptions): BusyInterval[] {
  if (!isValidTimeZone(options.timeZone)) {
    throw new Error(`Unknown IANA time zone: ${options.timeZone}`);
  }
  if (!Number.isInteger(options.durationMinutes) || options.durationMinutes <= 0) {
    throw new Error("durationMinutes must be a positive integer.");
  }
  const step = options.stepMinutes ?? options.durationMinutes;
  if (!Number.isInteger(step) || step <= 0) {
    throw new Error("stepMinutes must be a positive integer.");
  }
  if (Number.isNaN(options.from.getTime()) || Number.isNaN(options.to.getTime())) {
    throw new Error("from/to must be valid dates.");
  }
  if (options.from.getTime() > options.to.getTime()) {
    throw new Error("from must not be after to.");
  }
  const hours = options.workingHours ?? DEFAULT_WORKING_HOURS;
  assertWorkingHours(hours);
  const busy = options.busy ?? [];

  const fromLocal = zonedParts(options.from, options.timeZone);
  const toLocal = zonedParts(options.to, options.timeZone);
  const firstDay = { year: fromLocal.year, month: fromLocal.month, day: fromLocal.day };
  const dayCount = diffDaysUtc(firstDay, {
    year: toLocal.year,
    month: toLocal.month,
    day: toLocal.day,
  });

  const slots: BusyInterval[] = [];
  const durationMs = options.durationMinutes * 60_000;
  for (let n = 0; n <= dayCount; n++) {
    const day = addDaysUtc(firstDay, n);
    if (!hours.days.includes(day.weekday)) continue;
    for (
      let startMinute = hours.startMinute;
      startMinute + options.durationMinutes <= hours.endMinute;
      startMinute += step
    ) {
      const start = wallTimeToUtc(day, startMinute, options.timeZone);
      const end = new Date(start.getTime() + durationMs);
      if (start < options.from || end > options.to) continue;
      if (overlapsAny({ start, end }, busy)) continue;
      slots.push({ start, end });
    }
  }
  return slots;
}

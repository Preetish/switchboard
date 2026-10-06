/**
 * Time-zone helpers built on `Intl` — zero dependencies, since Node and
 * browsers both ship the full IANA database. Reps think in wall times, but
 * slots and busy windows must be compared as UTC instants, so every
 * conversion goes through here.
 */

export type ZonedParts = {
  year: number;
  /** 1–12 */
  month: number;
  /** 1–31 */
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** A nominal calendar date, independent of any instant. */
export type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Calendar parts of the instant `at`, as a clock in `timeZone` shows them. */
export function zonedParts(at: Date, timeZone: string): ZonedParts {
  const parts = formatter(timeZone).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value;
    if (value === undefined) {
      throw new Error(`Intl did not return a "${type}" part for time zone ${timeZone}.`);
    }
    return Number(value);
  };
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/**
 * Offset of `timeZone` from UTC (east of UTC positive), in milliseconds, as
 * in effect at the instant `at`.
 */
export function tzOffsetMs(at: Date, timeZone: string): number {
  const parts = zonedParts(at, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * Convert a wall time (what a clock in `timeZone` shows) to a UTC instant.
 * Two passes land on the offset actually in effect, which is what makes DST
 * transitions correct: ambiguous fall-back wall times resolve to their first
 * occurrence. Wall times a spring-forward skips do not exist, so they have no
 * well-defined instant — the result is stable but arbitrary; slot boundaries
 * near working hours are hours away from the 02:00–03:00 transitions, so the
 * slot engine never relies on it.
 */
export function wallTimeToUtc(
  date: CalendarDate,
  minuteOfDay: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    Math.floor(minuteOfDay / 60),
    minuteOfDay % 60,
  );
  const first = guess - tzOffsetMs(new Date(guess), timeZone);
  const second = guess - tzOffsetMs(new Date(first), timeZone);
  return new Date(second);
}

/** Nominal date arithmetic in UTC; `weekday` follows `Date.getUTCDay`. */
export function addDaysUtc(
  date: CalendarDate,
  days: number,
): CalendarDate & { weekday: number } {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

/** Whole days from `a` to `b` (positive when `b` is later), in nominal dates. */
export function diffDaysUtc(a: CalendarDate, b: CalendarDate): number {
  const utcA = Date.UTC(a.year, a.month - 1, a.day);
  const utcB = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((utcB - utcA) / 86_400_000);
}

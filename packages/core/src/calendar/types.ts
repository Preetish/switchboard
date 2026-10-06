/**
 * Calendar types shared by the slot engine, the DB schema, and the Google
 * client — one shape, like `FormField` for forms.
 */

/** Rep working hours; times are local to the rep's timezone. */
export type WorkingHours = {
  /** 0 = Sunday … 6 = Saturday */
  days: number[];
  /** Minutes since midnight, local time. */
  startMinute: number;
  endMinute: number;
};

/** A half-open [start, end) busy window, as a UTC instant. */
export type BusyInterval = {
  start: Date;
  end: Date;
};

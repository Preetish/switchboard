/**
 * Day grouping for bookable slots: bucket UTC slot instants into calendar
 * days as seen in a given IANA zone. Pure and I/O-free — the hosted form
 * groups a rep's slots into the lead's local days before rendering them.
 */

import { zonedParts } from "./tz.js";

/** A bookable slot as a UTC instant pair (the availability API's shape). */
export type SlotInterval = {
  start: string;
  end: string;
};

export type SlotGroup = {
  /** Calendar day in `timeZone`, `YYYY-MM-DD`. */
  dateKey: string;
  /** The day's slots, in input order. */
  slots: SlotInterval[];
};

function dateKey(at: Date, timeZone: string): string {
  const { year, month, day } = zonedParts(at, timeZone);
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * Group slots into day buckets in `timeZone`, preserving slot order and
 * emitting only days that have at least one slot. Invalid slot or zone
 * inputs throw (RangeError) rather than silently dropping slots.
 */
export function groupSlotsByDay(slots: SlotInterval[], timeZone: string): SlotGroup[] {
  const groups: SlotGroup[] = [];
  const byKey = new Map<string, SlotGroup>();
  for (const slot of slots) {
    const at = new Date(slot.start);
    if (Number.isNaN(at.getTime())) {
      throw new RangeError(`Invalid slot start: ${slot.start}`);
    }
    const key = dateKey(at, timeZone);
    let group = byKey.get(key);
    if (!group) {
      group = { dateKey: key, slots: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.slots.push(slot);
  }
  return groups;
}

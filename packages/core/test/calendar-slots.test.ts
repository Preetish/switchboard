import { describe, expect, it } from "vitest";
import { computeSlots, type BusyInterval } from "../src/index.js";

const NYC = "America/New_York";

/** All slots on 2025-03-10 (a Monday, EDT), 09:00–17:00 local, 30 minutes. */
function slotsFor(
  overrides: Partial<Parameters<typeof computeSlots>[0]> = {},
): BusyInterval[] {
  return computeSlots({
    timeZone: NYC,
    from: new Date("2025-03-10T00:00:00Z"),
    to: new Date("2025-03-10T23:59:00Z"),
    durationMinutes: 30,
    ...overrides,
  });
}

function busy(isoStart: string, isoEnd: string): BusyInterval {
  return { start: new Date(isoStart), end: new Date(isoEnd) };
}

function startsOf(slots: BusyInterval[]): string[] {
  return slots.map((slot) => slot.start.toISOString());
}

describe("computeSlots", () => {
  it("cuts working hours into default-duration slots in the rep's zone", () => {
    const slots = slotsFor();
    expect(slots).toHaveLength(16); // 8 hours / 0.5 h
    // 09:00 EDT = 13:00Z; 16:30 EDT = 20:30Z.
    expect(startsOf(slots)[0]).toBe("2025-03-10T13:00:00.000Z");
    expect(startsOf(slots)[15]).toBe("2025-03-10T20:30:00.000Z");
    const last = slots[15]!;
    expect(last.end.toISOString()).toBe("2025-03-10T21:00:00.000Z");
  });

  it("shifts UTC offsets across a DST transition inside one window", () => {
    // Fri Mar 7 (EST, -5) through Mon Mar 10 (EDT, -4).
    const slots = computeSlots({
      timeZone: NYC,
      from: new Date("2025-03-07T00:00:00Z"),
      to: new Date("2025-03-10T23:59:00Z"),
      durationMinutes: 60,
    });
    expect(slots).toHaveLength(16);
    expect(startsOf(slots)[0]).toBe("2025-03-07T14:00:00.000Z"); // 09:00 EST
    expect(startsOf(slots)[8]).toBe("2025-03-10T13:00:00.000Z"); // 09:00 EDT
  });

  it("skips non-working weekdays", () => {
    // 2025-03-08 Sat and 2025-03-09 Sun; window also spans Mon.
    const slots = computeSlots({
      timeZone: NYC,
      from: new Date("2025-03-08T00:00:00Z"),
      to: new Date("2025-03-10T23:59:00Z"),
      durationMinutes: 30,
    });
    expect(new Set(slots.map((s) => s.start.getUTCDate()))).toEqual(new Set([10]));
  });

  it("honors custom working days and minutes", () => {
    const slots = slotsFor({
      workingHours: { days: [1], startMinute: 11 * 60 + 30, endMinute: 13 * 60 + 30 },
      durationMinutes: 60,
      stepMinutes: 60,
    });
    expect(startsOf(slots)).toEqual([
      "2025-03-10T15:30:00.000Z",
      "2025-03-10T16:30:00.000Z",
    ]);
  });

  it("uses stepMinutes shorter than the duration", () => {
    const slots = slotsFor({ durationMinutes: 60, stepMinutes: 30 });
    // Starts 09:00 … 16:00 local (16:00 + 60 <= 17:00), every 30 minutes.
    expect(slots).toHaveLength(15);
    expect(startsOf(slots)[1]).toBe("2025-03-10T13:30:00.000Z");
  });

  it("drops slots before `from` (lead time) and after `to`", () => {
    const slots = slotsFor({ from: new Date("2025-03-10T14:45:00Z") });
    expect(startsOf(slots)[0]).toBe("2025-03-10T15:00:00.000Z"); // 11:00 EDT

    const bounded = slotsFor({ to: new Date("2025-03-10T16:00:00Z") });
    const last = bounded[bounded.length - 1]!;
    expect(last.end.toISOString()).toBe("2025-03-10T16:00:00.000Z"); // 12:00 EDT
  });

  it("removes slots overlapping busy intervals, keeping adjacency", () => {
    const slots = slotsFor({
      busy: [busy("2025-03-10T13:30:00Z", "2025-03-10T14:30:00Z")],
    });
    const starts = startsOf(slots);
    expect(starts).not.toContain("2025-03-10T13:30:00.000Z");
    expect(starts).not.toContain("2025-03-10T14:00:00.000Z");
    // Adjacent on both sides: 13:00 ends exactly when busy starts; 14:30 starts when it ends.
    expect(starts).toContain("2025-03-10T13:00:00.000Z");
    expect(starts).toContain("2025-03-10T14:30:00.000Z");
    expect(slots).toHaveLength(14);
  });

  it("supports a busy interval spanning multiple slots", () => {
    const slots = slotsFor({
      busy: [busy("2025-03-10T14:00:00Z", "2025-03-10T18:00:00Z")],
    });
    // 13:00/13:30 survive before the block; 18:00–20:30 survive after it.
    expect(startsOf(slots)).toEqual([
      "2025-03-10T13:00:00.000Z",
      "2025-03-10T13:30:00.000Z",
      "2025-03-10T18:00:00.000Z",
      "2025-03-10T18:30:00.000Z",
      "2025-03-10T19:00:00.000Z",
      "2025-03-10T19:30:00.000Z",
      "2025-03-10T20:00:00.000Z",
      "2025-03-10T20:30:00.000Z",
    ]);
  });

  it("computes slots in a half-hour-offset zone at the right UTC instants", () => {
    const slots = computeSlots({
      timeZone: "Asia/Kolkata",
      from: new Date("2025-06-02T00:00:00Z"),
      to: new Date("2025-06-02T23:59:00Z"),
      durationMinutes: 30,
    });
    // 09:00 IST = 03:30Z, first slot of a Monday.
    expect(startsOf(slots)[0]).toBe("2025-06-02T03:30:00.000Z");
    expect(slots).toHaveLength(16);
  });

  it("maps a rep-local day onto the previous UTC day (Auckland)", () => {
    const slots = computeSlots({
      timeZone: "Pacific/Auckland",
      from: new Date("2025-04-01T00:00:00Z"),
      to: new Date("2025-04-08T23:59:00Z"),
      durationMinutes: 60,
    });
    // Mon Apr 7 09:00 NZST (+12) is Apr 6 21:00Z — inside the window because
    // `from`/`to` are instants, not local dates.
    expect(startsOf(slots).some((start) => start === "2025-04-06T21:00:00.000Z")).toBe(
      true,
    );
  });

  it("returns no slots when working hours cannot fit the duration", () => {
    expect(
      slotsFor({ workingHours: { days: [1], startMinute: 9 * 60, endMinute: 9 * 60 + 25 } }),
    ).toEqual([]);
  });

  it("returns no slots for an empty or fully busy window", () => {
    // Tuesday window, but the rep only works Mondays.
    expect(
      computeSlots({
        timeZone: NYC,
        workingHours: { days: [1], startMinute: 9 * 60, endMinute: 17 * 60 },
        from: new Date("2025-03-11T00:00:00Z"),
        to: new Date("2025-03-11T23:59:00Z"),
        durationMinutes: 30,
      }),
    ).toEqual([]);
    expect(slotsFor({ busy: [busy("2025-03-10T13:00:00Z", "2025-03-10T21:00:00Z")] })).toEqual(
      [],
    );
  });

  it("rejects invalid configuration with clear errors", () => {
    expect(() => slotsFor({ timeZone: "Mars/Olympus" })).toThrow(/Unknown IANA time zone/);
    expect(() => slotsFor({ durationMinutes: 0 })).toThrow(/durationMinutes/);
    expect(() => slotsFor({ stepMinutes: -5 })).toThrow(/stepMinutes/);
    expect(() =>
      slotsFor({ from: new Date("2025-03-11T00:00:00Z"), to: new Date("2025-03-10T00:00:00Z") }),
    ).toThrow(/from must not be after to/);
    expect(() =>
      slotsFor({ workingHours: { days: [], startMinute: 0, endMinute: 60 } }),
    ).toThrow(/days/);
    expect(() =>
      slotsFor({ workingHours: { days: [1], startMinute: 17 * 60, endMinute: 9 * 60 } }),
    ).toThrow(/workingHours/);
    expect(() =>
      slotsFor({ workingHours: { days: [1], startMinute: -1, endMinute: 9 * 60 } }),
    ).toThrow(/workingHours/);
  });

  it("defaults working hours to Mon–Fri 09:00–17:00 when omitted", () => {
    const slots = computeSlots({
      timeZone: NYC,
      from: new Date("2025-03-10T00:00:00Z"),
      to: new Date("2025-03-10T23:59:00Z"),
      durationMinutes: 240,
    });
    expect(startsOf(slots)).toEqual([
      "2025-03-10T13:00:00.000Z",
      "2025-03-10T17:00:00.000Z",
    ]);
  });
});

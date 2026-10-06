import { describe, expect, it } from "vitest";
import {
  addDaysUtc,
  diffDaysUtc,
  isValidTimeZone,
  tzOffsetMs,
  wallTimeToUtc,
  zonedParts,
} from "../src/index.js";

describe("time-zone helpers", () => {
  it("recognizes valid and invalid IANA zones", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("reads calendar parts of an instant in a zone", () => {
    // 2025-03-10T13:00:00Z is 09:00 in New York (EDT) but 14:00 in Berlin.
    const at = new Date("2025-03-10T13:00:00Z");
    expect(zonedParts(at, "America/New_York")).toEqual({
      year: 2025,
      month: 3,
      day: 10,
      hour: 9,
      minute: 0,
      second: 0,
    });
    expect(zonedParts(at, "Europe/Berlin").hour).toBe(14);
  });

  it("computes offsets, including half-hour zones", () => {
    const winter = new Date("2025-01-15T12:00:00Z");
    expect(tzOffsetMs(winter, "UTC")).toBe(0);
    expect(tzOffsetMs(winter, "America/New_York")).toBe(-5 * 3600_000);
    expect(tzOffsetMs(winter, "Asia/Kolkata")).toBe(5.5 * 3600_000);
    expect(tzOffsetMs(winter, "Pacific/Auckland")).toBe(13 * 3600_000);
  });

  it("converts wall time to UTC across DST spring-forward (New York)", () => {
    // Fri Mar 7 2025 is EST (-5); Mon Mar 10 2025 is EDT (-4).
    expect(
      wallTimeToUtc({ year: 2025, month: 3, day: 7 }, 9 * 60, "America/New_York"),
    ).toEqual(new Date("2025-03-07T14:00:00Z"));
    expect(
      wallTimeToUtc({ year: 2025, month: 3, day: 10 }, 9 * 60, "America/New_York"),
    ).toEqual(new Date("2025-03-10T13:00:00Z"));
  });

  it("converts wall time to UTC across DST fall-back (New York)", () => {
    // Fri Oct 31 2025 is EDT (-4); Mon Nov 3 2025 is EST (-5).
    expect(
      wallTimeToUtc({ year: 2025, month: 10, day: 31 }, 9 * 60, "America/New_York"),
    ).toEqual(new Date("2025-10-31T13:00:00Z"));
    expect(
      wallTimeToUtc({ year: 2025, month: 11, day: 3 }, 9 * 60, "America/New_York"),
    ).toEqual(new Date("2025-11-03T14:00:00Z"));
  });

  it("handles southern-hemisphere DST (Auckland, opposite season)", () => {
    // NZDT (+13) until Apr 6 2025, then NZST (+12); the UTC date moves a day.
    expect(
      wallTimeToUtc({ year: 2025, month: 3, day: 31 }, 9 * 60, "Pacific/Auckland"),
    ).toEqual(new Date("2025-03-30T20:00:00Z"));
    expect(
      wallTimeToUtc({ year: 2025, month: 4, day: 7 }, 9 * 60, "Pacific/Auckland"),
    ).toEqual(new Date("2025-04-06T21:00:00Z"));
  });

  it("resolves spring-forward gap wall times to a stable nearby instant", () => {
    // 02:30 does not exist on 2025-03-09 in New York; the result is stable
    // but has no well-defined answer, and slot boundaries (working hours are
    // 09:00+) never come near the 02:00–03:00 transition.
    expect(
      wallTimeToUtc({ year: 2025, month: 3, day: 9 }, 2 * 60 + 30, "America/New_York"),
    ).toEqual(new Date("2025-03-09T06:30:00Z"));
  });

  it("picks the first occurrence of an ambiguous fall-back wall time", () => {
    // 01:30 happens twice on 2025-11-02; EDT (-4) comes first.
    expect(
      wallTimeToUtc({ year: 2025, month: 11, day: 2 }, 1 * 60 + 30, "America/New_York"),
    ).toEqual(new Date("2025-11-02T05:30:00Z"));
  });

  it("round-trips zoned parts back to the same minute (seconds are dropped)", () => {
    const zones = ["America/Los_Angeles", "Asia/Kolkata", "Australia/Lord_Howe"];
    const at = new Date("2026-06-15T03:27:11Z");
    for (const zone of zones) {
      const parts = zonedParts(at, zone);
      const ms = wallTimeToUtc(
        { year: parts.year, month: parts.month, day: parts.day },
        parts.hour * 60 + parts.minute,
        zone,
      );
      expect(ms.toISOString()).toBe(
        new Date(Math.floor(at.getTime() / 60_000) * 60_000).toISOString(),
      );
    }
  });

  it("does nominal date arithmetic without DST interference", () => {
    expect(addDaysUtc({ year: 2025, month: 3, day: 8 }, 1)).toEqual({
      year: 2025,
      month: 3,
      day: 9,
      weekday: 0,
    });
    expect(addDaysUtc({ year: 2025, month: 12, day: 31 }, 1)).toEqual({
      year: 2026,
      month: 1,
      day: 1,
      weekday: 4,
    });
    expect(diffDaysUtc({ year: 2025, month: 3, day: 7 }, { year: 2025, month: 3, day: 14 })).toBe(
      7,
    );
    expect(diffDaysUtc({ year: 2025, month: 3, day: 14 }, { year: 2025, month: 3, day: 7 })).toBe(
      -7,
    );
  });
});

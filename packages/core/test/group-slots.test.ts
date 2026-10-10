import { describe, expect, it } from "vitest";
import { groupSlotsByDay } from "../src/index.js";

const slot = (start: string): { start: string; end: string } => ({
  start,
  end: new Date(new Date(start).getTime() + 30 * 60_000).toISOString(),
});

describe("groupSlotsByDay", () => {
  it("groups slots into day buckets in the given zone", () => {
    // 08:00 and 09:30 UTC are both 10:00/11:30 in Nairobi (UTC+3): same day.
    const groups = groupSlotsByDay(
      [slot("2026-03-02T08:00:00Z"), slot("2026-03-02T09:30:00Z")],
      "Africa/Nairobi",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.dateKey).toBe("2026-03-02");
    expect(groups[0]?.slots).toHaveLength(2);
  });

  it("splits slots that fall on different zoned days", () => {
    // 03:00 UTC is 22:00 the previous day in New York (EST, UTC-5);
    // 05:00 UTC is 00:00, already the next local day.
    const groups = groupSlotsByDay(
      [slot("2026-03-03T03:00:00Z"), slot("2026-03-03T05:00:00Z")],
      "America/New_York",
    );
    expect(groups.map((group) => group.dateKey)).toEqual(["2026-03-02", "2026-03-03"]);
    expect(groups[0]?.slots).toHaveLength(1);
    expect(groups[1]?.slots).toHaveLength(1);
  });

  it("buckets by the zone's local day across a DST boundary", () => {
    // 2026-03-08 is the US spring-forward day: 02:00 does not exist in New
    // York, but 06:00Z (01:00 EST) and 07:00Z (03:00 EDT) are both March 8.
    const groups = groupSlotsByDay(
      [slot("2026-03-08T06:00:00Z"), slot("2026-03-08T07:00:00Z")],
      "America/New_York",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.dateKey).toBe("2026-03-08");
  });

  it("emits only days that have slots, preserving order", () => {
    const groups = groupSlotsByDay(
      [
        slot("2026-03-02T09:00:00Z"),
        slot("2026-03-04T09:00:00Z"),
        slot("2026-03-04T11:00:00Z"),
        slot("2026-03-05T09:00:00Z"),
      ],
      "UTC",
    );
    expect(groups.map((group) => group.dateKey)).toEqual([
      "2026-03-02",
      "2026-03-04",
      "2026-03-05",
    ]);
    expect(groups[1]?.slots.map((s) => s.start)).toEqual([
      "2026-03-04T09:00:00Z",
      "2026-03-04T11:00:00Z",
    ]);
  });

  it("returns an empty list for empty input", () => {
    expect(groupSlotsByDay([], "UTC")).toEqual([]);
  });

  it("throws on an invalid slot instant instead of dropping it", () => {
    expect(() => groupSlotsByDay([slot("not-a-date")], "UTC")).toThrow(RangeError);
  });

  it("throws on an invalid time zone", () => {
    expect(() => groupSlotsByDay([slot("2026-03-02T09:00:00Z")], "Mars/Olympus")).toThrow(
      RangeError,
    );
  });
});

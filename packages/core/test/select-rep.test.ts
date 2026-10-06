import { describe, expect, it } from "vitest";
import { selectRep, type RepCandidate } from "../src/strategies/select-rep.js";

function member(overrides: Partial<RepCandidate> & { userId: string }): RepCandidate {
  return {
    weight: 1,
    weeklyCapacity: 0,
    bookingsThisWeek: 0,
    assignments: 0,
    available: true,
    ...overrides,
  };
}

const A = member({ userId: "a" });
const B = member({ userId: "b" });
const C = member({ userId: "c" });

describe("selectRep — round_robin", () => {
  it("picks the only eligible rep", () => {
    expect(selectRep("round_robin", [A]).userId).toBe("a");
  });

  it("rotates evenly when all weights are equal", () => {
    const members = [A, B, C];
    const picks: string[] = [];
    for (let i = 0; i < 6; i++) {
      const pick = selectRep("round_robin", members);
      if (!pick.userId) throw new Error("expected a pick");
      picks.push(pick.userId);
      members.find((m) => m.userId === pick.userId)!.assignments += 1;
    }
    expect(picks).toEqual(["a", "b", "c", "a", "b", "c"]);
  });

  it("gives a weight-2 rep about twice the turns of a weight-1 rep", () => {
    const heavy = member({ userId: "heavy", weight: 2 });
    const light = member({ userId: "light", weight: 1 });
    const counts: Record<string, number> = { heavy: 0, light: 0 };
    for (let i = 0; i < 6; i++) {
      const pick = selectRep("round_robin", [heavy, light]);
      if (!pick.userId) throw new Error("expected a pick");
      counts[pick.userId] += 1;
      (pick.userId === "heavy" ? heavy : light).assignments += 1;
    }
    expect(counts).toEqual({ heavy: 4, light: 2 });
  });

  it("skips reps at weekly capacity", () => {
    const full = member({ userId: "full", weeklyCapacity: 5, bookingsThisWeek: 5 });
    expect(selectRep("round_robin", [full, B]).userId).toBe("b");
  });

  it("treats capacity 0 as unlimited", () => {
    const busy = member({ userId: "busy", weeklyCapacity: 0, bookingsThisWeek: 999 });
    expect(selectRep("round_robin", [busy]).userId).toBe("busy");
  });

  it("skips inactive or unavailable reps", () => {
    const ooo = member({ userId: "ooo", available: false });
    expect(selectRep("round_robin", [ooo, B]).userId).toBe("b");
  });

  it("returns null when nobody is eligible", () => {
    const full = member({ userId: "full", weeklyCapacity: 1, bookingsThisWeek: 1 });
    const pick = selectRep("round_robin", [
      full,
      member({ userId: "off", available: false }),
    ]);
    expect(pick.userId).toBeNull();
    expect(pick.reason).toContain("No eligible rep");
  });

  it("returns null for an empty team", () => {
    const pick = selectRep("round_robin", []);
    expect(pick.userId).toBeNull();
    expect(pick.reason).toContain("no members");
  });

  it("treats a non-positive weight as 1", () => {
    const zero = member({ userId: "zero", weight: 0, assignments: 1 });
    const one = member({ userId: "one", weight: 1, assignments: 1 });
    // zero-weighted is normalized to 1, so the tie is broken by caller order.
    expect(selectRep("round_robin", [zero, one]).userId).toBe("zero");
  });

  it("breaks ties by caller order", () => {
    expect(selectRep("round_robin", [B, A]).userId).toBe("b");
    expect(selectRep("round_robin", [A, B]).userId).toBe("a");
  });
});

describe("selectRep — existing_owner", () => {
  it("sends the lead to the eligible owner", () => {
    const pick = selectRep("existing_owner", [A, B], "b");
    expect(pick.userId).toBe("b");
    expect(pick.reason).toContain("owner");
  });

  it("falls back to round robin when the owner is at capacity", () => {
    const ownerAtCapacity = member({
      userId: "owner",
      weeklyCapacity: 3,
      bookingsThisWeek: 3,
    });
    const pick = selectRep("existing_owner", [ownerAtCapacity, C], "owner");
    expect(pick.userId).toBe("c");
    expect(pick.reason).toContain("round robin");
  });

  it("falls back to round robin when the owner is inactive", () => {
    const ownerOff = member({ userId: "owner", available: false });
    expect(selectRep("existing_owner", [ownerOff, C], "owner").userId).toBe("c");
  });

  it("falls back to round robin when the owner is not on the team", () => {
    expect(selectRep("existing_owner", [A, B], "zzz").userId).toBe("a");
  });

  it("returns null when the owner is unavailable and nobody else is eligible", () => {
    const ownerOff = member({ userId: "owner", available: false });
    const pick = selectRep("existing_owner", [ownerOff], "owner");
    expect(pick.userId).toBeNull();
    expect(pick.reason).toContain("fallback");
  });

  it("behaves as round robin when no owner id is supplied", () => {
    expect(selectRep("existing_owner", [A, B]).userId).toBe("a");
  });
});

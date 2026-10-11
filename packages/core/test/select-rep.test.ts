import { describe, expect, it } from "vitest";
import { selectRep, type RepCandidate } from "../src/strategies/select-rep.js";

function member(overrides: Partial<RepCandidate> & { userId: string }): RepCandidate {
  return {
    weight: 1,
    weeklyCapacity: 0,
    bookingsThisWeek: 0,
    credit: 0,
    available: true,
    ...overrides,
  };
}

const A = member({ userId: "a" });
const B = member({ userId: "b" });
const C = member({ userId: "c" });

/** Run `n` picks, persisting credits between them like the app does. */
function rotate(members: RepCandidate[], n: number): string[] {
  const picks: string[] = [];
  for (let i = 0; i < n; i++) {
    const pick = selectRep("round_robin", members);
    if (!pick.userId) throw new Error("expected a pick");
    picks.push(pick.userId);
    for (const m of members) m.credit = pick.credits?.get(m.userId) ?? m.credit;
  }
  return picks;
}

describe("selectRep — round_robin", () => {
  it("picks the only eligible rep", () => {
    expect(selectRep("round_robin", [A]).userId).toBe("a");
  });

  it("rotates evenly when all weights are equal", () => {
    const members = [member({ userId: "a" }), member({ userId: "b" }), member({ userId: "c" })];
    expect(rotate(members, 6)).toEqual(["a", "b", "c", "a", "b", "c"]);
  });

  it("gives a weight-2 rep exactly twice the turns, interleaved", () => {
    const members = [member({ userId: "heavy", weight: 2 }), member({ userId: "light" })];
    const picks = rotate(members, 6);
    expect(picks.filter((p) => p === "heavy")).toHaveLength(4);
    expect(picks).toEqual(["heavy", "light", "heavy", "heavy", "light", "heavy"]);
  });

  it("gives a newly added rep a fair share instead of a catch-up flood", () => {
    const veterans = [member({ userId: "a" }), member({ userId: "b" })];
    rotate(veterans, 301); // long history: credits stay bounded, not 300 assignments
    const team = [...veterans, member({ userId: "new" })];
    const next = rotate(team, 9);
    expect(next.filter((p) => p === "new")).toHaveLength(3);
  });

  it("keeps the total credit of eligible reps at zero", () => {
    const members = [member({ userId: "a", weight: 3 }), member({ userId: "b" }), member({ userId: "c", weight: 2 })];
    rotate(members, 50);
    expect(members.reduce((sum, m) => sum + m.credit, 0)).toBe(0);
  });

  it("does not spend a rotation turn when the owner wins", () => {
    expect(selectRep("existing_owner", [A, B], "b").credits).toBeNull();
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
    const zero = member({ userId: "zero", weight: 0 });
    const one = member({ userId: "one", weight: 1 });
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

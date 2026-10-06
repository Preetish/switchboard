/**
 * Team rep selection. Pure and I/O-free like the rest of core: the caller
 * supplies each member's load counters (assignment history from
 * `routing_decisions`, bookings this week from `bookings`) and availability,
 * and the function only picks.
 */

export type RepCandidate = {
  userId: string;
  /** Relative share of round-robin turns; non-positive weights count as 1. */
  weight: number;
  /** Max bookings per week; 0 means unlimited. */
  weeklyCapacity: number;
  /** Bookings already held in the current week. */
  bookingsThisWeek: number;
  /** Total past routing decisions that landed on this rep (rotation state). */
  assignments: number;
  /** Active membership; OOO / no calendar availability is folded in here. */
  available: boolean;
};

export type RepSelection =
  { userId: string; reason: string } | { userId: null; reason: string };

function eligible(member: RepCandidate): boolean {
  if (!member.available) return false;
  if (member.weeklyCapacity > 0 && member.bookingsThisWeek >= member.weeklyCapacity)
    return false;
  return true;
}

/**
 * Smooth weighted round robin: the eligible rep with the lowest
 * `assignments / weight` is next, so weight 2 gets roughly twice the turns.
 * Ties go to the first member in caller order (sort members deterministically
 * before calling, e.g. by email).
 */
function roundRobin(members: RepCandidate[]): RepCandidate | null {
  const pool = members.filter(eligible);
  const first = pool[0];
  if (!first) return null;
  let best = first;
  for (const member of pool.slice(1)) {
    if (
      member.assignments / normWeight(member.weight) <
      best.assignments / normWeight(best.weight)
    ) {
      best = member;
    }
  }
  return best;
}

function normWeight(weight: number): number {
  return weight > 0 ? weight : 1;
}

/**
 * Pick the rep a team route lands on. `existing_owner` sends the lead to the
 * CRM owner when they are on the team and eligible, and falls back to
 * round-robin otherwise so a missing or busy owner never drops a lead.
 */
export function selectRep(
  strategy: "round_robin" | "existing_owner",
  members: RepCandidate[],
  ownerUserId?: string,
): RepSelection {
  if (members.length === 0) {
    return { userId: null, reason: "Team has no members; sent to the fallback queue." };
  }
  if (strategy === "existing_owner" && ownerUserId) {
    const owner = members.find((m) => m.userId === ownerUserId);
    if (owner && eligible(owner)) {
      return { userId: owner.userId, reason: "Existing owner wins." };
    }
    const picked = roundRobin(members);
    return picked
      ? {
          userId: picked.userId,
          reason: "Existing owner unavailable; round robin picked the rep.",
        }
      : {
          userId: null,
          reason:
            "Existing owner unavailable; no eligible rep left; sent to the fallback queue.",
        };
  }
  const picked = roundRobin(members);
  if (!picked) {
    return {
      userId: null,
      reason: "No eligible rep (capacity or availability); sent to the fallback queue.",
    };
  }
  return {
    userId: picked.userId,
    reason: `Round robin picked the rep (weight ${normWeight(picked.weight)}, ${picked.assignments} past assignments).`,
  };
}

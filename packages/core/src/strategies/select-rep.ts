/**
 * Team rep selection. Pure and I/O-free like the rest of core: the caller
 * supplies each member's rotation credit (persisted on the membership),
 * load counters, and availability, then stores the returned credits.
 */

export type RepCandidate = {
  userId: string;
  /** Relative share of round-robin turns; non-positive weights count as 1. */
  weight: number;
  /** Max bookings per week; 0 means unlimited. */
  weeklyCapacity: number;
  /** Bookings (held or confirmed) already in the current week. */
  bookingsThisWeek: number;
  /**
   * Smooth weighted round-robin credit, persisted per team membership. New
   * members start at 0 and get their fair share immediately — no catch-up
   * flood, and deleted leads never rewind the rotation.
   */
  credit: number;
  /** Active membership; OOO / offboarding is folded in here. */
  available: boolean;
};

export type RepSelection =
  | {
      userId: string;
      reason: string;
      /** New credits to persist (only when round robin made the pick). */
      credits: Map<string, number> | null;
    }
  | { userId: null; reason: string; credits: null };

function eligible(member: RepCandidate): boolean {
  if (!member.available) return false;
  if (member.weeklyCapacity > 0 && member.bookingsThisWeek >= member.weeklyCapacity)
    return false;
  return true;
}

function normWeight(weight: number): number {
  return weight > 0 ? weight : 1;
}

/**
 * Smooth weighted round robin (the nginx algorithm): every eligible rep
 * earns their weight in credit, the richest rep is picked, and pays back the
 * total. Weight 2 gets exactly twice the turns of weight 1, interleaved
 * (a, b, a, a, b, a…) rather than in bursts. Ties go to caller order (sort
 * members deterministically, e.g. by email). Ineligible reps neither earn
 * nor pay, so a rep back from capacity rejoins at their old place.
 */
function roundRobin(
  members: RepCandidate[],
): { picked: RepCandidate; credits: Map<string, number> } | null {
  const pool = members.filter(eligible);
  if (pool.length === 0) return null;
  const total = pool.reduce((sum, member) => sum + normWeight(member.weight), 0);
  const credits = new Map<string, number>();
  let picked = pool[0]!;
  let best = -Infinity;
  for (const member of pool) {
    const credit = member.credit + normWeight(member.weight);
    credits.set(member.userId, credit);
    if (credit > best) {
      best = credit;
      picked = member;
    }
  }
  credits.set(picked.userId, credits.get(picked.userId)! - total);
  return { picked, credits };
}

/**
 * Pick the rep a team route lands on. `existing_owner` sends the lead to the
 * CRM owner when they are on the team and eligible (without spending a
 * rotation turn), and falls back to round robin otherwise so a missing or
 * busy owner never drops a lead.
 */
export function selectRep(
  strategy: "round_robin" | "existing_owner",
  members: RepCandidate[],
  ownerUserId?: string,
): RepSelection {
  if (members.length === 0) {
    return {
      userId: null,
      reason: "Team has no members; sent to the fallback queue.",
      credits: null,
    };
  }
  if (strategy === "existing_owner" && ownerUserId) {
    const owner = members.find((m) => m.userId === ownerUserId);
    if (owner && eligible(owner)) {
      return { userId: owner.userId, reason: "Existing owner wins.", credits: null };
    }
    const result = roundRobin(members);
    return result
      ? {
          userId: result.picked.userId,
          reason: "Existing owner unavailable; round robin picked the rep.",
          credits: result.credits,
        }
      : {
          userId: null,
          reason:
            "Existing owner unavailable; no eligible rep left; sent to the fallback queue.",
          credits: null,
        };
  }
  const result = roundRobin(members);
  if (!result) {
    return {
      userId: null,
      reason: "No eligible rep (capacity or availability); sent to the fallback queue.",
      credits: null,
    };
  }
  return {
    userId: result.picked.userId,
    reason: `Round robin picked the rep (weight ${normWeight(result.picked.weight)}).`,
    credits: result.credits,
  };
}

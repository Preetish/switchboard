import { selectRep, type OutcomeDraft, type RepCandidate } from "@switchboard/core";
import type { Database, DecisionOutcome } from "@switchboard/db";
import { and, asc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { bookings, teams, teamMembers, users } from "@switchboard/db";

/** Monday 00:00 UTC of the week containing `now` (capacity window). */
function startOfWeek(now: Date): Date {
  const day = now.getUTCDay();
  const mondayOffset = (day + 6) % 7;
  const monday = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - mondayOffset,
  );
  return new Date(monday);
}

/**
 * Attach org IDs to a rules-engine outcome draft and resolve team routes to a
 * concrete rep. A route to a team that does not exist (or no longer exists),
 * or a team where nobody is eligible, is honest in the log and falls back to
 * the queue so the lead is never dropped; a rep target that matches no local
 * rep (by email or id) is recorded as routed but pending.
 *
 * `options.ownerEmail` is the lead's HubSpot owner email (from the CRM
 * prefetch) and activates the `existing_owner` strategy: the owner wins when
 * they are on the team and eligible.
 */
export async function finalizeOutcome(
  db: Database,
  orgId: string,
  draft: OutcomeDraft,
  options: { ownerEmail?: string | null } = {},
): Promise<DecisionOutcome> {
  if (draft.kind === "route_team") {
    const [team] = await db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(and(eq(teams.orgId, orgId), eq(teams.key, draft.teamKey)))
      .limit(1);
    if (!team) {
      return {
        kind: "fallback_queue",
        reason: `Team "${draft.teamKey}" is not configured; sent to the fallback queue.`,
      };
    }

    // The lead's CRM owner, when the strategy can use one. Read before the
    // rotation lock so the locked section stays short.
    let ownerUserId: string | undefined;
    if (draft.strategy === "existing_owner" && options.ownerEmail) {
      const [owner] = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(eq(users.orgId, orgId), sql`lower(${users.email}) = ${options.ownerEmail.toLowerCase()}`),
        )
        .limit(1);
      ownerUserId = owner?.id;
    }

    const weekStart = startOfWeek(new Date());
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60_000);
    // Lock the team's memberships so concurrent submissions take turns: each
    // reads the credits the previous one wrote, and two leads can't land on
    // the same rep because they read the same state.
    const pick = await db.transaction(async (tx) => {
      const members = await tx
        .select({
          membershipId: teamMembers.id,
          userId: teamMembers.userId,
          weight: teamMembers.weight,
          weeklyCapacity: teamMembers.weeklyCapacity,
          active: teamMembers.active,
          credit: teamMembers.rrCredit,
        })
        .from(teamMembers)
        .innerJoin(users, eq(teamMembers.userId, users.id))
        .where(eq(teamMembers.teamId, team.id))
        // Deterministic order so round-robin ties are stable across requests.
        .orderBy(asc(users.email))
        .for("update", { of: teamMembers });

      // Weekly capacity counts held and confirmed bookings in this week only.
      const bookingRows = members.length
        ? await tx
            .select({ userId: bookings.userId, count: sql<number>`count(*)::int` })
            .from(bookings)
            .where(
              and(
                inArray(
                  bookings.userId,
                  members.map((member) => member.userId),
                ),
                inArray(bookings.status, ["confirmed", "hold"]),
                gte(bookings.startAt, weekStart),
                lt(bookings.startAt, weekEnd),
              ),
            )
            .groupBy(bookings.userId)
        : [];
      const bookingCount = new Map(bookingRows.map((r) => [r.userId, r.count]));
      const candidates: RepCandidate[] = members.map((member) => ({
        userId: member.userId,
        weight: member.weight,
        weeklyCapacity: member.weeklyCapacity,
        bookingsThisWeek: bookingCount.get(member.userId) ?? 0,
        credit: member.credit,
        available: member.active,
      }));

      // The owner wins only when they are a known, eligible rep on this team;
      // otherwise selectRep falls back to round robin inside the same call.
      const selection = selectRep(draft.strategy, candidates, ownerUserId);
      if (selection.credits) {
        for (const member of members) {
          const credit = selection.credits.get(member.userId);
          if (credit !== undefined && credit !== member.credit) {
            await tx
              .update(teamMembers)
              .set({ rrCredit: credit })
              .where(eq(teamMembers.id, member.membershipId));
          }
        }
      }
      return selection;
    });

    if (!pick.userId) {
      return {
        kind: "fallback_queue",
        reason: `${team.name} team: ${pick.reason}`,
      };
    }
    return {
      kind: "route_team",
      teamId: team.id,
      userId: pick.userId,
      strategy: draft.strategy,
      reason: `${team.name} team: ${pick.reason}`,
    };
  }
  if (draft.kind === "route_user") {
    // Only treat the target as a user id when it is UUID-shaped; comparing
    // anything else against the uuid column makes Postgres reject the query.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const idTarget = UUID_RE.test(draft.to) ? eq(users.id, draft.to) : undefined;
    const emailTarget = sql`lower(${users.email}) = ${draft.to.toLowerCase()}`;
    const [user] = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(
        and(
          eq(users.orgId, orgId),
          idTarget ? or(emailTarget, idTarget) : emailTarget,
        ),
      )
      .limit(1);
    if (user) {
      return {
        kind: "route_user",
        userId: user.id,
        reason: `${user.name} (from ${draft.toSource}).`,
      };
    }
    return {
      kind: "route_user",
      reason: `${draft.to} isn't a rep here yet (from ${draft.toSource}); waiting for a match.`,
    };
  }
  return {
    kind: draft.kind,
    reason: draft.reason,
    ...(draft.kind === "self_serve_link" && draft.message
      ? { message: draft.message }
      : {}),
  };
}

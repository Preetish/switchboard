import { selectRep, type OutcomeDraft, type RepCandidate } from "@switchboard/core";
import type { Database, DecisionOutcome } from "@switchboard/db";
import { and, asc, eq, gte, or, sql } from "drizzle-orm";
import { bookings, routingDecisions, teams, teamMembers, users } from "@switchboard/db";

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
 * the queue so the lead is never dropped; an unmatched rep target is recorded
 * as routed but pending (CRM owner mapping lands with the HubSpot task).
 */
export async function finalizeOutcome(
  db: Database,
  orgId: string,
  draft: OutcomeDraft,
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

    const weekStart = startOfWeek(new Date());
    // Deterministic order so round-robin ties are stable across requests.
    const members = await db
      .select({
        userId: teamMembers.userId,
        weight: teamMembers.weight,
        weeklyCapacity: teamMembers.weeklyCapacity,
        active: teamMembers.active,
      })
      .from(teamMembers)
      .innerJoin(users, eq(teamMembers.userId, users.id))
      .where(eq(teamMembers.teamId, team.id))
      .orderBy(asc(users.email));

    // Rotation state: past team-routed decisions per rep. Bookings this week
    // gate weekly capacity; calendar free/busy joins with the Google task.
    const [assignmentRows, bookingRows] = await Promise.all([
      db
        .select({
          userId: sql<string>`${routingDecisions.outcome} ->> 'userId'`,
          count: sql<number>`count(*)::int`,
        })
        .from(routingDecisions)
        .where(
          and(
            eq(routingDecisions.orgId, orgId),
            sql`${routingDecisions.outcome} ->> 'kind' = 'route_team'`,
          ),
        )
        .groupBy(sql`${routingDecisions.outcome} ->> 'userId'`),
      db
        .select({ userId: bookings.userId, count: sql<number>`count(*)::int` })
        .from(bookings)
        .where(
          and(
            eq(bookings.orgId, orgId),
            eq(bookings.status, "confirmed"),
            gte(bookings.startAt, weekStart),
          ),
        )
        .groupBy(bookings.userId),
    ]);

    const assignmentCount = new Map(
      assignmentRows.filter((r) => r.userId !== null).map((r) => [r.userId, r.count]),
    );
    const bookingCount = new Map(bookingRows.map((r) => [r.userId, r.count]));
    const candidates: RepCandidate[] = members.map((member) => ({
      userId: member.userId,
      weight: member.weight,
      weeklyCapacity: member.weeklyCapacity,
      bookingsThisWeek: bookingCount.get(member.userId) ?? 0,
      assignments: assignmentCount.get(member.userId) ?? 0,
      available: member.active,
    }));

    const pick = selectRep(draft.strategy, candidates);
    if (!pick.userId) {
      return {
        kind: "fallback_queue",
        reason: `${draft.reason} Team: ${team.name}. ${pick.reason}`,
      };
    }
    return {
      kind: "route_team",
      teamId: team.id,
      userId: pick.userId,
      strategy: draft.strategy,
      reason: `${draft.reason} Team: ${team.name}. ${pick.reason}`,
    };
  }
  if (draft.kind === "route_user") {
    // Only treat the target as a user id when it is UUID-shaped; comparing
    // anything else against the uuid column makes Postgres reject the query.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const idTarget = UUID_RE.test(draft.to) ? eq(users.id, draft.to) : undefined;
    const [user] = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(
        and(
          eq(users.orgId, orgId),
          idTarget ? or(eq(users.email, draft.to), idTarget) : eq(users.email, draft.to),
        ),
      )
      .limit(1);
    if (user) {
      return {
        kind: "route_user",
        userId: user.id,
        reason: `${draft.reason} Rep: ${user.name}.`,
      };
    }
    return { kind: "route_user", reason: `${draft.reason} Pending rep matching.` };
  }
  return { kind: draft.kind, reason: draft.reason };
}

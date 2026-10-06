import type { OutcomeDraft } from "@switchboard/core";
import type { Database, DecisionOutcome } from "@switchboard/db";
import { and, eq, or } from "drizzle-orm";
import { teams, users } from "@switchboard/db";

/**
 * Attach org IDs to a rules-engine outcome draft. A route to a team that does
 * not exist (or no longer exists) is honest in the log and falls back to the
 * queue so the lead is never dropped; an unmatched rep target is recorded as
 * routed but pending (CRM owner mapping lands with the HubSpot task).
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
    return {
      kind: "route_team",
      teamId: team.id,
      strategy: draft.strategy,
      reason: `${draft.reason} Team: ${team.name}.`,
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

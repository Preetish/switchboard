import { and, desc, eq, inArray } from "drizzle-orm";
import { bookings, routingDecisions, submissions, type Database } from "@switchboard/db";

/**
 * The public booking surfaces (availability, booking) only act for a real
 * lead and the rep routing chose for them. Holding a submission id — which
 * only the browser that submitted the form receives — is what authorizes a
 * lead to see that one rep's open times and book with them.
 */

export type RoutedLead = {
  submissionId: string;
  orgId: string;
  email: string | null;
  data: Record<string, string>;
  /** Rep the latest routing decision picked; null when no rep was chosen. */
  repId: string | null;
  decisionId: string | null;
};

export async function findRoutedLead(
  db: Database,
  submissionId: string,
): Promise<RoutedLead | null> {
  const [row] = await db
    .select({
      submissionId: submissions.id,
      orgId: submissions.orgId,
      email: submissions.email,
      data: submissions.data,
      decisionId: routingDecisions.id,
      outcome: routingDecisions.outcome,
    })
    .from(submissions)
    .leftJoin(routingDecisions, eq(routingDecisions.submissionId, submissions.id))
    .where(eq(submissions.id, submissionId))
    .orderBy(desc(routingDecisions.createdAt))
    .limit(1);
  if (!row) return null;
  return {
    submissionId: row.submissionId,
    orgId: row.orgId,
    email: row.email,
    data: row.data,
    repId: row.outcome?.userId ?? null,
    decisionId: row.decisionId,
  };
}

/** The lead's live (held or confirmed) booking, if they already have one. */
export async function findActiveBooking(db: Database, submissionId: string) {
  const [row] = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.submissionId, submissionId),
        inArray(bookings.status, ["hold", "confirmed"]),
      ),
    )
    .limit(1);
  return row ?? null;
}

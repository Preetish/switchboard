import {
  crmPathsIn,
  draftOutcome,
  emailFieldKey,
  evaluate,
  validateRuleSet,
  validateSubmission,
  type RuleSet,
} from "@switchboard/core";
import type { Database, DecisionOutcome, RoutingDecision } from "@switchboard/db";
import { and, desc, eq } from "drizzle-orm";
import { forms, routingDecisions, submissions, ruleSets, users } from "@switchboard/db";
import { fetchCrmContext, upsertCrmContact, type CrmContext } from "./crm";
import { scheduleSpeedToLeadAlert } from "./queue";
import { finalizeOutcome } from "./routing";

export type SubmitOutcome =
  | { status: "not_found" }
  | { status: "invalid"; errors: Record<string, string> }
  | {
      status: "created";
      submissionId: string;
      decision: DecisionOutcome;
      repName: string | null;
    }
  | {
      status: "duplicate";
      submissionId: string | null;
      decision: DecisionOutcome | null;
      repName: string | null;
    };

/** Empty rule set so a broken stored rule file can never drop a lead. */
const EMPTY_RULE_SET: RuleSet = { rules: [], fallback: { action: "fallback_queue" } };

export async function handleSubmission(
  db: Database,
  slug: string,
  payload: unknown,
  idempotencyKey: string | undefined,
): Promise<SubmitOutcome> {
  const [row] = await db
    .select({ form: forms, ruleSet: ruleSets })
    .from(forms)
    .leftJoin(ruleSets, eq(forms.ruleSetId, ruleSets.id))
    .where(eq(forms.slug, slug))
    .limit(1);
  if (!row) return { status: "not_found" };

  const { form } = row;
  const validated = validateSubmission(form.fields, payload);
  if (!validated.ok) return { status: "invalid", errors: validated.errors };

  const emailKey = emailFieldKey(form.fields);
  const email = emailKey ? (validated.data[emailKey] ?? null) : null;

  const inserted = await db
    .insert(submissions)
    .values({
      orgId: form.orgId,
      formId: form.id,
      data: validated.data,
      email,
      idempotencyKey: idempotencyKey ?? null,
    })
    .onConflictDoNothing({ target: [submissions.formId, submissions.idempotencyKey] })
    .returning({ id: submissions.id });

  if (!inserted[0]) {
    // Only reachable with an idempotency key: NULL keys are distinct under the
    // unique index, so keyless inserts always succeed (and are never deduped).
    const [existing] = await db
      .select({ id: submissions.id })
      .from(submissions)
      .where(
        and(
          eq(submissions.formId, form.id),
          eq(submissions.idempotencyKey, idempotencyKey ?? ""),
        ),
      )
      .orderBy(desc(submissions.createdAt))
      .limit(1);
    const decision = existing ? await latestDecision(db, existing.id) : null;
    return {
      status: "duplicate",
      submissionId: existing?.id ?? null,
      decision: decision?.outcome ?? null,
      repName: decision?.outcome.userId
        ? await repName(db, decision.outcome.userId)
        : null,
    };
  }

  const startedAt = performance.now();
  // A rule set that no longer validates is skipped rather than dropping the lead.
  const parsed = row.ruleSet
    ? validateRuleSet(row.ruleSet.rules)
    : { ok: true as const, ruleSet: EMPTY_RULE_SET };
  const ruleSet = parsed.ok ? parsed.ruleSet : EMPTY_RULE_SET;

  // CRM lookups happen before evaluation and only for the paths the rule set
  // actually reads; a HubSpot outage or slow portal yields no CRM data and the
  // non-CRM rules still route the lead (never dropped, failure logged).
  const needsCrm = crmPathsIn(ruleSet).length > 0;
  const crm: CrmContext | null =
    needsCrm && email ? await fetchCrmContext(db, form.orgId, email) : null;
  const inputs: Record<string, unknown> = { form: validated.data, crm: crm ?? {} };

  const evaluation = evaluate(ruleSet, inputs);
  const latencyMs = Math.max(1, Math.round(performance.now() - startedAt));
  const owner = crm?.contact.owner ?? null;
  const outcome = await finalizeOutcome(
    db,
    form.orgId,
    draftOutcome(evaluation.action, inputs),
    { ownerEmail: owner },
  );

  const submissionId = inserted[0]!.id;
  const insertedDecision = await db
    .insert(routingDecisions)
    .values({
      orgId: form.orgId,
      submissionId,
      inputs,
      matchedRule: evaluation.matchedRule,
      outcome,
      latencyMs,
    })
    .returning({ outcome: routingDecisions.outcome });

  // Schedule the speed-to-lead alert: if this lead has not booked within the
  // configured window, the routed rep is notified (the job re-checks bookings
  // at fire time). Best-effort — a queue failure never loses the lead.
  if (outcome.userId) await scheduleSpeedToLeadAlert(submissionId);

  // Write the lead back to HubSpot so the CRM always has the contact. The
  // routing decision is already durable, so a CRM failure cannot lose it;
  // upsertCrmContact is idempotent (per submission) and logs its own errors.
  await upsertCrmContact(db, form.orgId, { id: submissionId, email, data: validated.data });

  return {
    status: "created",
    submissionId,
    decision: insertedDecision[0]?.outcome ?? outcome,
    repName: outcome.userId ? await repName(db, outcome.userId) : null,
  };
}

async function repName(db: Database, userId: string): Promise<string | null> {
  const [user] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user?.name ?? null;
}

async function latestDecision(
  db: Database,
  submissionId: string,
): Promise<RoutingDecision | null> {
  const [decision] = await db
    .select()
    .from(routingDecisions)
    .where(eq(routingDecisions.submissionId, submissionId))
    .orderBy(desc(routingDecisions.createdAt))
    .limit(1);
  return decision ?? null;
}

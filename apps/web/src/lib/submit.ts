import {
  buildRuleInputs,
  crmPathsIn,
  draftOutcome,
  emailFieldKey,
  evaluate,
  isDisposableEmail,
  validateRuleSet,
  validateSubmission,
  type RuleSet,
} from "@switchboard/core";
import type { Database, DecisionOutcome, RoutingDecision } from "@switchboard/db";
import { and, desc, eq } from "drizzle-orm";
import { forms, routingDecisions, submissions, ruleSets, users } from "@switchboard/db";
import { fetchCrmContext, type CrmContext } from "./crm";
import { scheduleCrmSync, scheduleSpeedToLeadAlert } from "./jobs";
import { finalizeOutcome } from "./routing";
import { log } from "./log";

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

  // Abuse protection: bounce throwaway addresses with a field
  // error like any other validation failure.
  if (email && isDisposableEmail(email)) {
    return {
      status: "invalid",
      errors: {
        [emailKey!]:
          "Use your work email. We can't accept disposable addresses.",
      },
    };
  }

  // An idempotent retry (double click, flaky network) gets the original
  // decision back without routing again.
  if (idempotencyKey) {
    const duplicate = await findDuplicate(db, form.id, idempotencyKey);
    if (duplicate) return duplicate;
  }

  const startedAt = performance.now();
  // A rule set that no longer validates is skipped rather than dropping the lead.
  const parsed = row.ruleSet
    ? validateRuleSet(row.ruleSet.rules)
    : { ok: true as const, ruleSet: EMPTY_RULE_SET };
  if (!parsed.ok) {
    log.error(
      `Rule set for form "${form.slug}" is invalid; routing to the fallback queue: ${parsed.errors.join("; ")}`,
    );
  }
  const ruleSet = parsed.ok ? parsed.ruleSet : EMPTY_RULE_SET;

  // CRM lookups happen before evaluation and only for the paths the rule set
  // actually reads; a HubSpot outage or slow portal yields no CRM data and the
  // non-CRM rules still route the lead (never dropped, failure logged).
  const needsCrm = crmPathsIn(ruleSet).length > 0;
  const crm: CrmContext | null =
    needsCrm && email ? await fetchCrmContext(db, form.orgId, email) : null;
  // form.* plus derived keys (form.email_domain); crm.* from the prefetch.
  const inputs: Record<string, unknown> = buildRuleInputs(form.fields, validated.data, crm);

  const evaluation = evaluate(ruleSet, inputs);
  const owner = crm?.contact.owner ?? null;
  const outcome = await finalizeOutcome(
    db,
    form.orgId,
    draftOutcome(evaluation.action, inputs),
    { ownerEmail: owner },
  );
  const latencyMs = Math.max(1, Math.round(performance.now() - startedAt));

  // The submission and its decision are written together: a crash can't
  // leave a lead without a decision (which would hide the booking step).
  const submissionId = await db.transaction(async (tx) => {
    const [inserted] = await tx
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
    if (!inserted) return null;
    await tx.insert(routingDecisions).values({
      orgId: form.orgId,
      submissionId: inserted.id,
      inputs,
      matchedRule: evaluation.matchedRule,
      outcome,
      latencyMs,
    });
    return inserted.id;
  });
  if (!submissionId) {
    // A concurrent retry with the same key committed first; return its result.
    const duplicate = await findDuplicate(db, form.id, idempotencyKey ?? "");
    if (duplicate) return duplicate;
    throw new Error(`Submission conflict without a stored original (form ${form.id}).`);
  }

  // Side effects run on the job queue so the lead isn't kept waiting and
  // provider outages are retried: the speed-to-lead alert (re-checks
  // bookings when it fires) and the CRM write-back.
  if (outcome.userId) await scheduleSpeedToLeadAlert(submissionId);
  if (email) await scheduleCrmSync(db, submissionId);

  return {
    status: "created",
    submissionId,
    decision: outcome,
    repName: outcome.userId ? await repName(db, outcome.userId) : null,
  };
}

async function findDuplicate(
  db: Database,
  formId: string,
  idempotencyKey: string,
): Promise<SubmitOutcome | null> {
  const [existing] = await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(and(eq(submissions.formId, formId), eq(submissions.idempotencyKey, idempotencyKey)))
    .limit(1);
  if (!existing) return null;
  const decision = await latestDecision(db, existing.id);
  return {
    status: "duplicate",
    submissionId: existing.id,
    decision: decision?.outcome ?? null,
    repName: decision?.outcome.userId ? await repName(db, decision.outcome.userId) : null,
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

import {
  CAMPAIGN_PARAMS,
  buildRuleInputs,
  draftOutcome,
  evaluate,
  sanitizeAttribution,
  type FormField,
  type OutcomeDraft,
  type RuleSet,
} from "@switchboard/core";
import type { ConfigPlan } from "@switchboard/config";

/**
 * The Setup page's simulator: route one test lead through a draft config
 * with the real rules engine (buildRuleInputs, evaluate, draftOutcome) and
 * say what happened in plain words. Pure: nothing is saved, no lead is
 * created, and the database is never read, so team routes name who is
 * active on the team rather than whose turn the live rotation says it is.
 */

export type CampaignParam = (typeof CAMPAIGN_PARAMS)[number];

export type TestLead = {
  /** Form answers by field key, as typed. */
  answers: Record<string, string>;
  /** The HubSpot contact owner's email (`crm.contact.owner`); empty for none. */
  hubspotOwner: string;
  /** Last-visit campaign parameters (`attribution.utm_*`). */
  utm: Partial<Record<CampaignParam, string>>;
};

export type SimulatedStep = {
  /** 1-based, as the rule builder numbers rules. */
  position: number;
  rule: string;
  matched: boolean;
  /** The engine's first failing path, and what it reads in words. */
  failedOn?: string;
  failedOnLabel?: string;
};

export type Simulation = {
  /** Where the lead goes and why, e.g. "Routes to Ana (Sales) because rule 2, Enterprise, matched. Decided in 0.2 ms." */
  summary: string;
  matchedRule: string | null;
  /** The rules tried, in order, from the engine's trace. */
  trace: SimulatedStep[];
  latencyMs: number;
};

/** What an untouched form routes with (handleSubmission does the same). */
const EMPTY_RULE_SET: RuleSet = { rules: [], fallback: { action: "fallback_queue" } };

const MAX_VALUE_LENGTH = 500;

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (entry) => typeof entry === "string" && entry.length <= MAX_VALUE_LENGTH,
    )
  );
}

/** A test lead from a request body, or null when it isn't one. */
export function parseTestLead(raw: unknown): TestLead | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { answers, hubspotOwner, utm } = raw as Record<string, unknown>;
  if (!isStringRecord(answers) || !isStringRecord(utm)) return null;
  if (typeof hubspotOwner !== "string" || hubspotOwner.length > MAX_VALUE_LENGTH)
    return null;
  if (
    !Object.keys(utm).every((key) => (CAMPAIGN_PARAMS as readonly string[]).includes(key))
  ) {
    return null;
  }
  return { answers, hubspotOwner, utm };
}

/** Answers as a submission stores them: declared fields only, trimmed, emails lowercased. */
function formData(
  fields: FormField[],
  answers: Record<string, string>,
): Record<string, string> {
  const data: Record<string, string> = {};
  for (const field of fields) {
    const value = Object.hasOwn(answers, field.key) ? answers[field.key]!.trim() : "";
    if (value !== "")
      data[field.key] = field.type === "email" ? value.toLowerCase() : value;
  }
  return data;
}

/** A rule input path in words, e.g. `form.company_size` → "Company size". */
export function pathLabel(path: string, fields: FormField[]): string {
  if (path === "crm.contact.owner") return "HubSpot contact owner";
  if (path.startsWith("form.")) {
    const key = path.slice(5);
    if (key === "email_domain" && !fields.some((field) => field.key === key))
      return "email domain";
    return fields.find((field) => field.key === key)?.label ?? key;
  }
  if (path.startsWith("attribution.first.")) return `${path.slice(18)} (first visit)`;
  if (path.startsWith("attribution.")) return path.slice(12);
  return path;
}

/** "A", "A and B", "A, B, and C". */
function listWords(items: string[]): string {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

/** Where the outcome sends the lead, plus anything a reader needs to know about it. */
function destination(
  outcome: OutcomeDraft,
  plan: ConfigPlan,
  fields: FormField[],
  ownerEmail: string,
): { where: string; note?: string } {
  const repName = (email: string) =>
    plan.reps.find((rep) => rep.email === email.toLowerCase())?.name;

  switch (outcome.kind) {
    case "route_user": {
      const name = repName(outcome.to);
      const literal = outcome.toSource === outcome.to;
      const via = literal ? "" : ` (${pathLabel(outcome.toSource, fields)})`;
      return name
        ? { where: `Routes to ${name}${via}` }
        : {
            where: `Routes to ${outcome.to}${via}`,
            note: `${outcome.to} isn't a rep here yet, so the lead waits for a match.`,
          };
    }
    case "route_team": {
      const team = plan.teams.find((candidate) => candidate.key === outcome.teamKey);
      if (!team) {
        return {
          where: "Goes to the fallback queue",
          note: `Team "${outcome.teamKey}" is not set up.`,
        };
      }
      const active = team.members.filter((member) => member.active);
      if (active.length === 0) {
        return {
          where: "Goes to the fallback queue",
          note: `Nobody on ${team.name} is active (everyone is paused).`,
        };
      }
      const name = (email: string) => repName(email) ?? email;
      if (outcome.strategy === "existing_owner") {
        const owner = active.find((member) => member.rep === ownerEmail);
        if (owner) {
          return {
            where: `Routes to ${name(owner.rep)} (${team.name})`,
            note: "They own the contact in HubSpot.",
          };
        }
      }
      const note =
        outcome.strategy === "existing_owner"
          ? ownerEmail
            ? `The HubSpot contact owner isn't active on ${team.name}, so the team takes turns.`
            : "There is no HubSpot contact owner, so the team takes turns."
          : undefined;
      const where =
        active.length === 1
          ? `Routes to ${name(active[0]!.rep)} (${team.name})`
          : `Routes to ${team.name}, taking turns between ${listWords(active.map((member) => name(member.rep)))}`;
      return note ? { where, note } : { where };
    }
    case "self_serve_link":
      return { where: "Gets the self-serve link" };
    case "fallback_queue":
      return { where: "Goes to the fallback queue" };
  }
}

/**
 * Route `lead` through the form `formSlug` in `plan` (a validated draft).
 * Returns null when the plan has no such form.
 */
export function simulateLead(
  plan: ConfigPlan,
  formSlug: string,
  lead: TestLead,
  now: () => number = () => performance.now(),
): Simulation | null {
  const form = plan.forms.find((candidate) => candidate.slug === formSlug);
  if (!form) return null;
  const ruleSet = form.ruleSet ?? EMPTY_RULE_SET;
  const ownerEmail = lead.hubspotOwner.trim().toLowerCase();

  const startedAt = now();
  const inputs = buildRuleInputs(
    form.fields,
    formData(form.fields, lead.answers),
    ownerEmail ? { contact: { owner: ownerEmail } } : null,
    sanitizeAttribution(lead.utm),
  );
  const evaluation = evaluate(ruleSet, inputs);
  const outcome = draftOutcome(evaluation.action, inputs);
  const latencyMs = Math.round((now() - startedAt) * 10) / 10;

  const position =
    ruleSet.rules.findIndex((rule) => rule.name === evaluation.matchedRule) + 1;
  const why =
    evaluation.matchedRule !== null
      ? `rule ${position}, ${evaluation.matchedRule}, matched`
      : ruleSet.rules.length === 0
        ? "the form has no rules, so the last row applies"
        : "no rule matched, so the last row applies";
  const { where, note } = destination(outcome, plan, form.fields, ownerEmail);
  const unresolved =
    outcome.kind === "fallback_queue" && "to" in evaluation.action
      ? `${pathLabel(evaluation.action.to, form.fields)} has no value for this lead.`
      : undefined;
  const extra = [note, unresolved].filter(Boolean).join(" ");

  return {
    summary: `${where} because ${why}.${extra ? ` ${extra}` : ""} Decided in ${
      latencyMs < 0.1 ? "under 0.1" : latencyMs
    } ms.`,
    matchedRule: evaluation.matchedRule,
    trace: evaluation.trace.map((step, i) => ({
      position: i + 1,
      rule: step.rule,
      matched: step.matched,
      ...(step.failedOn
        ? {
            failedOn: step.failedOn,
            failedOnLabel: pathLabel(step.failedOn, form.fields),
          }
        : {}),
    })),
    latencyMs,
  };
}

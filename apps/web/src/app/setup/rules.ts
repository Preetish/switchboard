import type { ConfigInput } from "@switchboard/config";
import type {
  FormField,
  RouteAction,
  Rule,
  Strategy,
  WhenClause,
} from "@switchboard/core";
import { URL_PARAMS } from "@switchboard/core/client";

/**
 * The rule builder's state, and the way back to each form's inline rule set
 * in the config object. One rule is one sentence: "When [source]
 * [operator] [value] then route to [target]". Sources and operators are the
 * engine's own (see packages/core/src/rules); nothing here adds to them.
 *
 * A rule the sentence can't express exactly (two conditions, regex, `neq`,
 * ...) stays an "advanced" rule: its conditions are passed through untouched
 * and can only change in switchboard.yaml. So saving without edits always
 * gives back the same rules.
 *
 * Plain functions with no React or I/O, so the save path is unit tested.
 */

export type Operator = "is" | "any_of" | "at_least" | "contains" | "exists";

export const OPERATOR_LABELS: Record<Operator, string> = {
  is: "is",
  any_of: "is any of",
  at_least: "is at least",
  contains: "contains",
  exists: "exists",
};

export const STRATEGY_LABELS: Record<Strategy, string> = {
  round_robin: "take turns",
  existing_owner: "CRM owner first, else take turns",
};

const TEXT_OPERATORS: Operator[] = ["is", "any_of", "contains", "exists"];
const NUMBER_OPERATORS: Operator[] = ["is", "any_of", "at_least", "exists"];

/** "Any lead": a rule with no conditions, which matches every lead. */
export const ANY_LEAD = "any";
/** Free or work email: `freeEmail` / `workEmail` on the form's email field. */
export const EMAIL_TYPE = "email_type";
/** The HubSpot owner's email for this lead's contact. */
export const CRM_OWNER = "crm.contact.owner";

/** Something a rule can read. `id` is the engine path, or one of the ids above. */
export type Source = {
  id: string;
  label: string;
  group: string;
  kind: "any" | "text" | "number" | "owner" | "email_type";
  operators: Operator[];
  /** A select field's options, offered as suggestions. */
  options?: string[];
};

export type Sentence = { source: string; operator: Operator; value: string };

export type RuleDraft = {
  /** Local key: survives reordering and renaming. */
  id: string;
  name: string;
  /** The sentence, or conditions only switchboard.yaml can change. */
  when: Sentence | { advanced: WhenClause };
  route: RouteAction;
};

export type FormRulesDraft = {
  slug: string;
  name: string;
  fields: FormField[];
  /** False when the form had no rule set (every lead went to the fallback queue). */
  hadRules: boolean;
  rules: RuleDraft[];
  fallback: RouteAction;
};

function emailKey(fields: FormField[]): string | undefined {
  return fields.find((field) => field.type === "email")?.key;
}

/** What a rule on this form can read: the engine's input map, nothing more. */
export function sourcesFor(fields: FormField[]): Source[] {
  const sources: Source[] = [
    { id: ANY_LEAD, label: "any lead", group: "", kind: "any", operators: [] },
    ...fields.map((field): Source => ({
      id: `form.${field.key}`,
      label: field.label,
      group: "Form fields",
      kind: field.type === "number" ? "number" : "text",
      operators: field.type === "number" ? NUMBER_OPERATORS : TEXT_OPERATORS,
      ...(field.options ? { options: field.options } : {}),
    })),
  ];
  if (emailKey(fields)) {
    if (!fields.some((field) => field.key === "email_domain")) {
      sources.push({
        id: "form.email_domain",
        label: "email domain",
        group: "Email",
        kind: "text",
        operators: TEXT_OPERATORS,
      });
    }
    sources.push({
      id: EMAIL_TYPE,
      label: "free or work email",
      group: "Email",
      kind: "email_type",
      operators: ["is"],
    });
  }
  sources.push({
    id: CRM_OWNER,
    label: "HubSpot contact owner",
    group: "HubSpot",
    kind: "owner",
    operators: ["exists", "is"],
  });
  for (const [prefix, group] of [
    ["attribution.", "Campaign and ad click (last visit)"],
    ["attribution.first.", "Campaign and ad click (first visit)"],
  ] as const) {
    for (const param of URL_PARAMS) {
      sources.push({
        id: `${prefix}${param}`,
        label: param,
        group,
        kind: "text",
        operators: TEXT_OPERATORS,
      });
    }
  }
  return sources;
}

/** Number fields compare as numbers; everything else as text. */
function toScalar(text: string, numeric: boolean): string | number {
  const trimmed = text.trim();
  return numeric && trimmed !== "" && Number.isFinite(Number(trimmed))
    ? Number(trimmed)
    : trimmed;
}

/** A sentence as the engine's `when`. */
export function whenFromSentence(sentence: Sentence, fields: FormField[]): WhenClause {
  if (sentence.source === ANY_LEAD) return {};
  if (sentence.source === EMAIL_TYPE) {
    return {
      [`form.${emailKey(fields)}`]:
        sentence.value === "work" ? { workEmail: true } : { freeEmail: true },
    };
  }
  const source = sourcesFor(fields).find((candidate) => candidate.id === sentence.source);
  const scalar = (text: string) => toScalar(text, source?.kind === "number");
  const path = sentence.source;
  switch (sentence.operator) {
    case "exists":
      return { [path]: { exists: true } };
    case "is":
      return { [path]: { eq: scalar(sentence.value) } };
    case "any_of":
      return {
        [path]: {
          in: sentence.value
            .split(",")
            .filter((part) => part.trim() !== "")
            .map(scalar),
        },
      };
    case "at_least": {
      // A non-number is sent as typed, so the validator says what's wrong.
      return { [path]: { gte: toScalar(sentence.value, true) as number } };
    }
    case "contains":
      return { [path]: { contains: sentence.value.trim() } };
  }
}

/**
 * The sentence for a rule's `when`, or null when the sentence can't say
 * it exactly (the rule stays advanced). Exact means turning the sentence
 * back into `when` gives the same value, so a round trip never changes a rule.
 */
export function sentenceFromWhen(when: WhenClause, fields: FormField[]): Sentence | null {
  const entries = Object.entries(when);
  if (entries.length === 0) return { source: ANY_LEAD, operator: "is", value: "" };
  if (entries.length !== 1) return null;
  const [path, condition] = entries[0]!;
  if (typeof condition !== "object" || Object.keys(condition).length !== 1) return null;

  let sentence: Sentence | null = null;
  if (condition.freeEmail === true || condition.workEmail === true) {
    sentence = {
      source: EMAIL_TYPE,
      operator: "is",
      value: condition.workEmail ? "work" : "free",
    };
  } else if (condition.exists === true) {
    sentence = { source: path, operator: "exists", value: "" };
  } else if (condition.eq !== undefined) {
    sentence = { source: path, operator: "is", value: String(condition.eq) };
  } else if (condition.in !== undefined) {
    sentence = { source: path, operator: "any_of", value: condition.in.join(", ") };
  } else if (condition.gte !== undefined) {
    sentence = { source: path, operator: "at_least", value: String(condition.gte) };
  } else if (condition.contains !== undefined) {
    sentence = { source: path, operator: "contains", value: String(condition.contains) };
  }
  if (!sentence) return null;
  const source = sourcesFor(fields).find((candidate) => candidate.id === sentence.source);
  if (!source?.operators.includes(sentence.operator)) return null;
  return JSON.stringify(whenFromSentence(sentence, fields)) === JSON.stringify(when)
    ? sentence
    : null;
}

type InlineRules = { rules: Rule[]; fallback: RouteAction };

function isInlineRules(value: unknown): value is InlineRules {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<InlineRules>;
  return (
    Array.isArray(candidate.rules) &&
    typeof candidate.fallback === "object" &&
    candidate.fallback !== null
  );
}

/**
 * One draft per form, in the config's order. A form whose rules aren't an
 * inline rule set (a file path) gets null and is saved as it was.
 */
export function rulesDraftsFromConfig(config: ConfigInput): (FormRulesDraft | null)[] {
  return config.forms.map((form, formIndex) => {
    const fields = form.fields as FormField[];
    const base = { slug: form.slug, name: form.name, fields };
    if (form.rules === undefined) {
      return {
        ...base,
        hadRules: false,
        rules: [],
        fallback: { action: "fallback_queue" },
      };
    }
    if (!isInlineRules(form.rules)) return null;
    return {
      ...base,
      hadRules: true,
      rules: form.rules.rules.map((rule, i) => ({
        id: `rule-${formIndex}-${i}`,
        name: rule.name,
        when: sentenceFromWhen(rule.when, fields) ?? { advanced: rule.when },
        route: rule.route,
      })),
      fallback: form.rules.fallback,
    };
  });
}

export function ruleFromDraft(rule: RuleDraft, fields: FormField[]): Rule {
  return {
    name: rule.name,
    when:
      "advanced" in rule.when ? rule.when.advanced : whenFromSentence(rule.when, fields),
    route: rule.route,
  };
}

/** The full config to save: `config` with each form's rules replaced by its draft. */
export function buildRulesConfig(
  config: ConfigInput,
  drafts: (FormRulesDraft | null)[],
): ConfigInput {
  return {
    ...config,
    forms: config.forms.map((form, i) => {
      const draft = drafts[i];
      // No rule set and nothing added: keep it that way.
      if (
        !draft ||
        (!draft.hadRules &&
          draft.rules.length === 0 &&
          "action" in draft.fallback &&
          draft.fallback.action === "fallback_queue")
      ) {
        return form;
      }
      return {
        ...form,
        rules: {
          rules: draft.rules.map((rule) => ruleFromDraft(rule, draft.fields)),
          fallback: draft.fallback,
        },
      };
    }),
  };
}

function matchesEveryLead(rule: RuleDraft): boolean {
  return "advanced" in rule.when
    ? Object.keys(rule.when.advanced).length === 0
    : rule.when.source === ANY_LEAD;
}

/**
 * Plain warnings per rule id: a rule below one that matches every lead never
 * runs (the validator rejects that), an empty value never matches, and
 * "is at least" needs a number (the validator only says "Invalid input").
 */
export function ruleWarnings(rules: RuleDraft[]): Map<string, string> {
  const warnings = new Map<string, string>();
  let catchAll: RuleDraft | undefined;
  for (const rule of rules) {
    if (catchAll) {
      warnings.set(
        rule.id,
        `This rule never runs: "${catchAll.name}" above it matches every lead. Move this rule above it, or remove it.`,
      );
      continue;
    }
    if (matchesEveryLead(rule)) catchAll = rule;
    else if ("advanced" in rule.when || rule.when.operator === "exists") continue;
    else if (rule.when.value.trim() === "")
      warnings.set(rule.id, "Add a value; this rule can't match without one.");
    else if (
      rule.when.operator === "at_least" &&
      !Number.isFinite(Number(rule.when.value))
    ) {
      warnings.set(rule.id, `"is at least" needs a number, like 500.`);
    }
  }
  return warnings;
}

/** A name not used by any rule yet: "New rule", "New rule 2", ... */
function freshName(rules: RuleDraft[]): string {
  const names = new Set(rules.map((rule) => rule.name));
  let n = 1;
  while (names.has(n === 1 ? "New rule" : `New rule ${n}`)) n++;
  return n === 1 ? "New rule" : `New rule ${n}`;
}

/** A new rule on the first field, routed to the first team (or the fallback queue). */
export function newRule(id: string, form: FormRulesDraft, teamKeys: string[]): RuleDraft {
  const source = sourcesFor(form.fields)[1]!;
  return {
    id,
    name: freshName(form.rules),
    when: { source: source.id, operator: source.operators[0]!, value: "" },
    route: teamKeys[0]
      ? { team: teamKeys[0], strategy: "round_robin" }
      : { action: "fallback_queue" },
  };
}

/** The sentence after picking another source: keep the operator and value when they still fit. */
export function changeSource(sentence: Sentence, source: Source): Sentence {
  if (source.kind === "any") return { source: source.id, operator: "is", value: "" };
  const operator = source.operators.includes(sentence.operator)
    ? sentence.operator
    : source.operators[0]!;
  const keepValue = source.kind === "text" || source.kind === "number";
  return {
    source: source.id,
    operator,
    value: keepValue && operator !== "exists" ? sentence.value : "",
  };
}

/** Moves the item at `from` to `to`, shifting the rest. */
export function move<T>(items: T[], from: number, to: number): T[] {
  if (from === to || to < 0 || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/** Route targets, keyed for a select: `team:<key>`, `to:<email or path>`, `self_serve`, `queue`. */
export function routeKey(route: RouteAction): string {
  if ("team" in route) return `team:${route.team}`;
  if ("to" in route) return `to:${route.to}`;
  return route.action === "self_serve_link" ? "self_serve" : "queue";
}

/** The route for a picked target; picking the current one keeps it exactly. */
export function routeFromKey(key: string, current: RouteAction): RouteAction {
  if (key === routeKey(current)) return current;
  if (key.startsWith("team:")) {
    return {
      team: key.slice(5),
      strategy: "team" in current ? current.strategy : "round_robin",
    };
  }
  if (key.startsWith("to:")) return { to: key.slice(3) };
  return key === "self_serve"
    ? { action: "self_serve_link" }
    : { action: "fallback_queue" };
}

export type RouteOption = { key: string; label: string };

/**
 * Where a rule can send a lead. The fallback can't route to the HubSpot
 * owner (there may be none). A current target that isn't offered (e.g. a
 * rep since removed) is listed as it is, so it isn't changed silently.
 */
export function routeOptions(
  reps: { email: string; name: string }[],
  teams: { key: string; name: string }[],
  current: RouteAction,
  { fallback }: { fallback: boolean },
): RouteOption[] {
  const options: RouteOption[] = [
    ...teams.map((team) => ({ key: `team:${team.key}`, label: `team ${team.name}` })),
    ...reps
      .filter((rep) => rep.email.trim())
      .map((rep) => ({
        key: `to:${rep.email.trim().toLowerCase()}`,
        label: `rep ${rep.name || rep.email}`,
      })),
    ...(fallback ? [] : [{ key: `to:${CRM_OWNER}`, label: "the HubSpot contact owner" }]),
    { key: "self_serve", label: "self serve" },
    { key: "queue", label: "the fallback queue" },
  ];
  const currentKey = routeKey(current);
  if (!options.some((option) => option.key === currentKey)) {
    options.unshift({ key: currentKey, label: currentKey.replace(/^(team|to):/, "") });
  }
  return options;
}

export type PlacedRuleErrors = {
  /** By rule draft id. */
  rules: Map<string, string[]>;
  /** By form index. */
  fallbacks: Map<number, string[]>;
  /** Errors that don't name a rule or a fallback. */
  other: string[];
};

/**
 * Sort the validator's errors to the rule they name, using the drafts that
 * were sent. It names rules two ways: `forms[0] (demo) rules: rules.2.when...`
 * (the rule set's shape) and `forms[0] (demo) rules rules[2] (Name): ...`
 * (references to fields, teams, and reps); fallbacks likewise.
 */
export function placeRuleErrors(
  errors: string[],
  drafts: (FormRulesDraft | null)[],
): PlacedRuleErrors {
  const placed: PlacedRuleErrors = { rules: new Map(), fallbacks: new Map(), other: [] };
  const add = <K>(map: Map<K, string[]>, key: K, message: string) =>
    map.set(key, [...(map.get(key) ?? []), message]);
  for (const error of errors) {
    const rule =
      /^forms\[(\d+)\] \([^)]*\) rules: rules\.(\d+)(?:\.|: )(.*)$/.exec(error) ??
      /^forms\[(\d+)\] \([^)]*\) rules rules\[(\d+)\] \(.*?\): (.*)$/.exec(error);
    const ruleId = rule ? drafts[Number(rule[1])]?.rules[Number(rule[2])]?.id : undefined;
    if (rule && ruleId) {
      add(placed.rules, ruleId, rule[3]!);
      continue;
    }
    const fallback = /^forms\[(\d+)\] \([^)]*\) rules:? fallback(?:\.|: )(.*)$/.exec(
      error,
    );
    if (fallback && drafts[Number(fallback[1])]) {
      add(placed.fallbacks, Number(fallback[1]), fallback[2]!);
      continue;
    }
    placed.other.push(error);
  }
  return placed;
}

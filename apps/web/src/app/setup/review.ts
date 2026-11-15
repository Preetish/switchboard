import type { ConfigPlan, PlannedForm } from "@switchboard/config";
import type {
  FormField,
  RouteAction,
  Rule,
  RuleSet,
  Theme,
  WhenClause,
  WorkingHours,
} from "@switchboard/core";
import { FIELD_TYPE_LABELS } from "./forms";
import {
  ANY_LEAD,
  EMAIL_TYPE,
  OPERATOR_LABELS,
  STRATEGY_LABELS,
  routeKey,
  routeOptions,
  sentenceFromWhen,
  sourcesFor,
} from "./rules";

/**
 * The review screen's content: what a save changes, in words, and the
 * line diff of switchboard.yaml. Both compare validated plans (the saved
 * one from getCurrentConfigPlan, the draft from loadConfigObject), so a
 * value written two ways in the config (a member as an email or as an
 * object) never shows as a change.
 *
 * Plain functions with no React or I/O, so they are unit tested.
 */

export type ChangeGroup = { title: string; changes: string[] };

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const EMPTY_RULE_SET: RuleSet = { rules: [], fallback: { action: "fallback_queue" } };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function hoursWords(hours: WorkingHours | null): string {
  if (!hours) return "any time";
  const time = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  return `${hours.days.map((day) => DAY_LABELS[day]).join(", ")} ${time(hours.startMinute)}-${time(hours.endMinute)}`;
}

function repChanges(before: ConfigPlan, after: ConfigPlan): string[] {
  const changes: string[] = [];
  const saved = new Map(before.reps.map((rep) => [rep.email, rep]));
  for (const rep of after.reps) {
    const old = saved.get(rep.email);
    if (!old) {
      changes.push(`Added ${rep.name} (${rep.email})`);
      continue;
    }
    if (old.name !== rep.name) changes.push(`${old.name} renamed to ${rep.name}`);
    if (old.timezone !== rep.timezone) {
      changes.push(
        `${rep.name}'s time zone changed from ${old.timezone} to ${rep.timezone}`,
      );
    }
    if (!same(old.workingHours, rep.workingHours)) {
      changes.push(
        `${rep.name}'s working hours changed from ${hoursWords(old.workingHours)} to ${hoursWords(rep.workingHours)}`,
      );
    }
  }
  const listed = new Set(after.reps.map((rep) => rep.email));
  for (const rep of before.reps) {
    if (!listed.has(rep.email)) {
      changes.push(
        `${rep.name} (${rep.email}) is no longer listed; they stay a rep with no teams`,
      );
    }
  }
  return changes;
}

function teamChanges(before: ConfigPlan, after: ConfigPlan): string[] {
  const changes: string[] = [];
  const name = (email: string) =>
    (
      after.reps.find((rep) => rep.email === email) ??
      before.reps.find((rep) => rep.email === email)
    )?.name ?? email;
  const capWords = (cap: number) => (cap === 0 ? "no cap" : String(cap));
  const saved = new Map(before.teams.map((team) => [team.key, team]));
  for (const team of after.teams) {
    const old = saved.get(team.key);
    if (!old) {
      changes.push(`Added team ${team.name}`);
      continue;
    }
    if (old.name !== team.name) changes.push(`Team ${old.name} renamed to ${team.name}`);
    const oldMembers = new Map(old.members.map((member) => [member.rep, member]));
    for (const member of team.members) {
      const was = oldMembers.get(member.rep);
      const who = name(member.rep);
      if (!was) {
        changes.push(`${who} added to ${team.name}${member.active ? "" : " (paused)"}`);
        continue;
      }
      if (was.active !== member.active) {
        changes.push(`${who} ${member.active ? "unpaused" : "paused"} in ${team.name}`);
      }
      if (was.weight !== member.weight) {
        changes.push(
          `${who}'s weight in ${team.name} changed from ${was.weight} to ${member.weight}`,
        );
      }
      if (was.weeklyCapacity !== member.weeklyCapacity) {
        changes.push(
          `${who}'s weekly cap in ${team.name} changed from ${capWords(was.weeklyCapacity)} to ${capWords(member.weeklyCapacity)}`,
        );
      }
    }
    const members = new Set(team.members.map((member) => member.rep));
    for (const member of old.members) {
      if (!members.has(member.rep))
        changes.push(`${name(member.rep)} removed from ${team.name}`);
    }
  }
  const keys = new Set(after.teams.map((team) => team.key));
  for (const team of before.teams) {
    if (!keys.has(team.key)) changes.push(`Removed team ${team.name}`);
  }
  return changes;
}

/** A rule's condition in words, as the rule builder's sentence reads it. */
export function whenWords(when: WhenClause, fields: FormField[]): string {
  const sentence = sentenceFromWhen(when, fields);
  if (!sentence) {
    return Object.entries(when)
      .map(([path, condition]) => `${path}: ${JSON.stringify(condition)}`)
      .join(", ");
  }
  if (sentence.source === ANY_LEAD) return "any lead";
  const label = sourcesFor(fields).find((source) => source.id === sentence.source)?.label;
  if (sentence.source === EMAIL_TYPE) return `${label} is ${sentence.value}`;
  const operator = OPERATOR_LABELS[sentence.operator];
  return sentence.operator === "exists"
    ? `${label} ${operator}`
    : `${label} ${operator} ${sentence.value}`;
}

/** Where a route sends a lead, labelled as the rule builder's target picker labels it. */
export function routeWords(route: RouteAction, plan: ConfigPlan): string {
  const options = routeOptions(plan.reps, plan.teams, route, { fallback: false });
  return (
    options.find((option) => option.key === routeKey(route))?.label ?? routeKey(route)
  );
}

function routeChanges(
  before: RouteAction,
  after: RouteAction,
  beforePlan: ConfigPlan,
  afterPlan: ConfigPlan,
): string[] {
  if (same(before, after)) return [];
  if (routeKey(before) !== routeKey(after)) {
    return [
      `target changed from ${routeWords(before, beforePlan)} to ${routeWords(after, afterPlan)}`,
    ];
  }
  if ("team" in before && "team" in after && before.strategy !== after.strategy) {
    return [
      `now picks a rep by "${STRATEGY_LABELS[after.strategy]}" instead of "${STRATEGY_LABELS[before.strategy]}"`,
    ];
  }
  return ["route settings changed (see the YAML diff)"];
}

function ruleChanges(
  beforeSet: RuleSet,
  afterSet: RuleSet,
  fields: FormField[],
  beforePlan: ConfigPlan,
  afterPlan: ConfigPlan,
): string[] {
  const changes: string[] = [];
  const afterNames = new Set(afterSet.rules.map((rule) => rule.name));
  // Rule names are unique in a rule set, so a name is a rule's identity. An
  // old rule whose name is gone was renamed when a new rule has its exact
  // condition and route, or sits in its place with the same condition or route.
  const unnamed = beforeSet.rules.filter((rule) => !afterNames.has(rule.name));
  const pairs: (Rule | undefined)[] = [];
  afterSet.rules.forEach((rule, i) => {
    pairs[i] =
      beforeSet.rules.find((old) => old.name === rule.name) ??
      unnamed.find(
        (old) =>
          !pairs.includes(old) &&
          same(old.when, rule.when) &&
          same(old.route, rule.route),
      );
  });
  afterSet.rules.forEach((rule, i) => {
    const old = beforeSet.rules[i];
    if (
      !pairs[i] &&
      old &&
      unnamed.includes(old) &&
      !pairs.includes(old) &&
      (same(old.when, rule.when) || same(old.route, rule.route))
    ) {
      pairs[i] = old;
    }
  });
  const paired = new Set(pairs.filter(Boolean).map((rule) => rule!.name));

  afterSet.rules.forEach((rule, i) => {
    const old = pairs[i];
    const label = `Rule ${i + 1}, ${rule.name}`;
    if (!old) {
      changes.push(
        `Added rule ${i + 1}, ${rule.name}: when ${whenWords(rule.when, fields)}, route to ${routeWords(rule.route, afterPlan)}`,
      );
      return;
    }
    if (old.name !== rule.name)
      changes.push(`Rule ${i + 1} renamed from ${old.name} to ${rule.name}`);
    if (!same(old.when, rule.when)) {
      changes.push(
        `${label}: condition changed from "${whenWords(old.when, fields)}" to "${whenWords(rule.when, fields)}"`,
      );
    }
    for (const change of routeChanges(old.route, rule.route, beforePlan, afterPlan)) {
      changes.push(`${label}: ${change}`);
    }
  });
  beforeSet.rules.forEach((rule, i) => {
    if (!paired.has(rule.name)) changes.push(`Removed rule ${i + 1}, ${rule.name}`);
  });

  // Kept rules whose old positions are no longer in order were moved.
  const order = pairs
    .filter((old) => old !== undefined)
    .map((old) => beforeSet.rules.indexOf(old));
  if (order.some((index, i) => i > 0 && index < order[i - 1]!)) {
    changes.push(
      `Rules reordered: ${afterSet.rules.map((rule) => rule.name).join(", ")}`,
    );
  }

  for (const change of routeChanges(
    beforeSet.fallback,
    afterSet.fallback,
    beforePlan,
    afterPlan,
  )) {
    changes.push(`Last row (no rule matched): ${change}`);
  }
  return changes;
}

const THEME_LABELS: [string, string][] = [
  ["accent", "accent color"],
  ["background", "page background"],
  ["radius", "corner radius"],
  ["colorScheme", "color scheme"],
  ["layout", "layout"],
  ["font.family", "font"],
  ["font.stylesheet", "font stylesheet"],
];

function themeChanges(before: Theme | undefined, after: Theme | undefined): string[] {
  const value = (theme: Theme | undefined, key: string): string | undefined => {
    const found = key
      .split(".")
      .reduce<unknown>(
        (node, part) =>
          typeof node === "object" && node !== null
            ? (node as Record<string, unknown>)[part]
            : undefined,
        theme,
      );
    return found === undefined ? undefined : String(found);
  };
  const changes: string[] = [];
  for (const [key, label] of THEME_LABELS) {
    const was = value(before, key);
    const now = value(after, key);
    if (was === now) continue;
    if (was === undefined) changes.push(`Theme ${label} set to ${now}`);
    else if (now === undefined) changes.push(`Theme ${label} ${was} removed`);
    else changes.push(`Theme ${label} changed from ${was} to ${now}`);
  }
  return changes;
}

function fieldChanges(before: FormField, after: FormField): string[] {
  const changes: string[] = [];
  const label = `Field ${after.label}`;
  if (before.label !== after.label)
    changes.push(`Field ${before.label} renamed to ${after.label}`);
  if (before.type !== after.type) {
    changes.push(
      `${label}: type changed from ${FIELD_TYPE_LABELS[before.type]} to ${FIELD_TYPE_LABELS[after.type]}`,
    );
  }
  if (before.required !== after.required) {
    changes.push(`${label}: now ${after.required ? "required" : "optional"}`);
  }
  if (!same(before.options, after.options) && after.options) {
    changes.push(`${label}: options are now ${after.options.join(", ")}`);
  }
  if ((before.helpText ?? "") !== (after.helpText ?? "")) {
    changes.push(
      after.helpText
        ? `${label}: help text is now "${after.helpText}"`
        : `${label}: help text removed`,
    );
  }
  return changes;
}

/** A form's name, settings, fields, and theme; its rules are their own group. */
function formChanges(before: PlannedForm, after: PlannedForm): string[] {
  const changes: string[] = [];
  if (before.name !== after.name)
    changes.push(`Renamed from ${before.name} to ${after.name}`);
  const setting = (label: string, was: string | undefined, now: string | undefined) => {
    if (was === now) return;
    if (!now) changes.push(`${label} ${was} removed`);
    else changes.push(`${label} ${was ? `changed from ${was} to` : "set to"} ${now}`);
  };
  setting("Submit label", before.settings.submitLabel, after.settings.submitLabel);
  setting("Self serve URL", before.settings.selfServeUrl, after.settings.selfServeUrl);

  // A field's key is what rules read, so it is the field's identity: a
  // changed key reads as one field removed and another added.
  const oldByKey = new Map(before.fields.map((field) => [field.key, field]));
  const pairs = after.fields.map((field) => oldByKey.get(field.key));
  after.fields.forEach((field, i) => {
    const old = pairs[i];
    if (!old)
      changes.push(`Added field ${field.label} (${FIELD_TYPE_LABELS[field.type]})`);
    else changes.push(...fieldChanges(old, field));
  });
  for (const field of before.fields) {
    if (!pairs.includes(field)) changes.push(`Removed field ${field.label}`);
  }
  const order = pairs
    .filter((old) => old !== undefined)
    .map((old) => before.fields.indexOf(old));
  if (order.some((index, i) => i > 0 && index < order[i - 1]!)) {
    changes.push(
      `Fields reordered: ${after.fields.map((field) => field.label).join(", ")}`,
    );
  }
  changes.push(...themeChanges(before.settings.theme, after.settings.theme));
  return changes;
}

/** Everything the Setup page doesn't edit: org name and slug, HubSpot, custom CSS. */
function rest(plan: ConfigPlan) {
  return {
    org: { ...plan.org, settings: { ...plan.org.settings, theme: undefined } },
    forms: plan.forms.map((form) => ({
      slug: form.slug,
      customCss: form.settings.customCss,
    })),
  };
}

/**
 * What saving `after` over `before` changes, grouped as the Setup page is:
 * reps, teams, the default theme, then each form and its rules. Empty when
 * nothing changes.
 */
export function describeChanges(before: ConfigPlan, after: ConfigPlan): ChangeGroup[] {
  const groups: ChangeGroup[] = [
    { title: "Reps", changes: repChanges(before, after) },
    { title: "Teams", changes: teamChanges(before, after) },
    {
      title: "Default theme",
      changes: themeChanges(before.org.settings.theme, after.org.settings.theme),
    },
  ];
  for (const form of after.forms) {
    const old = before.forms.find((candidate) => candidate.slug === form.slug);
    if (!old) continue;
    groups.push({ title: `Form ${old.name}`, changes: formChanges(old, form) });
    groups.push({
      title: `Rules for ${form.name}`,
      changes: ruleChanges(
        old.ruleSet ?? EMPTY_RULE_SET,
        form.ruleSet ?? EMPTY_RULE_SET,
        form.fields,
        before,
        after,
      ),
    });
  }
  if (!same(rest(before), rest(after))) {
    groups.push({ title: "Other settings", changes: ["Changed; see the YAML diff."] });
  }
  return groups.filter((group) => group.changes.length > 0);
}

export type DiffLine =
  | { kind: "same" | "added" | "removed"; text: string }
  | { kind: "skipped"; count: number };

/**
 * A line diff of two texts (longest common subsequence), with unchanged
 * runs longer than `context` lines around each change folded into one
 * "skipped" entry. Empty when the texts are the same.
 */
export function diffLines(before: string, after: string, context = 3): DiffLine[] {
  if (before === after) return [];
  const a = before.split("\n");
  const b = after.split("\n");
  // The common start and end are unchanged; only the middle needs the table.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const width = midB.length + 1;
  const lcs = new Uint32Array((midA.length + 1) * width);
  for (let i = midA.length - 1; i >= 0; i--) {
    for (let j = midB.length - 1; j >= 0; j--) {
      lcs[i * width + j] =
        midA[i] === midB[j]
          ? lcs[(i + 1) * width + j + 1]! + 1
          : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
    }
  }
  const lines: { kind: "same" | "added" | "removed"; text: string }[] = a
    .slice(0, start)
    .map((text) => ({ kind: "same", text }));
  let i = 0;
  let j = 0;
  while (i < midA.length || j < midB.length) {
    if (i < midA.length && j < midB.length && midA[i] === midB[j]) {
      lines.push({ kind: "same", text: midA[i++]! });
      j++;
    } else if (
      i < midA.length &&
      (j === midB.length || lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!)
    ) {
      lines.push({ kind: "removed", text: midA[i++]! });
    } else {
      lines.push({ kind: "added", text: midB[j++]! });
    }
  }
  lines.push(...a.slice(endA).map((text) => ({ kind: "same" as const, text })));

  // Keep `context` unchanged lines on each side of a change; fold the rest.
  const near = lines.map((line, index) =>
    lines
      .slice(Math.max(0, index - context), index + context + 1)
      .some((other) => other.kind !== "same"),
  );
  const folded: DiffLine[] = [];
  lines.forEach((line, index) => {
    if (near[index]) folded.push(line);
    else {
      const last = folded.at(-1);
      if (last?.kind === "skipped") last.count++;
      else folded.push({ kind: "skipped", count: 1 });
    }
  });
  return folded;
}

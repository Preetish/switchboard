import path from "node:path";
import {
  DERIVED_FORM_KEYS,
  emailFieldKey,
  isValidTimeZone,
  parseRuleSetYaml,
  validateFormFields,
  validateRuleSet,
  type FormField,
  type RuleSet,
  type WorkingHours,
} from "@switchboard/core";
import { parse } from "yaml";
import { DAY_NAMES, configSchema } from "./schema.js";

/**
 * Load and validate switchboard.yaml into a plan the database step can
 * apply. All problems are collected (not just the first) and reported with
 * the place they occur, e.g. `forms[0] (book-a-demo) rules: team "dach" is
 * not defined in teams`.
 */

export type PlannedRep = {
  email: string;
  name: string;
  timezone: string;
  workingHours: WorkingHours | null;
};

export type PlannedTeam = {
  key: string;
  name: string;
  members: { rep: string; weight: number; weeklyCapacity: number; active: boolean }[];
};

export type PlannedForm = {
  slug: string;
  name: string;
  fields: FormField[];
  ruleSet: RuleSet | null;
};

export type ConfigPlan = {
  org: { name: string; slug: string };
  reps: PlannedRep[];
  teams: PlannedTeam[];
  forms: PlannedForm[];
};

export type LoadResult =
  | { ok: true; plan: ConfigPlan; warnings: string[] }
  | { ok: false; errors: string[] };

/** Reads a file relative to the config's directory (injected for tests). */
export type ReadFile = (absolutePath: string) => string;

function toWorkingHours(input: { days: string[]; hours: string }): WorkingHours {
  const [start, end] = input.hours.split("-") as [string, string];
  const minutes = (value: string) => {
    const [h, m] = value.split(":").map(Number) as [number, number];
    return h * 60 + m;
  };
  return {
    days: [...new Set(input.days.map((day) => DAY_NAMES.indexOf(day as (typeof DAY_NAMES)[number])))].sort((a, b) => a - b),
    startMinute: minutes(start),
    endMinute: minutes(end),
  };
}

function zodPath(path: PropertyKey[]): string {
  return path
    .map((part, i) => (typeof part === "number" ? `[${part}]` : `${i === 0 ? "" : "."}${String(part)}`))
    .join("");
}

export function loadConfig(text: string, configPath: string, readFile: ReadFile): LoadResult {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error) {
    return { ok: false, errors: [`${configPath}: ${error instanceof Error ? error.message : String(error)}`] };
  }
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => `${zodPath(issue.path) || "root"}: ${issue.message}`),
    };
  }
  const config = parsed.data;
  const errors: string[] = [];
  const warnings: string[] = [];
  const baseDir = path.dirname(configPath);

  // Reps
  const repEmails = new Set<string>();
  const reps: PlannedRep[] = config.reps.map((rep, i) => {
    if (repEmails.has(rep.email)) errors.push(`reps[${i}]: ${rep.email} is listed twice`);
    repEmails.add(rep.email);
    if (!isValidTimeZone(rep.timezone)) {
      errors.push(`reps[${i}] (${rep.email}) timezone: "${rep.timezone}" is not an IANA zone like America/New_York`);
    }
    let workingHours: WorkingHours | null = null;
    if (rep.workingHours) {
      workingHours = toWorkingHours(rep.workingHours);
      if (workingHours.startMinute >= workingHours.endMinute) {
        errors.push(`reps[${i}] (${rep.email}) workingHours: the end must be after the start (overnight shifts aren't supported)`);
      }
    }
    return { email: rep.email, name: rep.name, timezone: rep.timezone, workingHours };
  });

  // Teams
  const teamKeys = new Set<string>();
  const teams: PlannedTeam[] = config.teams.map((team, i) => {
    if (teamKeys.has(team.key)) errors.push(`teams[${i}]: team "${team.key}" is defined twice`);
    teamKeys.add(team.key);
    const seen = new Set<string>();
    team.members.forEach((member, j) => {
      if (!repEmails.has(member.rep)) {
        errors.push(`teams[${i}] (${team.key}) members[${j}]: ${member.rep} is not in reps`);
      }
      if (seen.has(member.rep)) errors.push(`teams[${i}] (${team.key}): ${member.rep} is listed twice`);
      seen.add(member.rep);
    });
    return { key: team.key, name: team.name ?? team.key, members: team.members };
  });

  // Forms and their rules
  const slugs = new Set<string>();
  const forms: PlannedForm[] = config.forms.map((form, i) => {
    const where = `forms[${i}] (${form.slug})`;
    if (slugs.has(form.slug)) errors.push(`${where}: slug is used twice`);
    slugs.add(form.slug);

    const fields = validateFormFields(form.fields);
    if (!fields.ok) {
      for (const error of fields.errors) errors.push(`${where} fields: ${error}`);
    }

    let ruleSet: RuleSet | null = null;
    if (form.rules !== undefined) {
      let rulesValue: unknown = form.rules;
      let source = `${where} rules`;
      if (typeof form.rules === "string") {
        const rulesPath = path.resolve(baseDir, form.rules);
        source = `${where} rules (${form.rules})`;
        try {
          const parsedRules = parseRuleSetYaml(readFile(rulesPath));
          if (!parsedRules.ok) {
            for (const error of parsedRules.errors) errors.push(`${source}: ${error}`);
            rulesValue = undefined;
          } else {
            rulesValue = parsedRules.value;
          }
        } catch {
          errors.push(`${source}: file not found (paths are relative to ${configPath})`);
          rulesValue = undefined;
        }
      }
      if (rulesValue !== undefined) {
        const validated = validateRuleSet(rulesValue);
        if (!validated.ok) {
          for (const error of validated.errors) errors.push(`${source}: ${error}`);
        } else {
          ruleSet = validated.ruleSet;
          if (fields.ok) checkRuleReferences(ruleSet, fields.fields, teamKeys, repEmails, source, errors, warnings);
        }
      }
    } else {
      warnings.push(`${where}: no rules — every lead goes to the fallback queue`);
    }
    return { slug: form.slug, name: form.name, fields: fields.ok ? fields.fields : [], ruleSet };
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, plan: { org: config.org, reps, teams, forms }, warnings };
}

/** Rules may only point at fields, teams, and reps that exist. */
function checkRuleReferences(
  ruleSet: RuleSet,
  fields: FormField[],
  teamKeys: Set<string>,
  repEmails: Set<string>,
  source: string,
  errors: string[],
  warnings: string[],
): void {
  const formKeys = new Set(fields.map((field) => field.key));
  if (emailFieldKey(fields)) for (const key of DERIVED_FORM_KEYS) formKeys.add(key);
  let usesCrm = false;

  const checkRoute = (route: RuleSet["fallback"], where: string) => {
    if ("team" in route && !teamKeys.has(route.team)) {
      errors.push(`${source} ${where}: team "${route.team}" is not defined in teams`);
    }
    if ("to" in route) {
      if (route.to.startsWith("crm.")) usesCrm = true;
      else if (route.to.startsWith("form.")) {
        const key = route.to.slice(5);
        if (!formKeys.has(key)) errors.push(`${source} ${where}: ${route.to} is not a field of this form`);
      } else if (!repEmails.has(route.to.toLowerCase())) {
        errors.push(`${source} ${where}: ${route.to} is not in reps`);
      }
    }
  };

  ruleSet.rules.forEach((rule, i) => {
    for (const rulePath of Object.keys(rule.when)) {
      if (rulePath.startsWith("crm.")) usesCrm = true;
      else {
        const key = rulePath.slice(5).split(".")[0]!;
        if (!formKeys.has(key)) {
          errors.push(
            `${source} rules[${i}] (${rule.name}): ${rulePath} is not a field of this form (fields: ${[...formKeys].join(", ")})`,
          );
        }
      }
    }
    checkRoute(rule.route, `rules[${i}] (${rule.name})`);
  });
  checkRoute(ruleSet.fallback, "fallback");
  if (usesCrm) {
    warnings.push(`${source}: reads crm.* — those conditions only match once HubSpot is connected`);
  }
}

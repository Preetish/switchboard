import type { ConfigInput } from "@switchboard/config";

/**
 * The reps and teams editor's state, and the way back to a full config
 * object for POST /api/admin/config/apply. Only reps and teams change here;
 * everything else in the config (org, theme, forms, rules) is passed through
 * untouched, so saving without edits applies the same plan.
 *
 * Plain functions with no React or I/O, so the save path is unit tested.
 */

/** switchboard.yaml's day names, in the order the config writes them. */
const CONFIG_DAY_ORDER = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Day = (typeof CONFIG_DAY_ORDER)[number];
/** Display order: the work week first. */
export const DAYS: readonly Day[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export type RepDraft = {
  /** Local key; team members point at it, so editing an email keeps memberships. */
  id: string;
  /** The email as last saved, or null for a rep added on this screen. */
  savedEmail: string | null;
  name: string;
  email: string;
  timezone: string;
  /** No days and no hours means no working hours (any time). */
  days: Day[];
  hours: string;
};

export type MemberDraft = { repId: string; weight: number; weeklyCapacity: number; active: boolean };
export type TeamDraft = { key: string; name: string; members: MemberDraft[] };

/** A HubSpot owner as GET /api/admin/hubspot/owners returns it. */
export type HubspotOwner = { id: string; email: string; name: string | null };

type MemberInput = NonNullable<ConfigInput["teams"]>[number]["members"][number];

export function draftsFromConfig(config: ConfigInput): { reps: RepDraft[]; teams: TeamDraft[] } {
  const reps: RepDraft[] = config.reps.map((rep, i) => ({
    id: `rep-${i}`,
    savedEmail: rep.email,
    name: rep.name,
    email: rep.email,
    timezone: rep.timezone ?? "UTC",
    days: [...(rep.workingHours?.days ?? [])],
    hours: rep.workingHours?.hours ?? "",
  }));
  const idByEmail = new Map(reps.map((rep) => [rep.email.toLowerCase(), rep.id]));
  const member = (input: MemberInput): MemberDraft => {
    const settings = typeof input === "string" ? { rep: input } : input;
    return {
      // The config lists every member as a rep, so the lookup always hits.
      repId: idByEmail.get(settings.rep.toLowerCase()) ?? "",
      weight: settings.weight ?? 1,
      weeklyCapacity: settings.weeklyCapacity ?? 0,
      active: settings.active ?? true,
    };
  };
  const teams: TeamDraft[] = (config.teams ?? []).map((team) => ({
    key: team.key,
    name: team.name ?? team.key,
    members: team.members.map(member),
  }));
  return { reps, teams };
}

/** The full config to save: `base` with its reps and teams replaced by the drafts. */
export function buildConfig(base: ConfigInput, reps: RepDraft[], teams: TeamDraft[]): ConfigInput {
  const emailById = new Map(reps.map((rep) => [rep.id, rep.email.trim()]));
  return {
    ...base,
    reps: reps.map((rep) => ({
      email: rep.email.trim(),
      name: rep.name,
      timezone: rep.timezone,
      ...(rep.days.length > 0 || rep.hours.trim()
        ? {
            workingHours: {
              days: CONFIG_DAY_ORDER.filter((day) => rep.days.includes(day)),
              hours: rep.hours.trim(),
            },
          }
        : {}),
    })),
    teams: teams.map((team) => ({
      key: team.key,
      name: team.name,
      members: team.members.map((member) => ({
        rep: emailById.get(member.repId) ?? "",
        weight: member.weight,
        weeklyCapacity: member.weeklyCapacity,
        active: member.active,
      })),
    })),
  };
}

/** A new rep from the add form; the email is kept exactly as given. */
export function newRep(id: string, fields: { name: string; email: string; timezone: string }): RepDraft {
  return { id, savedEmail: null, ...fields, days: [], hours: "" };
}

/** What picking a HubSpot owner fills in: their email exactly, so the join key matches. */
export function fieldsFromOwner(owner: HubspotOwner): { name: string; email: string } {
  return { name: owner.name ?? owner.email, email: owner.email };
}

/** Whether a HubSpot owner has this email (emails match case-insensitively). */
export function hasOwnerWithEmail(owners: HubspotOwner[], email: string): boolean {
  const wanted = email.trim().toLowerCase();
  return owners.some((owner) => owner.email.toLowerCase() === wanted);
}

export type PlacedErrors = {
  reps: Map<number, string[]>;
  teams: Map<number, string[]>;
  /** Errors that don't name a rep or team (forms, rules, the whole list). */
  other: string[];
};

/**
 * Sort the validator's errors to the rep row or team card they name, e.g.
 * `reps[2] (ana@acme.com) timezone: ...` goes to the third rep as
 * `timezone: ...`. The rest stay whole for the list at the top.
 */
export function placeErrors(errors: string[]): PlacedErrors {
  const placed: PlacedErrors = { reps: new Map(), teams: new Map(), other: [] };
  for (const error of errors) {
    const match = /^(reps|teams)\[(\d+)\](?: \([^)]*\))?[.:]?\s*/.exec(error);
    if (!match) {
      placed.other.push(error);
      continue;
    }
    const target = match[1] === "reps" ? placed.reps : placed.teams;
    const index = Number(match[2]);
    target.set(index, [...(target.get(index) ?? []), error.slice(match[0].length) || error]);
  }
  return placed;
}

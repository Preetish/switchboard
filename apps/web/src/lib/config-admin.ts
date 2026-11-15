import type { RuleSet } from "@switchboard/core";
import type { ConfigPlan } from "@switchboard/config";
import { forms, orgs, ruleSets, teamMembers, teams, users, type Database } from "@switchboard/db";
import { asc, eq } from "drizzle-orm";

/**
 * The org's current setup read back from the database, in the same shape
 * applyConfig writes (and serializeConfig turns into switchboard.yaml).
 * Returns null when the org doesn't exist.
 */
export async function getCurrentConfigPlan(db: Database, orgId: string): Promise<ConfigPlan | null> {
  const [org] = await db
    .select({ name: orgs.name, slug: orgs.slug, settings: orgs.settings })
    .from(orgs)
    .where(eq(orgs.id, orgId))
    .limit(1);
  if (!org) return null;

  const repRows = await db
    .select({ email: users.email, name: users.name, timezone: users.timezone, workingHours: users.workingHours })
    .from(users)
    .where(eq(users.orgId, orgId))
    .orderBy(asc(users.createdAt), asc(users.email));

  const teamRows = await db
    .select({ id: teams.id, key: teams.key, name: teams.name })
    .from(teams)
    .where(eq(teams.orgId, orgId))
    .orderBy(asc(teams.createdAt), asc(teams.key));
  const memberRows = await db
    .select({
      teamId: teamMembers.teamId,
      email: users.email,
      weight: teamMembers.weight,
      weeklyCapacity: teamMembers.weeklyCapacity,
      active: teamMembers.active,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .innerJoin(users, eq(teamMembers.userId, users.id))
    .where(eq(teams.orgId, orgId))
    .orderBy(asc(users.createdAt), asc(users.email));

  const formRows = await db
    .select({ form: forms, rules: ruleSets.rules })
    .from(forms)
    .leftJoin(ruleSets, eq(forms.ruleSetId, ruleSets.id))
    .where(eq(forms.orgId, orgId))
    .orderBy(asc(forms.createdAt), asc(forms.slug));

  return {
    org,
    // Config files match reps by lowercased email; applyConfig stores them that way.
    reps: repRows.map((rep) => ({ ...rep, email: rep.email.toLowerCase() })),
    teams: teamRows.map((team) => ({
      key: team.key,
      name: team.name,
      members: memberRows
        .filter((member) => member.teamId === team.id)
        .map((member) => ({
          rep: member.email.toLowerCase(),
          weight: member.weight,
          weeklyCapacity: member.weeklyCapacity,
          active: member.active,
        })),
    })),
    forms: formRows.map(({ form, rules }) => ({
      slug: form.slug,
      name: form.name,
      fields: form.fields,
      settings: form.settings,
      // Stored as applyConfig wrote it (a validated rule set); null = fallback only.
      ruleSet: (rules as RuleSet | null) ?? null,
    })),
  };
}

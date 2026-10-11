import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import {
  forms,
  orgs,
  ruleSets,
  teamMembers,
  teams,
  users,
  type Database,
} from "@switchboard/db";
import type { ConfigPlan } from "./load.js";

/**
 * Apply a validated plan in one transaction — either all of it lands or
 * none of it does. The file is the source of truth for what it lists:
 *
 * - Reps are created or updated by email (never deleted: their bookings and
 *   history stay; reps missing from the file are reported).
 * - Teams and memberships match the file exactly; removed teams and members
 *   are deleted. Rotation credit is kept for members who stay.
 * - Rule sets are versioned: identical rules reuse the existing version,
 *   changed rules get a new one, old versions are kept.
 * - Forms are created or updated by slug. Forms missing from the file are
 *   left alone (they hold lead data) and reported.
 */

export type ApplySummary = {
  org: string;
  reps: { created: number; updated: number; notInConfig: string[] };
  teams: { upserted: number; removed: string[] };
  forms: { created: number; updated: number; notInConfig: string[] };
  ruleSetVersionsCreated: number;
};

export async function applyConfig(db: Database, plan: ConfigPlan): Promise<ApplySummary> {
  return db.transaction(async (tx) => {
    const [org] = await tx
      .insert(orgs)
      .values({ name: plan.org.name, slug: plan.org.slug })
      .onConflictDoUpdate({ target: orgs.slug, set: { name: plan.org.name } })
      .returning({ id: orgs.id, name: orgs.name });
    const orgId = org!.id;

    // Reps
    const existingReps = await tx
      .select({ id: users.id, email: sql<string>`lower(${users.email})` })
      .from(users)
      .where(eq(users.orgId, orgId));
    const repIdByEmail = new Map(existingReps.map((rep) => [rep.email, rep.id]));
    let repsCreated = 0;
    let repsUpdated = 0;
    for (const rep of plan.reps) {
      const values = {
        name: rep.name,
        email: rep.email,
        timezone: rep.timezone,
        workingHours: rep.workingHours,
      };
      const id = repIdByEmail.get(rep.email);
      if (id) {
        await tx.update(users).set(values).where(eq(users.id, id));
        repsUpdated++;
      } else {
        const [row] = await tx
          .insert(users)
          .values({ orgId, ...values })
          .returning({ id: users.id });
        repIdByEmail.set(rep.email, row!.id);
        repsCreated++;
      }
    }
    const configured = new Set(plan.reps.map((rep) => rep.email));
    const repsNotInConfig = existingReps
      .map((rep) => rep.email)
      .filter((email) => !configured.has(email));

    // Teams and memberships
    const teamKeys = plan.teams.map((team) => team.key);
    const removedTeams = await tx
      .delete(teams)
      .where(
        teamKeys.length > 0
          ? and(eq(teams.orgId, orgId), notInArray(teams.key, teamKeys))
          : eq(teams.orgId, orgId),
      )
      .returning({ key: teams.key });
    for (const team of plan.teams) {
      const [row] = await tx
        .insert(teams)
        .values({ orgId, key: team.key, name: team.name })
        .onConflictDoUpdate({ target: [teams.orgId, teams.key], set: { name: team.name } })
        .returning({ id: teams.id });
      const teamId = row!.id;
      const memberIds = team.members.map((member) => repIdByEmail.get(member.rep)!);
      await tx
        .delete(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), notInArray(teamMembers.userId, memberIds)));
      for (const member of team.members) {
        const settings = {
          weight: member.weight,
          weeklyCapacity: member.weeklyCapacity,
          active: member.active,
        };
        await tx
          .insert(teamMembers)
          .values({ teamId, userId: repIdByEmail.get(member.rep)!, ...settings })
          .onConflictDoUpdate({ target: [teamMembers.teamId, teamMembers.userId], set: settings });
      }
    }

    // Rule sets: reuse an identical version, otherwise add the next one.
    let ruleSetVersionsCreated = 0;
    const ruleSetIdFor = async (rules: unknown): Promise<string> => {
      const json = JSON.stringify(rules);
      const [existing] = await tx
        .select({ id: ruleSets.id })
        .from(ruleSets)
        .where(and(eq(ruleSets.orgId, orgId), sql`${ruleSets.rules} = ${json}::jsonb`))
        .limit(1);
      if (existing) return existing.id;
      const [{ next }] = (await tx
        .select({ next: sql<number>`coalesce(max(${ruleSets.version}), 0) + 1` })
        .from(ruleSets)
        .where(eq(ruleSets.orgId, orgId))) as [{ next: number }];
      const [row] = await tx
        .insert(ruleSets)
        .values({ orgId, version: next, rules: rules as object })
        .returning({ id: ruleSets.id });
      ruleSetVersionsCreated++;
      return row!.id;
    };

    // Forms
    const slugs = plan.forms.map((form) => form.slug);
    const taken = await tx
      .select({ slug: forms.slug, orgId: forms.orgId })
      .from(forms)
      .where(inArray(forms.slug, slugs));
    const foreign = taken.filter((form) => form.orgId !== orgId).map((form) => form.slug);
    if (foreign.length > 0) {
      throw new Error(`Form slug already used by another org: ${foreign.join(", ")}`);
    }
    const existingSlugs = new Set(taken.map((form) => form.slug));
    let formsCreated = 0;
    let formsUpdated = 0;
    for (const form of plan.forms) {
      const ruleSetId = form.ruleSet ? await ruleSetIdFor(form.ruleSet) : null;
      const values = { name: form.name, fields: form.fields, ruleSetId };
      await tx
        .insert(forms)
        .values({ orgId, slug: form.slug, ...values })
        .onConflictDoUpdate({ target: forms.slug, set: values });
      if (existingSlugs.has(form.slug)) formsUpdated++;
      else formsCreated++;
    }
    const formsNotInConfig = (
      await tx
        .select({ slug: forms.slug })
        .from(forms)
        .where(and(eq(forms.orgId, orgId), notInArray(forms.slug, slugs)))
    ).map((form) => form.slug);

    return {
      org: org!.name,
      reps: { created: repsCreated, updated: repsUpdated, notInConfig: repsNotInConfig },
      teams: { upserted: plan.teams.length, removed: removedTeams.map((team) => team.key) },
      forms: { created: formsCreated, updated: formsUpdated, notInConfig: formsNotInConfig },
      ruleSetVersionsCreated,
    };
  });
}

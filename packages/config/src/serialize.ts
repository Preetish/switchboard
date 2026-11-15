import type { WorkingHours } from "@switchboard/core";
import { stringify } from "yaml";
import type { ConfigPlan, PlannedTeam } from "./load.js";
import { DAY_NAMES, type ConfigInput } from "./schema.js";

/**
 * Render a plan back to switchboard.yaml text: the inverse of loadConfig,
 * so loading the result gives the same plan. Rules are written inline under
 * each form (there are no rule files to point at).
 */

function fromWorkingHours(workingHours: WorkingHours): { days: (typeof DAY_NAMES)[number][]; hours: string } {
  const time = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  return {
    days: workingHours.days.map((day) => DAY_NAMES[day]!),
    hours: `${time(workingHours.startMinute)}-${time(workingHours.endMinute)}`,
  };
}

/** A member with default settings is written as just the rep's email. */
function fromMember({ rep, weight, weeklyCapacity, active }: PlannedTeam["members"][number]) {
  const isDefault = weight === 1 && weeklyCapacity === 0 && active;
  return isDefault ? rep : { rep, weight, weeklyCapacity, active };
}

/**
 * The plan as a config object (switchboard.yaml's shape), e.g. for the
 * visual builder to edit and send to loadConfigObject.
 */
export function toConfigObject(plan: ConfigPlan): ConfigInput {
  const { hubspotProperties, theme, customCss } = plan.org.settings;
  return {
    org: { name: plan.org.name, slug: plan.org.slug },
    ...(theme ? { theme } : {}),
    ...(customCss ? { customCss } : {}),
    ...(hubspotProperties ? { hubspot: { properties: hubspotProperties } } : {}),
    reps: plan.reps.map((rep) => ({
      email: rep.email,
      name: rep.name,
      timezone: rep.timezone,
      ...(rep.workingHours ? { workingHours: fromWorkingHours(rep.workingHours) } : {}),
    })),
    teams: plan.teams.map((team) => ({
      key: team.key,
      name: team.name,
      members: team.members.map(fromMember),
    })),
    forms: plan.forms.map((form) => ({
      slug: form.slug,
      name: form.name,
      ...(form.settings.submitLabel ? { submitLabel: form.settings.submitLabel } : {}),
      ...(form.settings.selfServeUrl ? { selfServeUrl: form.settings.selfServeUrl } : {}),
      ...(form.settings.theme ? { theme: form.settings.theme } : {}),
      ...(form.settings.customCss ? { customCss: form.settings.customCss } : {}),
      fields: form.fields,
      ...(form.ruleSet ? { rules: { rules: form.ruleSet.rules, fallback: form.ruleSet.fallback } } : {}),
    })),
  };
}

/** The plan as switchboard.yaml text. */
export function serializeConfig(plan: ConfigPlan): string {
  // No anchors/aliases: shared objects are written out in full, as a person would.
  return stringify(toConfigObject(plan), { aliasDuplicateObjects: false });
}

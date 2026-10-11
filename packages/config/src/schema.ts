import { z } from "zod";

/**
 * The shape of switchboard.yaml. Everything an org needs to route leads —
 * reps, teams, forms, and their rules — lives in one reviewable file, so
 * routing changes go through the same pull requests as code.
 */

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KEY_RE = /^[a-z][a-z0-9_-]*$/;
const HOURS_RE = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-4]):([0-5]\d)$/;

export const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

const email = z.email("must be an email address").transform((value) => value.toLowerCase());

const workingHours = z.strictObject({
  days: z.array(z.enum(DAY_NAMES)).min(1, "list at least one day"),
  hours: z
    .string()
    .regex(HOURS_RE, 'use 24-hour "HH:MM-HH:MM", e.g. "09:00-17:00"'),
});

const rep = z.strictObject({
  email,
  name: z.string().min(1).max(120),
  timezone: z.string().default("UTC"),
  workingHours: workingHours.optional(),
});

const member = z.union([
  email.transform((repEmail) => ({ rep: repEmail, weight: 1, weeklyCapacity: 0, active: true })),
  z.strictObject({
    rep: email,
    weight: z.int().min(1).max(100).default(1),
    weeklyCapacity: z.int().min(0).max(1000).default(0),
    active: z.boolean().default(true),
  }),
]);

const team = z.strictObject({
  key: z.string().regex(KEY_RE, "lowercase letters, digits, - and _, starting with a letter"),
  name: z.string().min(1).max(120).optional(),
  members: z.array(member).min(1, "a team needs at least one member"),
});

const form = z.strictObject({
  slug: z.string().regex(SLUG_RE, "lowercase letters, digits, and dashes (it's the public URL)"),
  name: z.string().min(1).max(120),
  fields: z.array(z.unknown()).min(1),
  /** A path to a rule file (relative to this file) or the rule set inline. */
  rules: z.union([z.string().min(1), z.record(z.string(), z.unknown())]).optional(),
});

export const configSchema = z.strictObject({
  org: z.strictObject({
    name: z.string().min(1).max(120),
    slug: z.string().regex(SLUG_RE, "lowercase letters, digits, and dashes"),
  }),
  reps: z.array(rep).min(1, "add at least one rep"),
  teams: z.array(team).default([]),
  forms: z.array(form).min(1, "add at least one form"),
});

export type ConfigInput = z.input<typeof configSchema>;
export type ParsedConfig = z.output<typeof configSchema>;

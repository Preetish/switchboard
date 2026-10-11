import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { FormField, WorkingHours } from "@switchboard/core";

export type { FormField, WorkingHours };

export type DecisionOutcome = {
  kind: "route_user" | "route_team" | "self_serve_link" | "fallback_queue";
  userId?: string;
  teamId?: string;
  strategy?: "round_robin" | "existing_owner";
  reason: string;
};

export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name").notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    workingHours: jsonb("working_hours").$type<WorkingHours>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_org_email_uq").on(t.orgId, t.email)],
);

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    /** Stable key used in rule files, e.g. `team: enterprise`. */
    key: text("key").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("teams_org_key_uq").on(t.orgId, t.key)],
);

export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    weight: integer("weight").notNull().default(1),
    /** Max bookings per week; 0 means unlimited. */
    weeklyCapacity: integer("weekly_capacity").notNull().default(0),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("team_members_team_user_uq").on(t.teamId, t.userId)],
);

export const ruleSets = pgTable(
  "rule_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    /** Parsed rule file (rules + fallback), git-friendly YAML stored as JSON. */
    rules: jsonb("rules").$type<unknown>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("rule_sets_org_version_uq").on(t.orgId, t.version)],
);

export const forms = pgTable(
  "forms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    fields: jsonb("fields").$type<FormField[]>().notNull(),
    /** Rule set version this form routes with; null = fallback only. */
    ruleSetId: uuid("rule_set_id").references((): AnyPgColumn => ruleSets.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Slug is the public key of a hosted/embedded form (`/f/:slug`), so it is
  // globally unique; the org-scoped index keeps per-org lookups fast.
  (t) => [
    uniqueIndex("forms_slug_key_uq").on(t.slug),
    uniqueIndex("forms_org_slug_uq").on(t.orgId, t.slug),
  ],
);

export const submissions = pgTable(
  "submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    formId: uuid("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    data: jsonb("data").$type<Record<string, string>>().notNull(),
    email: text("email"),
    /** Client-provided key for idempotent retries; unique per form. */
    idempotencyKey: text("idempotency_key"),
    /** Set when the speed-to-lead alert for this lead was sent (at-most-once marker). */
    alertedAt: timestamp("alerted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("submissions_form_idempotency_uq").on(t.formId, t.idempotencyKey),
    index("submissions_created_at_idx").on(t.createdAt),
  ],
);

export const routingDecisions = pgTable(
  "routing_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    /** Full evaluation inputs (form data + CRM lookups). */
    inputs: jsonb("inputs").$type<Record<string, unknown>>().notNull(),
    /** Rule that fired; null when only the fallback matched. */
    matchedRule: text("matched_rule"),
    outcome: jsonb("outcome").$type<DecisionOutcome>().notNull(),
    latencyMs: integer("latency_ms").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("routing_decisions_created_at_idx").on(t.orgId, t.createdAt),
    index("routing_decisions_submission_idx").on(t.submissionId),
  ],
);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    submissionId: uuid("submission_id").references(() => submissions.id, {
      // A booking is derived from the lead's submission: when the lead
      // erases their data (GDPR delete), the booking must not outlive it —
      // it would keep blocking the rep's slot with no lead behind it.
      onDelete: "cascade",
    }),
    decisionId: uuid("decision_id").references(() => routingDecisions.id, {
      onDelete: "set null",
    }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    /**
     * `hold` claims a slot while the calendar event is created (released by
     * lazy cleanup after ~5 minutes, e.g. when the process dies mid-flow).
     */
    status: text("status", { enum: ["hold", "confirmed", "cancelled"] })
      .notNull()
      .default("confirmed"),
    calendarEventId: text("calendar_event_id"),
    meetLink: text("meet_link"),
    /**
     * HubSpot meeting id for the write-back ("logged meeting"); when set the
     * meeting is already on the contact's timeline and the log is skipped,
     * keeping CRM write-back idempotent.
     */
    crmMeetingId: text("crm_meeting_id"),
    /** Client key so booking retries return the original instead of duplicating. */
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Double-booking guard: the `bookings_no_overlap` exclusion constraint
  // (btree_gist, migration 0007 — drizzle cannot express EXCLUDE) rejects any
  // two live bookings for one rep whose [start, end) ranges overlap.
  // Cancelled rows never block a slot.
  (t) => [
    // One live booking per lead; retries return it instead of booking again.
    uniqueIndex("bookings_active_submission_uq")
      .on(t.submissionId)
      .where(sql`${t.status} in ('hold', 'confirmed')`),
    // Idempotency keys are scoped to the lead they were issued for.
    uniqueIndex("bookings_submission_idempotency_uq").on(t.submissionId, t.idempotencyKey),
    index("bookings_user_start_idx").on(t.userId, t.startAt),
    index("bookings_status_created_idx").on(t.status, t.createdAt),
    check("bookings_end_after_start", sql`${t.endAt} > ${t.startAt}`),
    check("bookings_status_valid", sql`${t.status} in ('hold', 'confirmed', 'cancelled')`),
  ],
);

export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    /**
     * The rep a per-user connection belongs to (Google Calendar: each rep
     * connects their own calendar). Null for org-wide connections (HubSpot).
     */
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", {
      enum: ["google_calendar", "hubspot", "slack"],
    }).notNull(),
    /** AES-encrypted OAuth token blob (IV + ciphertext), never stored in plaintext. */
    tokenCipher: text("token_cipher").notNull(),
    scopes: text("scopes"),
    /** Account the tokens belong to (e.g. the rep's Google address), for display. */
    accountEmail: text("account_email"),
    status: text("status", { enum: ["connected", "expired", "revoked"] })
      .notNull()
      .default("connected"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // One org-wide connection per provider, and one per rep per provider.
  (t) => [
    uniqueIndex("integrations_org_provider_uq")
      .on(t.orgId, t.provider)
      .where(sql`${t.userId} is null`),
    uniqueIndex("integrations_user_provider_uq")
      .on(t.userId, t.provider)
      .where(sql`${t.userId} is not null`),
  ],
);

export const orgsRelations = relations(orgs, ({ many }) => ({
  users: many(users),
  teams: many(teams),
  forms: many(forms),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  org: one(orgs, { fields: [users.orgId], references: [orgs.id] }),
  teamMemberships: many(teamMembers),
  bookings: many(bookings),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
  org: one(orgs, { fields: [teams.orgId], references: [orgs.id] }),
  members: many(teamMembers),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  team: one(teams, { fields: [teamMembers.teamId], references: [teams.id] }),
  user: one(users, { fields: [teamMembers.userId], references: [users.id] }),
}));

export const ruleSetsRelations = relations(ruleSets, ({ one, many }) => ({
  org: one(orgs, { fields: [ruleSets.orgId], references: [orgs.id] }),
  forms: many(forms),
}));

export const formsRelations = relations(forms, ({ one, many }) => ({
  org: one(orgs, { fields: [forms.orgId], references: [orgs.id] }),
  ruleSet: one(ruleSets, { fields: [forms.ruleSetId], references: [ruleSets.id] }),
  submissions: many(submissions),
}));

export const submissionsRelations = relations(submissions, ({ one, many }) => ({
  org: one(orgs, { fields: [submissions.orgId], references: [orgs.id] }),
  form: one(forms, { fields: [submissions.formId], references: [forms.id] }),
  decisions: many(routingDecisions),
}));

export const routingDecisionsRelations = relations(routingDecisions, ({ one }) => ({
  submission: one(submissions, {
    fields: [routingDecisions.submissionId],
    references: [submissions.id],
  }),
}));

export const bookingsRelations = relations(bookings, ({ one }) => ({
  user: one(users, { fields: [bookings.userId], references: [users.id] }),
}));

export type Org = typeof orgs.$inferSelect;
export type User = typeof users.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type TeamMember = typeof teamMembers.$inferSelect;
export type RuleSet = typeof ruleSets.$inferSelect;
export type Form = typeof forms.$inferSelect;
export type Submission = typeof submissions.$inferSelect;
export type RoutingDecision = typeof routingDecisions.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type Integration = typeof integrations.$inferSelect;

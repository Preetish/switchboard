import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { bookings, forms, routingDecisions, teamMembers } from "../src/schema.js";

const migrationDir = fileURLToPath(new URL("../migrations", import.meta.url));
const migration = readFileSync(
  `${migrationDir}/0000_mysterious_wrecking_crew.sql`,
  "utf8",
);
const migration0002 = readFileSync(
  `${migrationDir}/0002_busy_nightmare.sql`,
  "utf8",
);
const migration0003 = readFileSync(
  `${migrationDir}/0003_simple_celestials.sql`,
  "utf8",
);
const migration0004 = readFileSync(
  `${migrationDir}/0004_glamorous_salo.sql`,
  "utf8",
);
const migration0005 = readFileSync(
  `${migrationDir}/0005_cheerful_purifiers.sql`,
  "utf8",
);
const migration0006 = readFileSync(`${migrationDir}/0006_per_rep_calendars.sql`, "utf8");

describe("generated migration", () => {
  it("creates every v0.1 table", () => {
    for (const table of [
      "orgs",
      "users",
      "teams",
      "team_members",
      "forms",
      "rule_sets",
      "submissions",
      "routing_decisions",
      "bookings",
      "integrations",
    ]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    }
  });

  it("constrains a rep to one booking per start time", () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "bookings_user_start_uq" ON "bookings" USING btree ("user_id","start_at")',
    );
  });

  it("makes bookings idempotent per key", () => {
    expect(migration0002).toContain(
      'CREATE UNIQUE INDEX "bookings_idempotency_uq" ON "bookings" USING btree ("idempotency_key")',
    );
  });

  it("tracks the HubSpot meeting write-back on the booking", () => {
    expect(migration0003).toContain(
      'ALTER TABLE "bookings" ADD COLUMN "crm_meeting_id" text',
    );
  });

  it("makes submissions idempotent per form and key", () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "submissions_form_idempotency_uq" ON "submissions" USING btree ("form_id","idempotency_key")',
    );
  });

  it("stores one org-wide integration per provider, and one per rep per provider", () => {
    expect(migration0006).toContain(
      'CREATE UNIQUE INDEX "integrations_org_provider_uq" ON "integrations" USING btree ("org_id","provider") WHERE "integrations"."user_id" is null',
    );
    expect(migration0006).toContain(
      'CREATE UNIQUE INDEX "integrations_user_provider_uq" ON "integrations" USING btree ("user_id","provider") WHERE "integrations"."user_id" is not null',
    );
  });

  it("never duplicates a rule set version per org", () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "rule_sets_org_version_uq" ON "rule_sets" USING btree ("org_id","version")',
    );
  });

  it("cascades org deletes down to owned rows", () => {
    // orgs → users/teams/forms/rule_sets/submissions/routing_decisions/
    // bookings/integrations cascade directly; team_members cascades via team.
    const cascadeFks = migration.match(/_org_id_orgs_id_fk.*ON DELETE cascade/g) ?? [];
    expect(cascadeFks.length).toBe(8);
  });

  it("deletes a booking when its lead's submission is erased (GDPR)", () => {
    // The booking is derived from the submission; a set-null orphan would
    // keep blocking the rep's slot with no lead behind it. Migration 0004
    // replaces 0000's set-null FK with a cascading one.
    expect(migration0004).toContain(
      'ALTER TABLE "bookings" ADD CONSTRAINT "bookings_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action',
    );
  });

  it("marks submissions with the speed-to-lead alert timestamp", () => {
    expect(migration0005).toContain(
      'ALTER TABLE "submissions" ADD COLUMN "alerted_at" timestamp with time zone',
    );
  });
});

describe("schema definition", () => {
  it("exposes the expected columns on bookings", () => {
    expect(Object.keys(getTableColumns(bookings))).toEqual([
      "id",
      "orgId",
      "userId",
      "submissionId",
      "decisionId",
      "startAt",
      "endAt",
      "status",
      "calendarEventId",
      "meetLink",
      "crmMeetingId",
      "confirmationSentAt",
      "idempotencyKey",
      "createdAt",
    ]);
  });

  it("records latency for every routing decision", () => {
    expect(getTableColumns(routingDecisions).latencyMs.notNull).toBe(true);
  });

  it("defaults team members to active with weight 1", () => {
    expect(teamMembers.weight.default).toEqual(1);
    expect(teamMembers.active.default).toEqual(true);
  });

  it("links forms to their routing rule set", () => {
    expect(getTableColumns(forms).ruleSetId).toBeDefined();
  });
});

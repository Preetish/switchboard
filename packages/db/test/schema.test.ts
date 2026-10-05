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

  it("makes submissions idempotent per form and key", () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "submissions_form_idempotency_uq" ON "submissions" USING btree ("form_id","idempotency_key")',
    );
  });

  it("stores exactly one integration per provider per org", () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "integrations_org_provider_uq" ON "integrations" USING btree ("org_id","provider")',
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

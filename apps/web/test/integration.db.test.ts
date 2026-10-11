/**
 * Integration tests against a real Postgres: the paths where correctness
 * lives in SQL (constraints, transactions, row locks) rather than in pure
 * functions. Runs when TEST_DATABASE_URL is set (CI provides a Postgres
 * service); skipped otherwise. The database is wiped and migrated first.
 *
 *   TEST_DATABASE_URL=postgres://localhost:5432/switchboard_test npm test
 */
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { and, eq, sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@switchboard/db";

const TEST_URL = process.env.TEST_DATABASE_URL;

// Side effects go to pg-boss in production; here they are recorded instead.
const scheduled: string[] = [];
vi.mock("@/lib/jobs", () => ({
  scheduleSpeedToLeadAlert: async (id: string) => void scheduled.push(`alert:${id}`),
  scheduleCrmSync: async (_db: unknown, id: string) => void scheduled.push(`crm:${id}`),
  scheduleBookingFollowup: async (_db: unknown, id: string) => void scheduled.push(`followup:${id}`),
}));

const CONFIG = `
org: { name: Test Co, slug: test-co }
reps:
  - { email: alice@test.co, name: Alice, timezone: America/New_York }
  - { email: bob@test.co, name: Bob, timezone: America/New_York }
  - { email: carol@test.co, name: Carol, timezone: Europe/London }
teams:
  - key: enterprise
    members: [{ rep: alice@test.co, weight: 2 }, bob@test.co]
  - key: default
    members: [carol@test.co]
forms:
  - slug: demo
    name: Demo
    fields:
      - { key: name, label: Name, type: text, required: true }
      - { key: email, label: Email, type: email, required: true }
      - { key: size, label: Size, type: number, required: true }
    rules:
      rules:
        - { name: Personal, when: { form.email_domain: { in: [gmail.com] } }, route: { action: self_serve_link } }
        - { name: Enterprise, when: { form.size: { gte: 500 } }, route: { team: enterprise, strategy: round_robin } }
      fallback: { team: default, strategy: round_robin }
`;

describe.skipIf(!TEST_URL)("against Postgres", () => {
  let db: Database;
  let mods: {
    handleSubmission: typeof import("@/lib/submit").handleSubmission;
    createBooking: typeof import("@/lib/bookings").createBooking;
    getAvailability: typeof import("@/lib/integrations").getAvailability;
    eraseFormSubmissions: typeof import("@/lib/erasure").eraseFormSubmissions;
    config: typeof import("@switchboard/config");
    schema: typeof import("@switchboard/db");
  };

  const submit = (data: Record<string, unknown>, key?: string) =>
    mods.handleSubmission(db, "demo", { name: "Lead", size: "900", ...data }, key);
  const repId = async (email: string) => {
    const [row] = await db
      .select({ id: mods.schema.users.id })
      .from(mods.schema.users)
      .where(eq(mods.schema.users.email, email));
    return row!.id;
  };

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: TEST_URL });
    await admin.connect();
    await admin.query("drop schema if exists public cascade; create schema public;");
    await admin.query("drop schema if exists drizzle cascade;");
    await migrate(drizzle(admin), {
      migrationsFolder: fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url)),
    });
    await admin.end();

    process.env.DATABASE_URL = TEST_URL;
    const { getDb } = await import("@/lib/db");
    db = getDb();
    mods = {
      handleSubmission: (await import("@/lib/submit")).handleSubmission,
      createBooking: (await import("@/lib/bookings")).createBooking,
      getAvailability: (await import("@/lib/integrations")).getAvailability,
      eraseFormSubmissions: (await import("@/lib/erasure")).eraseFormSubmissions,
      config: await import("@switchboard/config"),
      schema: await import("@switchboard/db"),
    };
    const loaded = mods.config.loadConfig(CONFIG, "/cfg/switchboard.yaml", () => "");
    if (!loaded.ok) throw new Error(loaded.errors.join("\n"));
    await mods.config.applyConfig(db, loaded.plan);
  });

  afterAll(async () => {
    await db?.$client.end();
  });

  describe("config apply", () => {
    it("is idempotent: re-applying the same file changes nothing", async () => {
      const loaded = mods.config.loadConfig(CONFIG, "/cfg/switchboard.yaml", () => "");
      if (!loaded.ok) throw new Error("invalid");
      const summary = await mods.config.applyConfig(db, loaded.plan);
      expect(summary.ruleSetVersionsCreated).toBe(0);
      expect(summary.reps).toMatchObject({ created: 0, updated: 3 });
      expect(summary.forms).toMatchObject({ created: 0, updated: 1 });
    });
  });

  describe("submissions", () => {
    it("routes by rules with the derived email domain, and records the decision", async () => {
      const personal = await submit({ email: "sam@gmail.com" });
      expect(personal.status === "created" && personal.decision.kind).toBe("self_serve_link");
      const team = await submit({ email: "cto@bigcorp.com" });
      if (team.status !== "created") throw new Error(team.status);
      expect(team.decision).toMatchObject({ kind: "route_team" });
      expect(team.decision.userId).toBeTruthy();
      const decisions = await db
        .select()
        .from(mods.schema.routingDecisions)
        .where(eq(mods.schema.routingDecisions.submissionId, team.submissionId));
      expect(decisions).toHaveLength(1);
      expect(decisions[0]!.matchedRule).toBe("Enterprise");
      expect(scheduled).toContain(`alert:${team.submissionId}`);
    });

    it("returns the original decision for a retried submission", async () => {
      const first = await submit({ email: "retry@bigcorp.com" }, "key-1");
      const again = await submit({ email: "retry@bigcorp.com" }, "key-1");
      expect(again.status).toBe("duplicate");
      if (first.status !== "created" || again.status !== "duplicate") throw new Error("shape");
      expect(again.submissionId).toBe(first.submissionId);
      expect(again.decision).toEqual(first.decision);
    });

    it("splits concurrent leads exactly by weight (row-locked rotation)", async () => {
      await db.update(mods.schema.teamMembers).set({ rrCredit: 0 });
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) => submit({ email: `c${i}@bigcorp.com` })),
      );
      const alice = await repId("alice@test.co");
      const picks = results.map((r) => (r.status === "created" ? r.decision.userId : null));
      expect(picks.filter((id) => id === alice)).toHaveLength(8);
      expect(picks.filter((id) => id !== alice)).toHaveLength(4);
    });
  });

  describe("bookings", () => {
    async function routedLead(email: string) {
      for (let i = 0; i < 6; i++) {
        const result = await submit({ email: `${i}-${email}` });
        if (result.status === "created" && result.decision.userId === (await repId("alice@test.co"))) {
          return { submissionId: result.submissionId, userId: result.decision.userId! };
        }
      }
      throw new Error("no lead routed to Alice");
    }

    it("enforces routed rep, offered slots, one booking per lead, and no overlaps", async () => {
      const lead = await routedLead("booker@bigcorp.com");
      const availability = await mods.getAvailability(db, lead.userId, 30, 14);
      const slot = new Date(availability!.slots[0]!.start);

      const wrongRep = await mods.createBooking(db, {
        ...lead,
        userId: await repId("bob@test.co"),
        startAt: slot,
        durationMinutes: 30,
      });
      expect(wrongRep.status).toBe("invalid");

      const offGrid = await mods.createBooking(db, {
        ...lead,
        startAt: new Date(slot.getTime() + 7 * 60_000),
        durationMinutes: 30,
      });
      expect(offGrid.status).toBe("invalid");

      const booked = await mods.createBooking(db, { ...lead, startAt: slot, durationMinutes: 30 });
      expect(booked).toMatchObject({ status: "created", duplicate: false });

      const again = await mods.createBooking(db, {
        ...lead,
        startAt: new Date(slot.getTime() + 60 * 60_000),
        durationMinutes: 30,
      });
      expect(again).toMatchObject({ status: "created", duplicate: true });

      // Another lead asks for an hour that starts 30 minutes earlier and
      // overlaps the booked half hour: the exclusion constraint refuses it.
      const other = await routedLead("other@bigcorp.com");
      const earlier = new Date(slot.getTime() - 30 * 60_000);
      const overlap = await mods.createBooking(db, { ...other, startAt: earlier, durationMinutes: 60 });
      expect(["slot_taken", "invalid"]).toContain(overlap.status);
      // And directly at the database level, with no app checks in the way:
      await expect(
        db.insert(mods.schema.bookings).values({
          orgId: (await db.select().from(mods.schema.orgs))[0]!.id,
          userId: lead.userId,
          startAt: new Date(slot.getTime() + 10 * 60_000),
          endAt: new Date(slot.getTime() + 40 * 60_000),
          status: "confirmed",
        }),
      ).rejects.toMatchObject({ cause: { code: "23P01" } });

      // The booked slot disappears from availability…
      const after = await mods.getAvailability(db, lead.userId, 30, 14);
      expect(after!.slots.some((s) => s.start === slot.toISOString())).toBe(false);
      // …and comes back once the booking is cancelled.
      await db
        .update(mods.schema.bookings)
        .set({ status: "cancelled" })
        .where(eq(mods.schema.bookings.submissionId, lead.submissionId));
      const reopened = await mods.getAvailability(db, lead.userId, 30, 14);
      expect(reopened!.slots.some((s) => s.start === slot.toISOString())).toBe(true);
    });
  });

  describe("erasure", () => {
    it("removes the lead's submissions, decisions, and bookings", async () => {
      const result = await submit({ email: "forget-me@bigcorp.com" });
      if (result.status !== "created") throw new Error(result.status);
      const removed = await mods.eraseFormSubmissions(db, {
        slug: "demo",
        email: "forget-me@bigcorp.com",
      });
      expect(removed).toBe(1);
      const [{ count }] = (await db
        .select({ count: sql<number>`count(*)::int` })
        .from(mods.schema.routingDecisions)
        .where(and(eq(mods.schema.routingDecisions.submissionId, result.submissionId)))) as [
        { count: number },
      ];
      expect(count).toBe(0);
    });
  });
});

import { routingDecisions, submissions, users, type Database } from "@switchboard/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hubspot = vi.hoisted(() => ({
  findOwnerByEmail: vi.fn(),
  upsertContact: vi.fn(),
}));
vi.mock("@switchboard/crm-hubspot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@switchboard/crm-hubspot")>()),
  ...hubspot,
}));
vi.mock("@/lib/token-store", () => ({ getValidAccessToken: async () => "token" }));

const { syncLeadToCrm } = await import("@/lib/crm");

/**
 * A stand-in for the few queries syncLeadToCrm runs: each select returns the
 * rows given for the table it reads, and updates are recorded.
 */
function fakeDb(rows: Map<unknown, unknown[]>) {
  const updates: unknown[] = [];
  let table: unknown;
  const chain = {
    select: () => chain,
    from: (from: unknown) => {
      table = from;
      return chain;
    },
    innerJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: async () => rows.get(table) ?? [],
    update: () => chain,
    set: (values: unknown) => {
      updates.push(values);
      return chain;
    },
  };
  return { db: chain as unknown as Database, updates };
}

const submission = (setHubspotOwner?: boolean) => ({
  orgId: "org-1",
  email: "lead@bigcorp.com",
  data: { name: "Lee Park", company: "Bigcorp" },
  attribution: null,
  crmSyncedAt: null,
  orgSettings: {},
  formSettings: setHubspotOwner === undefined ? {} : { setHubspotOwner },
});

const routedTo = (userId?: string) => ({
  outcome: { kind: "route_team", userId, reason: "Round robin" },
});

function lead({
  setHubspotOwner,
  decision = routedTo("rep-1"),
}: {
  setHubspotOwner?: boolean;
  decision?: ReturnType<typeof routedTo> | null;
}) {
  return fakeDb(
    new Map<unknown, unknown[]>([
      [submissions, [submission(setHubspotOwner)]],
      [routingDecisions, decision ? [decision] : []],
      [users, [{ email: "ana@acme.com" }]],
    ]),
  );
}

const upsertedProperties = () =>
  (hubspot.upsertContact.mock.calls[0]![0] as { properties: Record<string, string> })
    .properties;

beforeEach(() => {
  hubspot.findOwnerByEmail.mockReset();
  hubspot.upsertContact.mockReset().mockResolvedValue({ id: "contact-1" });
});

describe("syncLeadToCrm contact owner", () => {
  it("sets the routed rep's HubSpot owner on the contact upsert when the form says so", async () => {
    hubspot.findOwnerByEmail.mockResolvedValue({ id: "owner-9", email: "ana@acme.com", name: "Ana" });
    const { db, updates } = lead({ setHubspotOwner: true });
    await syncLeadToCrm(db, "sub-1");
    expect(hubspot.findOwnerByEmail).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "token", email: "ana@acme.com" }),
    );
    expect(hubspot.upsertContact).toHaveBeenCalledTimes(1);
    expect(upsertedProperties()).toEqual({
      firstname: "Lee",
      lastname: "Park",
      company: "Bigcorp",
      hubspot_owner_id: "owner-9",
    });
    expect(updates).toHaveLength(1);
  });

  it.each([
    ["off", false],
    ["absent", undefined],
  ])("leaves the owner out and skips the lookup when the switch is %s", async (_, value) => {
    const { db } = lead({ setHubspotOwner: value });
    await syncLeadToCrm(db, "sub-1");
    expect(hubspot.findOwnerByEmail).not.toHaveBeenCalled();
    expect(upsertedProperties()).not.toHaveProperty("hubspot_owner_id");
  });

  it("leaves the contact owner untouched when the rep has no HubSpot owner record", async () => {
    hubspot.findOwnerByEmail.mockResolvedValue(null);
    const { db, updates } = lead({ setHubspotOwner: true });
    await syncLeadToCrm(db, "sub-1");
    expect(upsertedProperties()).not.toHaveProperty("hubspot_owner_id");
    expect(updates).toHaveLength(1);
  });

  it.each([
    ["no routing decision", null],
    ["a decision with no rep (fallback queue, self serve)", routedTo()],
  ])("leaves the contact owner untouched with %s", async (_, decision) => {
    const { db } = lead({ setHubspotOwner: true, decision });
    await syncLeadToCrm(db, "sub-1");
    expect(hubspot.findOwnerByEmail).not.toHaveBeenCalled();
    expect(upsertedProperties()).not.toHaveProperty("hubspot_owner_id");
  });

  it("still writes the contact when the owner lookup fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    hubspot.findOwnerByEmail.mockRejectedValue(new Error("HubSpot is down"));
    const { db, updates } = lead({ setHubspotOwner: true });
    await syncLeadToCrm(db, "sub-1");
    expect(upsertedProperties()).not.toHaveProperty("hubspot_owner_id");
    expect(updates).toHaveLength(1);
  });
});

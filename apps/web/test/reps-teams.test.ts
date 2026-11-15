import { loadConfigObject, toConfigObject, type ConfigInput } from "@switchboard/config";
import { describe, expect, it } from "vitest";
import {
  buildConfig,
  draftsFromConfig,
  fieldsFromOwner,
  hasOwnerWithEmail,
  newRep,
  placeErrors,
} from "../src/app/setup/reps-teams";

const BASE: ConfigInput = {
  org: { name: "Acme", slug: "acme" },
  theme: { accent: "#0B5FFF" },
  reps: [
    { email: "ana@acme.com", name: "Ana", timezone: "Europe/Paris", workingHours: { days: ["mon", "fri"], hours: "08:30-16:00" } },
    { email: "ben@acme.com", name: "Ben", timezone: "UTC" },
  ],
  teams: [
    {
      key: "sales",
      name: "Sales",
      members: ["ana@acme.com", { rep: "ben@acme.com", weight: 3, weeklyCapacity: 5, active: false }],
    },
  ],
  forms: [
    {
      slug: "demo",
      name: "Demo",
      fields: [{ key: "email", label: "Email", type: "email", required: true }],
      rules: { rules: [], fallback: { team: "sales", strategy: "round_robin" } },
    },
  ],
};

const plan = (config: ConfigInput) => {
  const result = loadConfigObject(JSON.parse(JSON.stringify(config)));
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.plan;
};

describe("buildConfig", () => {
  it("saves the same plan when nothing was edited", () => {
    const original = plan(BASE);
    const base = toConfigObject(original);
    const { reps, teams } = draftsFromConfig(base);
    expect(plan(buildConfig(base, reps, teams))).toEqual(original);
  });

  it("applies edits to reps and memberships and keeps forms as they were", () => {
    const { reps, teams } = draftsFromConfig(BASE);
    reps[0] = { ...reps[0]!, email: "ana.ruiz@acme.com", days: ["fri", "mon", "tue"], hours: "09:00-17:00" };
    reps[1] = { ...reps[1]!, days: [], hours: "" };
    teams[0]!.members[0] = { ...teams[0]!.members[0]!, weight: 2, active: false };
    teams[0]!.members.splice(1, 1);

    const config = buildConfig(BASE, reps, teams);
    expect(config.forms).toBe(BASE.forms);
    expect(config.theme).toBe(BASE.theme);
    expect(config.reps[0]).toEqual({
      email: "ana.ruiz@acme.com",
      name: "Ana",
      timezone: "Europe/Paris",
      workingHours: { days: ["mon", "tue", "fri"], hours: "09:00-17:00" },
    });
    expect(config.reps[1]).not.toHaveProperty("workingHours");
    // Memberships follow the rep's new email.
    expect(config.teams).toEqual([
      { key: "sales", name: "Sales", members: [{ rep: "ana.ruiz@acme.com", weight: 2, weeklyCapacity: 0, active: false }] },
    ]);
    expect(loadConfigObject(config).ok).toBe(true);
  });

  it("keeps a rep added from the HubSpot picker on the owner's email exactly", () => {
    const owner = { id: "77", email: "Cara.Lee@Acme.com", name: "Cara Lee" };
    const { reps, teams } = draftsFromConfig(BASE);
    const cara = newRep("new-1", { ...fieldsFromOwner(owner), timezone: "UTC" });
    teams[0]!.members.push({ repId: cara.id, weight: 1, weeklyCapacity: 0, active: true });

    const config = buildConfig(BASE, [...reps, cara], teams);
    expect(config.reps[2]).toEqual({ email: "Cara.Lee@Acme.com", name: "Cara Lee", timezone: "UTC" });
    expect(config.teams?.[0]?.members[2]).toMatchObject({ rep: "Cara.Lee@Acme.com" });
    expect(hasOwnerWithEmail([owner], cara.email)).toBe(true);
  });

  it("falls back to the email when the owner has no name", () => {
    expect(fieldsFromOwner({ id: "1", email: "x@acme.com", name: null })).toEqual({
      name: "x@acme.com",
      email: "x@acme.com",
    });
  });
});

describe("hasOwnerWithEmail", () => {
  it("matches case-insensitively and ignores surrounding spaces", () => {
    const owners = [{ id: "1", email: "Ana@Acme.com", name: "Ana" }];
    expect(hasOwnerWithEmail(owners, " ana@acme.com ")).toBe(true);
    expect(hasOwnerWithEmail(owners, "nobody@acme.com")).toBe(false);
  });
});

describe("placeErrors", () => {
  it("puts the validator's errors next to the rep or team they name", () => {
    const { reps, teams } = draftsFromConfig(BASE);
    reps[1] = { ...reps[1]!, timezone: "Mars/Base" };
    reps.push(newRep("new-1", { name: "", email: "not-an-email", timezone: "UTC" }));
    teams[0]!.members = [];
    const result = loadConfigObject(buildConfig(BASE, reps, teams));
    if (result.ok) throw new Error("expected errors");

    const placed = placeErrors(result.errors);
    expect(placed.reps.get(2)).toEqual(
      expect.arrayContaining(["email: must be an email address", expect.stringMatching(/^name: /)]),
    );
    expect(placed.teams.get(0)).toEqual(["members: a team needs at least one member"]);
    expect(placed.other).toEqual([]);
  });

  it("strips the rep's label from checks made after the schema", () => {
    const placed = placeErrors([
      'reps[1] (ben@acme.com) timezone: "Mars/Base" is not an IANA zone like America/New_York',
      "teams[0] (sales) members[1]: x@acme.com is not in reps",
      "forms[0] (demo) rules fallback: ana@acme.com is not in reps",
      "reps: add at least one rep",
    ]);
    expect(placed.reps.get(1)).toEqual(['timezone: "Mars/Base" is not an IANA zone like America/New_York']);
    expect(placed.teams.get(0)).toEqual(["members[1]: x@acme.com is not in reps"]);
    expect(placed.other).toEqual([
      "forms[0] (demo) rules fallback: ana@acme.com is not in reps",
      "reps: add at least one rep",
    ]);
  });
});

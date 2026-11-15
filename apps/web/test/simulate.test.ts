import type { ConfigInput } from "@switchboard/config";
import { loadConfigObject } from "@switchboard/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildConfig, draftsFromConfig } from "../src/app/setup/reps-teams";
import {
  buildRulesConfig,
  rulesDraftsFromConfig,
  type FormRulesDraft,
} from "../src/app/setup/rules";
import { parseTestLead, simulateLead, type TestLead } from "../src/lib/simulate";

const state = vi.hoisted(() => ({ signedIn: true }));
const getDb = vi.hoisted(() => vi.fn());
const applyConfig = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  adminSession: async () => (state.signedIn ? { user: {} } : null),
}));
vi.mock("@/lib/db", () => ({ getDb }));
vi.mock("@switchboard/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@switchboard/config")>()),
  applyConfig,
}));

const { POST } = await import("../src/app/api/admin/config/simulate/route");

const CONFIG: ConfigInput = {
  org: { name: "Acme", slug: "acme" },
  reps: [
    { email: "alice@acme.com", name: "Alice Chen", timezone: "UTC" },
    { email: "ben@acme.com", name: "Ben Ito", timezone: "UTC" },
    { email: "cara@acme.com", name: "Cara Diaz", timezone: "UTC" },
  ],
  teams: [
    { key: "enterprise", name: "Enterprise", members: ["alice@acme.com"] },
    { key: "default", name: "Default", members: ["ben@acme.com", "cara@acme.com"] },
    { key: "dach", name: "DACH", members: [{ rep: "cara@acme.com", active: false }] },
  ],
  forms: [
    {
      slug: "demo",
      name: "Demo",
      fields: [
        { key: "email", label: "Work email", type: "email", required: true },
        { key: "company_size", label: "Company size", type: "number", required: true },
        { key: "country", label: "Country", type: "text", required: false },
      ],
      rules: {
        rules: [
          {
            name: "Existing owner",
            when: { "crm.contact.owner": { exists: true } },
            route: { to: "crm.contact.owner" },
          },
          {
            name: "LinkedIn ads",
            when: { "attribution.utm_source": { eq: "linkedin" } },
            route: { team: "default", strategy: "existing_owner" },
          },
          {
            name: "Germany",
            when: { "form.country": { in: ["Germany"] } },
            route: { team: "dach", strategy: "round_robin" },
          },
          {
            name: "Company size at least 500",
            when: { "form.company_size": { gte: 500 } },
            route: { team: "enterprise", strategy: "round_robin" },
          },
        ],
        fallback: { team: "default", strategy: "round_robin" },
      },
    },
    {
      slug: "contact",
      name: "Contact",
      fields: [{ key: "email", label: "Email", type: "email", required: true }],
    },
  ],
};

const planOf = (config: ConfigInput) => {
  const result = loadConfigObject(JSON.parse(JSON.stringify(config)));
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.plan;
};

const lead = (change: Partial<TestLead> = {}): TestLead => ({
  answers: { email: "pat@bigco.com", company_size: "800" },
  hubspotOwner: "",
  utm: {},
  ...change,
});

/** A clock that reads 0 when the decision starts and `ms` when it ends. */
const clock = (ms: number) => {
  const times = [0, ms];
  return () => times.shift() ?? ms;
};

beforeEach(() => {
  state.signedIn = true;
  getDb.mockReset();
  applyConfig.mockReset();
});

describe("simulateLead", () => {
  it("says where the lead goes, which rule matched, and how long it took", () => {
    const simulation = simulateLead(planOf(CONFIG), "demo", lead(), clock(31));
    expect(simulation).toEqual({
      summary:
        "Routes to Alice Chen (Enterprise) because rule 4, Company size at least 500, matched. Decided in 31 ms.",
      matchedRule: "Company size at least 500",
      latencyMs: 31,
      trace: [
        {
          position: 1,
          rule: "Existing owner",
          matched: false,
          failedOn: "crm.contact.owner",
          failedOnLabel: "HubSpot contact owner",
        },
        {
          position: 2,
          rule: "LinkedIn ads",
          matched: false,
          failedOn: "attribution.utm_source",
          failedOnLabel: "utm_source",
        },
        {
          position: 3,
          rule: "Germany",
          matched: false,
          failedOn: "form.country",
          failedOnLabel: "Country",
        },
        { position: 4, rule: "Company size at least 500", matched: true },
      ],
    });
  });

  it("runs the draft config as edited, not the saved one", () => {
    const { reps, teams } = draftsFromConfig(CONFIG);
    const ruleForms = rulesDraftsFromConfig(CONFIG) as FormRulesDraft[];
    ruleForms[0]!.rules[3]!.route = { team: "default", strategy: "round_robin" };
    const draft = buildRulesConfig(buildConfig(CONFIG, reps, teams), ruleForms);
    expect(simulateLead(planOf(draft), "demo", lead(), clock(2))?.summary).toBe(
      "Routes to Default, taking turns between Ben Ito and Cara Diaz because rule 4, Company size at least 500, matched. Decided in 2 ms.",
    );
  });

  it("reads the HubSpot owner and campaign fields", () => {
    const plan = planOf(CONFIG);
    expect(
      simulateLead(plan, "demo", lead({ hubspotOwner: "Ben@Acme.com" }), clock(1))
        ?.summary,
    ).toBe(
      "Routes to Ben Ito (HubSpot contact owner) because rule 1, Existing owner, matched. Decided in 1 ms.",
    );
    const linkedin = simulateLead(
      plan,
      "demo",
      lead({ utm: { utm_source: "LinkedIn" } }),
      clock(1),
    );
    expect(linkedin?.summary).toBe(
      "Routes to Default, taking turns between Ben Ito and Cara Diaz because rule 2, LinkedIn ads, matched. There is no HubSpot contact owner, so the team takes turns. Decided in 1 ms.",
    );
  });

  it("says when a team has nobody active, a form has no rules, or nothing matched", () => {
    const plan = planOf(CONFIG);
    expect(
      simulateLead(plan, "demo", lead({ answers: { country: "germany" } }), clock(0.04))
        ?.summary,
    ).toBe(
      "Goes to the fallback queue because rule 3, Germany, matched. Nobody on DACH is active (everyone is paused). Decided in under 0.1 ms.",
    );
    expect(
      simulateLead(plan, "demo", lead({ answers: { company_size: "20" } }), clock(1))
        ?.summary,
    ).toBe(
      "Routes to Default, taking turns between Ben Ito and Cara Diaz because no rule matched, so the last row applies. Decided in 1 ms.",
    );
    const contact = simulateLead(plan, "contact", lead(), clock(1));
    expect(contact?.summary).toBe(
      "Goes to the fallback queue because the form has no rules, so the last row applies. Decided in 1 ms.",
    );
    expect(contact?.trace).toEqual([]);
    expect(simulateLead(plan, "missing", lead())).toBeNull();
  });

  it("accepts only string answers and known campaign fields", () => {
    expect(parseTestLead(lead())).toEqual(lead());
    expect(parseTestLead({ ...lead(), answers: { company_size: 800 } })).toBeNull();
    expect(parseTestLead({ ...lead(), utm: { gclid: "x" } })).toBeNull();
    expect(parseTestLead({ answers: {}, utm: {} })).toBeNull();
  });
});

describe("POST /api/admin/config/simulate", () => {
  const post = (body: unknown) =>
    POST(
      new Request("http://localhost/api/admin/config/simulate", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );

  it("routes the lead without touching the database or applying anything", async () => {
    const response = await post({ config: CONFIG, form: "demo", lead: lead() });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.matchedRule).toBe("Company size at least 500");
    expect(body.summary).toMatch(/^Routes to Alice Chen \(Enterprise\) because rule 4/);
    expect(getDb).not.toHaveBeenCalled();
    expect(applyConfig).not.toHaveBeenCalled();
  });

  it("returns the validator's errors for a draft that can't be applied", async () => {
    const broken = {
      ...CONFIG,
      teams: CONFIG.teams!.filter((team) => team.key !== "dach"),
    };
    const response = await post({ config: broken, form: "demo", lead: lead() });
    expect(response.status).toBe(400);
    expect((await response.json()).errors).toEqual([
      'forms[0] (demo) rules rules[2] (Germany): team "dach" is not defined in teams',
    ]);
  });

  it("requires an admin session and a test lead", async () => {
    expect((await post({ config: CONFIG, form: "demo" })).status).toBe(400);
    state.signedIn = false;
    expect((await post({ config: CONFIG, form: "demo", lead: lead() })).status).toBe(401);
  });
});

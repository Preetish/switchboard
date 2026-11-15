import {
  loadConfigObject,
  serializeConfig,
  toConfigObject,
  type ConfigInput,
} from "@switchboard/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildConfig, draftsFromConfig, placeErrors } from "../src/app/setup/reps-teams";
import {
  buildFormsConfig,
  formsDraftsFromConfig,
  newField,
} from "../src/app/setup/forms";
import { describeChanges, diffLines } from "../src/app/setup/review";
import { asLoadedPlan } from "../src/lib/config-admin";
import {
  buildRulesConfig,
  placeRuleErrors,
  rulesDraftsFromConfig,
  type FormRulesDraft,
} from "../src/app/setup/rules";

const state = vi.hoisted(() => ({ signedIn: true }));
const getDb = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  adminSession: async () => (state.signedIn ? { user: {} } : null),
}));
vi.mock("@/lib/db", () => ({ getDb }));

const { POST } = await import("../src/app/api/admin/config/check/route");

const FIELDS = [
  { key: "email", label: "Work email", type: "email", required: true },
  { key: "country", label: "Country", type: "text", required: false },
];

const BASE: ConfigInput = {
  org: { name: "Acme", slug: "acme" },
  reps: [
    { email: "ana@acme.com", name: "Ana Ruiz", timezone: "UTC" },
    {
      email: "ben@acme.com",
      name: "Ben Ito",
      timezone: "UTC",
      workingHours: { days: ["mon", "tue"], hours: "09:00-17:00" },
    },
  ],
  teams: [
    { key: "default", name: "Default", members: ["ana@acme.com", "ben@acme.com"] },
    { key: "dach", name: "DACH", members: ["ana@acme.com"] },
  ],
  forms: [
    {
      slug: "demo",
      name: "Demo",
      fields: FIELDS,
      rules: {
        rules: [
          {
            name: "Owner",
            when: { "crm.contact.owner": { exists: true } },
            route: { to: "crm.contact.owner" },
          },
          {
            name: "Paid",
            when: { "attribution.utm_medium": { eq: "cpc" } },
            route: { to: "ben@acme.com" },
          },
          {
            name: "Germany",
            when: { "form.country": { in: ["Germany", "Austria"] } },
            route: { team: "default", strategy: "round_robin" },
          },
        ],
        fallback: { team: "default", strategy: "round_robin" },
      },
    },
  ],
};

const planOf = (config: ConfigInput) => {
  const result = loadConfigObject(JSON.parse(JSON.stringify(config)));
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.plan;
};

/** The draft SetupEditor saves after `edit` changes the editors' state. */
function draft(
  edit: (
    state: ReturnType<typeof draftsFromConfig> & { rules: FormRulesDraft[] },
  ) => void = () => {},
): ConfigInput {
  const editors = {
    ...draftsFromConfig(BASE),
    rules: rulesDraftsFromConfig(BASE) as FormRulesDraft[],
  };
  edit(editors);
  return buildRulesConfig(buildConfig(BASE, editors.reps, editors.teams), editors.rules);
}

describe("describeChanges", () => {
  it("gives back the same config, and no changes, when nothing was edited", () => {
    const before = planOf(BASE);
    const after = planOf(draft());
    expect(after).toEqual(before);
    expect(describeChanges(before, after)).toEqual([]);
    expect(serializeConfig(after)).toBe(serializeConfig(before));
    expect(diffLines(serializeConfig(before), serializeConfig(after))).toEqual([]);
  });

  it("shows no changes for a stored plan whose JSON keys Postgres reordered", () => {
    // jsonb keeps object keys sorted by length, then bytewise.
    const jsonbOrder = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(jsonbOrder)
        : typeof value === "object" && value !== null
          ? Object.fromEntries(
              Object.entries(value)
                .sort(([a], [b]) => a.length - b.length || (a < b ? -1 : 1))
                .map(([key, entry]) => [key, jsonbOrder(entry)]),
            )
          : value;
    const stored = jsonbOrder(planOf(BASE)) as ReturnType<typeof planOf>;
    expect(serializeConfig(stored)).not.toBe(serializeConfig(planOf(BASE)));

    const saved = asLoadedPlan(stored);
    const { reps, teams } = draftsFromConfig(toConfigObject(saved));
    const rules = rulesDraftsFromConfig(toConfigObject(saved));
    const after = planOf(
      buildRulesConfig(buildConfig(toConfigObject(saved), reps, teams), rules),
    );
    expect(describeChanges(saved, after)).toEqual([]);
    expect(serializeConfig(after)).toBe(serializeConfig(saved));
  });

  it("lists a changed rule target in words", () => {
    const after = draft(({ rules }) => {
      rules[0]!.rules[2]!.route = { team: "dach", strategy: "round_robin" };
    });
    expect(describeChanges(planOf(BASE), planOf(after))).toEqual([
      {
        title: "Rules for Demo",
        changes: ["Rule 3, Germany: target changed from team Default to team DACH"],
      },
    ]);
  });

  it("describes rep, membership, and rule edits as a reader would say them", () => {
    const after = draft(({ reps, teams, rules }) => {
      reps[0]!.timezone = "Europe/Berlin";
      reps[1]!.days = [];
      reps[1]!.hours = "";
      reps.push({
        id: "new",
        savedEmail: null,
        name: "Cara Diaz",
        email: "cara@acme.com",
        timezone: "UTC",
        days: [],
        hours: "",
      });
      teams[0]!.members[1]!.active = false;
      teams[0]!.members[0]!.weight = 3;
      teams[1]!.members.push({
        repId: "new",
        weight: 1,
        weeklyCapacity: 5,
        active: true,
      });
      const [owner, paid, germany] = rules[0]!.rules;
      germany!.when = { source: "form.country", operator: "is", value: "Germany" };
      germany!.route = { team: "default", strategy: "existing_owner" };
      paid!.name = "Paid search";
      rules[0]!.rules = [germany!, owner!, paid!];
      rules[0]!.fallback = { action: "fallback_queue" };
    });
    expect(describeChanges(planOf(BASE), planOf(after))).toEqual([
      {
        title: "Reps",
        changes: [
          "Ana Ruiz's time zone changed from UTC to Europe/Berlin",
          "Ben Ito's working hours changed from Mon, Tue 09:00-17:00 to any time",
          "Added Cara Diaz (cara@acme.com)",
        ],
      },
      {
        title: "Teams",
        changes: [
          "Ana Ruiz's weight in Default changed from 1 to 3",
          "Ben Ito paused in Default",
          "Cara Diaz added to DACH",
        ],
      },
      {
        title: "Rules for Demo",
        changes: [
          'Rule 1, Germany: condition changed from "Country is any of Germany, Austria" to "Country is Germany"',
          'Rule 1, Germany: now picks a rep by "CRM owner first, else take turns" instead of "take turns"',
          "Rule 3 renamed from Paid to Paid search",
          "Rules reordered: Germany, Owner, Paid search",
          "Last row (no rule matched): target changed from team Default to the fallback queue",
        ],
      },
    ]);
  });

  it("lists added and removed rules", () => {
    const after = draft(({ rules }) => {
      rules[0]!.rules = [
        rules[0]!.rules[0]!,
        {
          id: "x",
          name: "Big",
          when: { source: "form.country", operator: "exists", value: "" },
          route: { to: "ana@acme.com" },
        },
      ];
    });
    expect(describeChanges(planOf(BASE), planOf(after))[0]!.changes).toEqual([
      "Added rule 2, Big: when Country exists, route to rep Ana Ruiz",
      "Removed rule 2, Paid",
      "Removed rule 3, Germany",
    ]);
  });

  it("describes form, field, and theme edits", () => {
    const { forms, theme } = formsDraftsFromConfig(BASE);
    const demo = forms[0]!;
    demo.submitLabel = "Request a demo";
    theme.accent = "#0B5FFF";
    demo.theme.layout = "plain";
    const country = demo.fields[1]!;
    country.type = "select";
    country.options = ["Germany", "Austria"];
    demo.fields = [country, demo.fields[0]!, newField("x", demo.fields)];
    const after = buildFormsConfig(BASE, forms, theme);

    expect(describeChanges(planOf(BASE), planOf(after))).toEqual([
      { title: "Default theme", changes: ["Theme accent color set to #0B5FFF"] },
      {
        title: "Form Demo",
        changes: [
          "Submit label set to Request a demo",
          "Field Country: type changed from Short text to Dropdown",
          "Field Country: options are now Germany, Austria",
          "Added field New field (Short text)",
          "Fields reordered: Country, Work email, New field",
          "Theme layout set to plain",
        ],
      },
    ]);
  });

  it("reads a field removed and another added in its place as just that", () => {
    const { forms, theme } = formsDraftsFromConfig(BASE);
    const demo = forms[0]!;
    demo.fields = [
      demo.fields[0]!,
      { ...newField("x", demo.fields), key: "role", label: "Role" },
    ];
    const after = buildFormsConfig(BASE, forms, theme);
    // The Germany rule reads form.country, so keep the field it needs out of the rules.
    after.forms[0]!.rules = undefined;
    const before = { ...BASE, forms: [{ ...BASE.forms[0]!, rules: undefined }] };

    expect(describeChanges(planOf(before), planOf(after))).toEqual([
      {
        title: "Form Demo",
        changes: ["Added field Role (Short text)", "Removed field Country"],
      },
    ]);
  });
});

describe("diffLines", () => {
  it("marks added and removed lines and folds unchanged runs", () => {
    const before = ["a", "b", "c", "d", "e", "f", "g", "h"].join("\n");
    const after = ["a", "b", "c", "d", "e", "F", "g", "h"].join("\n");
    expect(diffLines(before, after, 1)).toEqual([
      { kind: "skipped", count: 4 },
      { kind: "same", text: "e" },
      { kind: "removed", text: "f" },
      { kind: "added", text: "F" },
      { kind: "same", text: "g" },
      { kind: "skipped", count: 1 },
    ]);
  });
});

describe("POST /api/admin/config/check", () => {
  const post = (body: unknown) =>
    POST(
      new Request("http://localhost/api/admin/config/check", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );

  it("returns the plan and its YAML without reading or writing the database", async () => {
    const response = await post(draft());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.plan).toEqual(planOf(BASE));
    expect(body.yaml).toBe(serializeConfig(planOf(BASE)));
    expect(getDb).not.toHaveBeenCalled();
  });

  it("returns the validator's own errors, which land next to the rule or rep they name", async () => {
    const config = draft(({ reps, rules }) => {
      reps[0]!.timezone = "Mars/Base";
      rules[0]!.rules[2]!.route = { team: "emea", strategy: "round_robin" };
    });
    const response = await post(config);
    expect(response.status).toBe(400);
    const { errors } = (await response.json()) as { errors: string[] };
    expect(errors).toEqual([
      'reps[0] (ana@acme.com) timezone: "Mars/Base" is not an IANA zone like America/New_York',
      'forms[0] (demo) rules rules[2] (Germany): team "emea" is not defined in teams',
    ]);
    const repsTeams = placeErrors(errors);
    const ruleErrors = placeRuleErrors(repsTeams.other, rulesDraftsFromConfig(config));
    expect(repsTeams.reps.get(0)).toEqual([
      'timezone: "Mars/Base" is not an IANA zone like America/New_York',
    ]);
    expect(ruleErrors.rules.get("rule-0-2")).toEqual([
      'team "emea" is not defined in teams',
    ]);
    expect(ruleErrors.other).toEqual([]);
  });

  it("requires an admin session", async () => {
    state.signedIn = false;
    expect((await post(BASE)).status).toBe(401);
    state.signedIn = true;
  });
});

beforeEach(() => {
  getDb.mockReset();
});

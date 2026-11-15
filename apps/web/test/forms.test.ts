import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadConfig,
  loadConfigObject,
  toConfigObject,
  type ConfigInput,
} from "@switchboard/config";
import type { FormField } from "@switchboard/core";
import { describe, expect, it } from "vitest";
import {
  buildFormsConfig,
  changeType,
  formsDraftsFromConfig,
  newField,
  placeFormErrors,
  themeDraft,
  themeFromDraft,
} from "../src/app/setup/forms";
import { buildConfig, draftsFromConfig } from "../src/app/setup/reps-teams";
import { buildRulesConfig, move, rulesDraftsFromConfig } from "../src/app/setup/rules";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const FIELDS: FormField[] = [
  { key: "email", label: "Work email", type: "email", required: true },
  {
    key: "company_size",
    label: "Company size",
    type: "number",
    required: true,
    helpText: "Number of employees.",
  },
  {
    key: "country",
    label: "Country",
    type: "select",
    required: true,
    options: ["Germany", "Austria", "United States"],
  },
  { key: "consent", label: "I agree", type: "consent", required: true },
];

const BASE: ConfigInput = {
  org: { name: "Acme", slug: "acme" },
  theme: { accent: "#0B5FFF", radius: 8, font: { family: "Georgia, serif" } },
  customCss: ".sb-form { letter-spacing: 0; }",
  reps: [{ email: "ana@acme.com", name: "Ana", timezone: "UTC" }],
  teams: [{ key: "sales", name: "Sales", members: ["ana@acme.com"] }],
  forms: [
    {
      slug: "demo",
      name: "Demo",
      submitLabel: "Find a time",
      selfServeUrl: "https://example.com/signup",
      theme: { colorScheme: "dark", layout: "plain", background: "transparent" },
      customCss: ".sb-field { gap: 0; }",
      fields: FIELDS,
      rules: {
        rules: [
          {
            name: "DACH",
            when: { "form.country": { in: ["Germany", "Austria"] } },
            route: { team: "sales", strategy: "round_robin" },
          },
        ],
        fallback: { team: "sales", strategy: "round_robin" },
      },
    },
    { slug: "contact", name: "Contact", fields: [FIELDS[0]!] },
  ],
};

const loaded = (config: ConfigInput) => {
  const result = loadConfigObject(JSON.parse(JSON.stringify(config)));
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.plan;
};

const draftsOf = (config: ConfigInput) => formsDraftsFromConfig(config);

describe("saving forms", () => {
  it("gives back the same config when nothing was edited", () => {
    const { forms, theme } = draftsOf(BASE);
    expect(buildFormsConfig(BASE, forms, theme)).toEqual(BASE);
  });

  it("gives back the same plan for the demo config with every editor's drafts", () => {
    const file = path.join(repoRoot, "examples/switchboard.demo.yaml");
    const result = loadConfig(readFileSync(file, "utf8"), file, (name) =>
      readFileSync(name, "utf8"),
    );
    if (!result.ok) throw new Error(result.errors.join("\n"));
    const base = toConfigObject(result.plan);
    const { reps, teams } = draftsFromConfig(base);
    const { forms, theme } = draftsOf(base);

    const saved = buildRulesConfig(
      buildFormsConfig(buildConfig(base, reps, teams), forms, theme),
      rulesDraftsFromConfig(base),
    );
    expect(loaded(saved)).toEqual(result.plan);
  });

  it("writes form settings and leaves the slug, rules, and custom CSS alone", () => {
    const { forms, theme } = draftsOf(BASE);
    const demo = forms[0]!;
    demo.name = "Book a demo";
    demo.submitLabel = "  Request a demo ";
    demo.selfServeUrl = "";

    const form = buildFormsConfig(BASE, forms, theme).forms[0]!;
    expect(form).toEqual({
      ...BASE.forms[0],
      name: "Book a demo",
      submitLabel: "Request a demo",
      selfServeUrl: undefined,
    });
    expect(form).not.toHaveProperty("selfServeUrl");
    expect(loaded(buildFormsConfig(BASE, forms, theme)).forms[0]!.settings).toEqual({
      submitLabel: "Request a demo",
      theme: { colorScheme: "dark", layout: "plain", background: "transparent" },
      customCss: ".sb-field { gap: 0; }",
    });
  });

  it("leaves the HubSpot contact owner switch off when the config doesn't set it", () => {
    const { forms, theme } = draftsOf(BASE);
    expect(forms.map((form) => form.setHubspotOwner)).toEqual([false, false]);
    const saved = buildFormsConfig(BASE, forms, theme);
    expect(saved.forms.every((form) => !("setHubspotOwner" in form))).toBe(true);
    expect(loaded(saved).forms.map((form) => form.settings.setHubspotOwner)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("turns the HubSpot contact owner switch on and off per form", () => {
    const { forms, theme } = draftsOf(BASE);
    forms[1]!.setHubspotOwner = true;
    const on = buildFormsConfig(BASE, forms, theme);
    expect(on.forms[0]).not.toHaveProperty("setHubspotOwner");
    expect(on.forms[1]).toMatchObject({ setHubspotOwner: true });
    expect(loaded(on).forms[1]!.settings.setHubspotOwner).toBe(true);
    expect(draftsOf(on).forms[1]!.setHubspotOwner).toBe(true);

    const back = draftsOf(on);
    back.forms[1]!.setHubspotOwner = false;
    expect(buildFormsConfig(on, back.forms, back.theme)).toEqual(BASE);
  });

  it("adds a field with a fresh key at the end", () => {
    const { forms, theme } = draftsOf(BASE);
    const contact = forms[1]!;
    contact.fields.push(newField("new-1", contact.fields));
    const second = newField("new-2", contact.fields);
    expect(second.key).toBe("field_2");
    contact.fields.push({
      ...second,
      key: "message",
      label: "Message",
      type: "textarea",
    });

    const config = buildFormsConfig(BASE, forms, theme);
    expect(config.forms[1]!.fields).toEqual([
      FIELDS[0],
      { key: "field_1", label: "New field", type: "text", required: false },
      { key: "message", label: "Message", type: "textarea", required: false },
    ]);
    expect(loaded(config).forms[1]!.fields).toHaveLength(3);
  });

  it("removes and reorders fields", () => {
    const { forms, theme } = draftsOf(BASE);
    const demo = forms[0]!;
    demo.fields = move(
      demo.fields.filter((field) => field.key !== "company_size"),
      2,
      0,
    );

    const config = buildFormsConfig(BASE, forms, theme);
    expect(config.forms[0]!.fields).toEqual([FIELDS[3], FIELDS[0], FIELDS[2]]);
    expect(loaded(config).forms[0]!.fields.map((field) => field.key)).toEqual([
      "consent",
      "email",
      "country",
    ]);
  });

  it("round trips select options as plain strings, value and label alike", () => {
    const { forms, theme } = draftsOf(BASE);
    const country = forms[0]!.fields[2]!;
    expect(country.options).toEqual(["Germany", "Austria", "United States"]);

    // Typed into the one-per-line box: blank lines and padding are dropped.
    country.options = [" Germany", "Austria", "", "United States ", "Canada", ""];
    const saved = buildFormsConfig(BASE, forms, theme).forms[0]!.fields as FormField[];
    expect(saved[2]!.options).toEqual(["Germany", "Austria", "United States", "Canada"]);
    expect(
      draftsOf(buildFormsConfig(BASE, forms, theme)).forms[0]!.fields[2]!.options,
    ).toEqual(["Germany", "Austria", "United States", "Canada"]);
  });

  it("writes options only for select fields, and keeps them while the type is switched", () => {
    const { forms, theme } = draftsOf(BASE);
    const fields = forms[0]!.fields;
    fields[2] = changeType(fields[2]!, "text");
    expect(buildFormsConfig(BASE, forms, theme).forms[0]!.fields[2]).toEqual({
      key: "country",
      label: "Country",
      type: "text",
      required: true,
    });
    fields[2] = changeType(fields[2], "select");
    expect(buildFormsConfig(BASE, forms, theme).forms[0]!.fields[2]).toEqual(FIELDS[2]);
  });

  it("makes consent fields required", () => {
    const field = newField("new-1", []);
    expect(changeType(field, "consent")).toMatchObject({
      type: "consent",
      required: true,
    });
  });

  it("drops empty help text", () => {
    const { forms, theme } = draftsOf(BASE);
    forms[0]!.fields[1]!.helpText = "  ";
    expect(buildFormsConfig(BASE, forms, theme).forms[0]!.fields[1]).not.toHaveProperty(
      "helpText",
    );
  });
});

describe("themes", () => {
  it("reads every theme setting as text and writes it back", () => {
    const draft = themeDraft({
      accent: "#0B5FFF",
      radius: 0,
      colorScheme: "light",
      layout: "card",
      background: "#FFFFFF",
      font: { family: "Georgia, serif", stylesheet: "https://fonts.example.com/a.css" },
    });
    expect(draft).toEqual({
      accent: "#0B5FFF",
      background: "#FFFFFF",
      radius: "0",
      colorScheme: "light",
      layout: "card",
      fontFamily: "Georgia, serif",
      fontStylesheet: "https://fonts.example.com/a.css",
    });
    expect(themeFromDraft(draft)).toEqual({
      accent: "#0B5FFF",
      radius: 0,
      colorScheme: "light",
      layout: "card",
      background: "#FFFFFF",
      font: { family: "Georgia, serif", stylesheet: "https://fonts.example.com/a.css" },
    });
  });

  it("leaves the theme out when every setting is cleared", () => {
    const { forms, theme } = draftsOf(BASE);
    forms[0]!.theme = themeDraft(undefined);
    const config = buildFormsConfig(BASE, forms, themeDraft(undefined));
    expect(config).not.toHaveProperty("theme");
    expect(config.forms[0]).not.toHaveProperty("theme");
    expect(config.customCss).toBe(BASE.customCss);
    expect(theme.accent).toBe("#0B5FFF");
  });

  it("writes edited theme values", () => {
    const { forms, theme } = draftsOf(BASE);
    theme.accent = "#ff6600";
    theme.radius = "12";
    forms[1]!.theme.layout = "plain";
    const config = buildFormsConfig(BASE, forms, theme);
    expect(config.theme).toEqual({
      accent: "#ff6600",
      radius: 12,
      font: { family: "Georgia, serif" },
    });
    expect(config.forms[1]!.theme).toEqual({ layout: "plain" });
    expect(loaded(config).org.settings.theme?.accent).toBe("#FF6600");
  });
});

describe("placeFormErrors", () => {
  const errorsFor = (edit: (drafts: ReturnType<typeof draftsOf>) => void) => {
    const drafts = draftsOf(BASE);
    edit(drafts);
    const result = loadConfigObject(buildFormsConfig(BASE, drafts.forms, drafts.theme));
    if (result.ok) throw new Error("expected errors");
    return { drafts, errors: result.errors };
  };

  it("puts field errors next to the field they name", () => {
    const { drafts, errors } = errorsFor(({ forms }) => {
      const fields = forms[0]!.fields;
      fields[1]!.label = "";
      fields[2]!.options = [];
    });
    const placed = placeFormErrors(errors, drafts.forms);
    const demo = placed.forms.get(0)!;
    const ids = drafts.forms[0]!.fields.map((field) => field.id);
    expect(demo.fields.get(ids[1]!)).toEqual([expect.stringMatching(/^label: /)]);
    expect(demo.fields.get(ids[2]!)).toEqual([
      "Select fields must list at least one option",
    ]);
    expect(placed.other).toEqual([]);

    // Duplicate keys are checked once every field is well formed.
    const duplicate = errorsFor(({ forms }) => {
      forms[0]!.fields[3]!.key = "email";
    });
    const dup = placeFormErrors(duplicate.errors, duplicate.drafts.forms).forms.get(0)!;
    expect([...dup.fields]).toEqual([
      [duplicate.drafts.forms[0]!.fields[3]!.id, ["this key is used by another field"]],
    ]);
  });

  it("puts settings and theme errors on their form, and org theme errors on the org", () => {
    const { drafts, errors } = errorsFor(({ forms, theme }) => {
      forms[0]!.selfServeUrl = "not a url";
      forms[1]!.fields = [];
      theme.accent = "orange";
    });
    const placed = placeFormErrors([...errors, "org.name: Too small"], drafts.forms);
    expect(placed.forms.get(0)!.form).toEqual([expect.stringMatching(/^selfServeUrl: /)]);
    expect(placed.forms.get(1)!.form).toEqual([expect.stringMatching(/^fields: /)]);
    expect(placed.other).toEqual(["org.name: Too small"]);
    const owner = placeFormErrors(
      ["forms[1].setHubspotOwner: Invalid input: expected boolean, received string"],
      drafts.forms,
    );
    expect(owner.forms.get(1)!.form).toEqual([
      "setHubspotOwner: Invalid input: expected boolean, received string",
    ]);

    // Theme values are checked once the config's shape is right.
    const themed = errorsFor(({ forms, theme }) => {
      forms[1]!.theme.radius = "40";
      theme.accent = "orange";
    });
    const placedTheme = placeFormErrors(themed.errors, themed.drafts.forms);
    expect(placedTheme.forms.get(1)!.theme).toEqual([expect.stringMatching(/^radius: /)]);
    expect(placedTheme.theme).toEqual([expect.stringMatching(/^accent: /)]);
    expect(placedTheme.other).toEqual([]);
  });
});

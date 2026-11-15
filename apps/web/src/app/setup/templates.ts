import type { ConfigInput } from "@switchboard/config";
import type { FormField, RouteAction, Rule } from "@switchboard/core";
import { formsDraftsFromConfig, type FormDraft } from "./forms";
import { draftsFromConfig, type RepDraft, type TeamDraft } from "./reps-teams";
import { rulesDraftsFromConfig, type FormRulesDraft } from "./rules";

/**
 * The Setup page's template gallery: ready-made routing setups, each a
 * plain config object (switchboard.yaml's shape) with placeholder reps, one
 * form, and its rules. A template is data the existing validator checks;
 * it adds nothing to the rules engine.
 *
 * Choosing a template only fills the editors' drafts. Nothing is saved until
 * the drafts go through Save changes, the review, and Apply changes.
 *
 * Plain functions with no React or I/O, so the mapping is unit tested.
 */

export type TemplateId = "saas" | "territory" | "paid" | "blank";

/** Placeholder reps use this reserved domain (RFC 2606), so they never reach a real inbox. */
export const PLACEHOLDER_DOMAIN = "example.com";

type TemplateContent = {
  reps: { key: string; label: string }[];
  /** Each team's placeholder rep, by the rep's key. */
  teams: { key: string; name: string; rep: string }[];
  formName: string;
  fields: FormField[];
  rules: Rule[];
  fallback: RouteAction;
};

export type Template = { id: TemplateId; name: string; description: string };

const NAME: FormField = { key: "name", label: "Full name", type: "text", required: true };
const EMAIL: FormField = {
  key: "email",
  label: "Work email",
  type: "email",
  required: true,
};
const COMPANY_SIZE: FormField = {
  key: "company_size",
  label: "Company size",
  type: "number",
  required: true,
  helpText: "Number of employees.",
};
const CONSENT: FormField = {
  key: "consent",
  label: "I agree that my details are stored to process this request.",
  type: "consent",
  required: true,
};

const DACH = ["Germany", "Austria", "Switzerland"];
const NORTH_AMERICA = ["United States", "Canada"];
const REST_OF_EUROPE = [
  "United Kingdom",
  "Ireland",
  "France",
  "Netherlands",
  "Spain",
  "Italy",
];
/** The demo form's country list (examples/switchboard.demo.yaml). */
const COUNTRY: FormField = {
  key: "country",
  label: "Country",
  type: "select",
  required: true,
  options: [
    ...NORTH_AMERICA,
    "United Kingdom",
    ...DACH,
    "France",
    "Netherlands",
    "Ireland",
    "Spain",
    "Italy",
    "Australia",
    "India",
    "Japan",
    "Other",
  ],
};

const roundRobin = (team: string): RouteAction => ({ team, strategy: "round_robin" });

// The Sales team is "default" in every template, as in rules.saas.yaml.

const CONTENT: Record<TemplateId, TemplateContent> = {
  // The rules of examples/rules.saas.yaml, inline.
  saas: {
    reps: [
      { key: "enterprise-rep", label: "Enterprise rep" },
      { key: "dach-rep", label: "DACH rep" },
      { key: "sales-rep", label: "Sales rep" },
    ],
    teams: [
      { key: "enterprise", name: "Enterprise", rep: "enterprise-rep" },
      { key: "dach", name: "DACH", rep: "dach-rep" },
      { key: "default", name: "Sales", rep: "sales-rep" },
    ],
    formName: "Book a demo",
    fields: [
      NAME,
      EMAIL,
      COMPANY_SIZE,
      COUNTRY,
      {
        key: "requested_demo",
        label: "Would you like a product demo?",
        type: "select",
        required: false,
        options: ["yes", "no"],
      },
      CONSENT,
    ],
    rules: [
      {
        name: "Existing owner wins",
        when: { "crm.contact.owner": { exists: true } },
        route: { to: "crm.contact.owner" },
      },
      {
        name: "Personal email goes self-serve",
        when: { "form.email": { freeEmail: true } },
        route: { action: "self_serve_link" },
      },
      {
        name: "Enterprise",
        when: { "form.company_size": { gte: 500 } },
        route: roundRobin("enterprise"),
      },
      {
        name: "DACH mid-market",
        when: { "form.company_size": { gte: 50 }, "form.country": { in: DACH } },
        route: roundRobin("dach"),
      },
      {
        name: "Demo request",
        when: { "form.requested_demo": { eq: "yes" } },
        route: { team: "default", strategy: "existing_owner" },
      },
    ],
    fallback: roundRobin("default"),
  },
  // The demo's DACH rule, generalised to one rule per region.
  territory: {
    reps: [
      { key: "north-america-rep", label: "North America rep" },
      { key: "dach-rep", label: "DACH rep" },
      { key: "europe-rep", label: "Europe rep" },
      { key: "rest-of-world-rep", label: "Rest of world rep" },
    ],
    teams: [
      { key: "north-america", name: "North America", rep: "north-america-rep" },
      { key: "dach", name: "DACH", rep: "dach-rep" },
      { key: "europe", name: "Rest of Europe", rep: "europe-rep" },
      { key: "rest-of-world", name: "Rest of world", rep: "rest-of-world-rep" },
    ],
    formName: "Contact sales",
    fields: [NAME, EMAIL, COUNTRY, CONSENT],
    rules: [
      {
        name: "North America",
        when: { "form.country": { in: NORTH_AMERICA } },
        route: roundRobin("north-america"),
      },
      {
        name: "DACH region",
        when: { "form.country": { in: DACH } },
        route: roundRobin("dach"),
      },
      {
        name: "Rest of Europe",
        when: { "form.country": { in: REST_OF_EUROPE } },
        route: roundRobin("europe"),
      },
    ],
    fallback: roundRobin("rest-of-world"),
  },
  paid: {
    reps: [
      { key: "fast-lane-rep", label: "Fast lane rep" },
      { key: "sales-rep", label: "Sales rep" },
    ],
    teams: [
      { key: "fast-lane", name: "Fast lane", rep: "fast-lane-rep" },
      { key: "default", name: "Sales", rep: "sales-rep" },
    ],
    formName: "Book a demo",
    fields: [NAME, EMAIL, CONSENT],
    rules: [
      {
        name: "Paid campaign",
        when: {
          "attribution.utm_medium": {
            in: ["cpc", "ppc", "paid_search", "paid_social", "display"],
          },
        },
        route: roundRobin("fast-lane"),
      },
    ],
    fallback: roundRobin("default"),
  },
  blank: {
    reps: [{ key: "sales-rep", label: "Sales rep" }],
    teams: [{ key: "default", name: "Sales", rep: "sales-rep" }],
    formName: "Contact sales",
    fields: [NAME, EMAIL, CONSENT],
    rules: [],
    fallback: roundRobin("default"),
  },
};

export const TEMPLATES: Template[] = [
  {
    id: "saas",
    name: "B2B SaaS demo",
    description:
      "HubSpot owners keep their contacts, personal emails go to self serve, companies of 500 or more go to Enterprise, mid-size DACH companies go to DACH, and everyone else takes turns in Sales.",
  },
  {
    id: "territory",
    name: "Territory split",
    description:
      "Leads go to a regional team by country: North America, DACH, and the rest of Europe. Everyone else goes to a rest of world team.",
  },
  {
    id: "paid",
    name: "Paid campaign fast lane",
    description:
      "Leads from paid campaigns (UTM medium cpc, ppc, paid_search, paid_social, or display) go to a fast lane team. Everyone else takes turns in Sales.",
  },
  {
    id: "blank",
    name: "Blank",
    description:
      "One form and one team. Every lead takes turns in that team, with no rules yet.",
  },
];

function placeholderEmail(key: string): string {
  return `${key}@${PLACEHOLDER_DOMAIN}`;
}

function isPlaceholderEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${PLACEHOLDER_DOMAIN}`);
}

/**
 * The template as a full config over `base`: its teams, one form, and rules
 * replace `base`'s, and its placeholder reps (in `timezone`) are added after
 * `base`'s reps, which stay listed with no teams (reps are never deleted, and
 * a saved rep can join a team as is). The org and everything else outside
 * reps, teams, and forms are kept. The form takes the place of `base`'s
 * first form and keeps its link (slug), submit label, self serve URL, theme,
 * and custom CSS, so a live link or embed keeps working; the template sets
 * its name, fields, and rules, and turns on setting the HubSpot contact
 * owner to the routed rep.
 */
export function configFromTemplate(
  id: TemplateId,
  base: ConfigInput,
  timezone = "UTC",
): ConfigInput {
  // A copy, so edits to the drafts never reach the template itself.
  const content = structuredClone(CONTENT[id]);
  const first = base.forms[0];
  return {
    ...base,
    reps: [
      ...base.reps,
      ...content.reps.map((rep) => ({
        email: placeholderEmail(rep.key),
        name: `${rep.label} (placeholder)`,
        timezone,
      })),
    ],
    teams: content.teams.map((team) => ({
      key: team.key,
      name: team.name,
      members: [
        { rep: placeholderEmail(team.rep), weight: 1, weeklyCapacity: 0, active: true },
      ],
    })),
    forms: [
      {
        ...(first ?? { slug: "book-a-demo" }),
        name: content.formName,
        fields: content.fields,
        setHubspotOwner: true,
        rules: { rules: content.rules, fallback: content.fallback },
      },
    ],
  };
}

/** What the editors load for a template over the saved config; the placeholders count as unsaved. */
export function draftsFromTemplate(
  id: TemplateId,
  base: ConfigInput,
  timezone?: string,
): {
  config: ConfigInput;
  reps: RepDraft[];
  teams: TeamDraft[];
  ruleForms: (FormRulesDraft | null)[];
  forms: FormDraft[];
} {
  const config = configFromTemplate(id, base, timezone);
  const { reps, teams } = draftsFromConfig(config);
  return {
    config,
    reps: reps.map((rep, i) =>
      i < base.reps.length ? rep : { ...rep, savedEmail: null },
    ),
    teams,
    ruleForms: rulesDraftsFromConfig(config),
    forms: formsDraftsFromConfig(config).forms,
  };
}

/**
 * Whether replacing `config` with a template loses work, so the page asks
 * first: any reps, teams, or rules, or more than one form. One form with
 * no rules and nobody to route to is the empty default.
 */
export function hasExistingSetup(config: ConfigInput): boolean {
  return (
    config.reps.length > 0 ||
    (config.teams?.length ?? 0) > 0 ||
    config.forms.length > 1 ||
    config.forms.some((form) => form.rules !== undefined)
  );
}

/** A template's placeholder rep that hasn't been swapped for a real one. */
export function isPlaceholder(rep: RepDraft): boolean {
  return rep.savedEmail === null && isPlaceholderEmail(rep.email);
}

/**
 * A placeholder rep left in the draft, as an error on that rep: saving one
 * would add a rep nobody can be routed to (reps are never deleted).
 */
export function placeholderErrors(reps: RepDraft[]): string[] {
  return reps.flatMap((rep, i) =>
    isPlaceholder(rep)
      ? [
          `reps[${i}] (${rep.email.trim()}): this is a template placeholder. Replace it with a real rep, or remove it.`,
        ]
      : [],
  );
}

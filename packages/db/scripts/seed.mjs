/**
 * Idempotent demo seed: an org, a rule set (from examples/rules.example.yaml),
 * teams with weighted members, and a hosted form. Run with:
 *   npm run db:seed
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import yaml from "yaml";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const connectionString =
  process.env.DATABASE_URL ??
  "postgres://switchboard:switchboard@localhost:5432/switchboard";

const ORG_SLUG = "acme";
const FORM_SLUG = "book-a-demo";

const client = new pg.Client({ connectionString });
await client.connect();

async function main() {
  const rulesText = await readFile(
    path.join(repoRoot, "examples", "rules.example.yaml"),
    "utf8",
  );
  const parsed = yaml.parse(rulesText);

  const orgId = await one(
    `insert into orgs (name, slug) values ('Acme Inc', $1)
     on conflict (slug) do update set name = excluded.name
     returning id`,
    [ORG_SLUG],
  );

  const ruleSetId = await one(
    `insert into rule_sets (org_id, version, rules) values ($1, 1, $2)
     on conflict (org_id, version) do update set rules = excluded.rules
     returning id`,
    [orgId, JSON.stringify(parsed)],
  );

  const members = [
    {
      email: "alice@acme.test",
      name: "Alice Chen",
      timezone: "America/New_York",
      team: "enterprise",
      weight: 2,
    },
    {
      email: "bob@acme.test",
      name: "Bob Martinez",
      timezone: "America/Los_Angeles",
      team: "enterprise",
      weight: 1,
    },
    {
      email: "carol@acme.test",
      name: "Carol Okafor",
      timezone: "Europe/London",
      team: "default",
      weight: 1,
    },
  ];
  const userIds = {};
  for (const member of members) {
    const row = await one(
      `insert into users (org_id, email, name, timezone)
       values ($1, $2, $3, $4)
       on conflict (org_id, email) do update set name = excluded.name
       returning id`,
      [orgId, member.email, member.name, member.timezone],
    );
    userIds[member.email] = row;
  }

  for (const key of ["enterprise", "default"]) {
    const teamId = await one(
      `insert into teams (org_id, key, name) values ($1, $2, $3)
       on conflict (org_id, key) do update set name = excluded.name
       returning id`,
      [orgId, key, key === "enterprise" ? "Enterprise team" : "Default team"],
    );
    for (const member of members.filter((m) => m.team === key)) {
      await client.query(
        `insert into team_members (team_id, user_id, weight)
         values ($1, $2, $3)
         on conflict (team_id, user_id) do update set weight = excluded.weight`,
        [teamId, userIds[member.email], member.weight],
      );
    }
  }

  const fields = [
    { key: "name", label: "Full name", type: "text", required: true },
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
      options: ["US", "CA", "GB", "DE", "Other"],
    },
    {
      key: "message",
      label: "Anything we should know?",
      type: "textarea",
      required: false,
    },
    {
      key: "consent",
      label: "I agree that my details are stored to process this request.",
      type: "consent",
      required: true,
    },
  ];

  await client.query(
    `insert into forms (org_id, name, slug, fields, rule_set_id)
     values ($1, 'Book a demo', $2, $3, $4)
     on conflict (org_id, slug) do update
       set name = excluded.name, fields = excluded.fields, rule_set_id = excluded.rule_set_id`,
    [orgId, FORM_SLUG, JSON.stringify(fields), ruleSetId],
  );

  console.log(`Seeded org "${ORG_SLUG}" with form /f/${FORM_SLUG} (rule set v1).`);
}

async function one(sql, params) {
  const { rows } = await client.query(sql, params);
  return rows[0].id;
}

try {
  await main();
} finally {
  await client.end();
}

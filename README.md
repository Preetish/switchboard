# Switchboard

Open-source inbound lead routing and instant booking. Qualify a form
submission, route it to the right rep using your CRM data, and book the meeting
in seconds. Self-hostable.

## Status

Task 3 of the roadmap (rules engine) landed on top of the task 1 scaffold and
task 2 database schema. The hosted form, calendar, CRM, and booking UI land in
subsequent PRs.

## Rules engine

Rule sets live in `packages/core` as pure functions over a validated,
git-friendly YAML format (see `examples/rules.example.yaml`):

```yaml
rules:
  - name: Existing owner wins
    when: { crm.contact.owner: exists }
    route: { to: crm.contact.owner }
  - name: Enterprise
    when: { form.company_size: { gte: 500 } }
    route: { team: enterprise, strategy: round_robin }
  - name: Personal email
    when: { form.email_domain: { in: [gmail.com, outlook.com] } }
    route: { action: self_serve_link }
fallback: { team: default, strategy: round_robin }
```

- Rules apply top to bottom; the first match wins, otherwise `fallback` fires.
- `form.*` keys come from the submission, `crm.*` keys from CRM lookups that
  the caller prefetches (see `crmPathsIn`) before evaluation.
- Bare scalars are `eq` shorthand and the bare word `exists` means
  `{ exists: true }`.
- Operators: `eq`, `neq`, `in`, `nin`, `gt`, `gte`, `lt`, `lte`, `exists`,
  `contains`, `matches` (regex), plus `freeEmail` / `workEmail` sugar for
  free-vs-work email conditions.
- Any condition on a missing value fails (data absence never routes a lead);
  only `exists` can reason about absence.
- Numeric comparisons coerce string form values, so `"500"` matches
  `{ gte: 500 }`.

Load a file with `loadRuleSetYaml(text)` (or `validateRuleSet(parsed)` for
already-parsed JSON), evaluate with `evaluate(ruleSet, inputs)`, and inspect
`evaluation.trace` — the routing log UI (later task) persists inputs, the
matched rule, and the outcome.

## Quick start

```bash
npm install
docker compose up -d   # Postgres 16
cp .env.example .env
npm run db:migrate     # create tables from packages/db/migrations
npm run dev            # web app on http://localhost:3000
```

## Scripts

| Script                 | What it does                                       |
| ---------------------- | -------------------------------------------------- |
| `npm run dev`          | Next.js dev server (`apps/web`)                    |
| `npm run build`        | Production build                                   |
| `npm run lint`         | ESLint across all workspaces                       |
| `npm run typecheck`    | TypeScript across all workspaces                   |
| `npm test`             | Vitest across all workspaces                       |
| `npm run format`       | Prettier                                           |
| `npm run db:generate`  | Generate SQL migrations from the Drizzle schema    |
| `npm run db:migrate`   | Apply migrations to `DATABASE_URL`                 |

## Layout

- `apps/web` — Next.js app (forms, booking UI, admin)
- `packages/core` — rules engine, pure functions
- `packages/db` — Drizzle schema + committed SQL migrations
- `packages/ui` — design tokens (see `docs/design.md`)
- `docs/decisions.md` — architectural decision log

## Schema overview

Ten tables, all scoped to an `org` with cascading deletes: `users` (reps,
timezone + working hours), `teams` / `team_members` (round-robin weight,
weekly capacity, active flag), `forms` (field schema, linked rule set),
`rule_sets` (versioned rule JSON), `submissions` (idempotent per
`form_id + idempotency_key`), `routing_decisions` (inputs, matched rule,
outcome, latency), `bookings` (unique on `user_id + start_at` — the
double-booking guard), and `integrations` (encrypted OAuth token blobs).

## CI

CI runs lint, typecheck, tests, and the web build on every push to `main` and
every pull request (`.github/workflows/ci.yml`, Node 22).

## Configuration

All configuration is via environment variables; see `.env.example`. Never
commit secrets. Stored OAuth tokens will be encrypted at rest.

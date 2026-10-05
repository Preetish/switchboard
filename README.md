# Switchboard

Open-source inbound lead routing and instant booking. Qualify a form
submission, route it to the right rep using your CRM data, and book the meeting
in seconds. Self-hostable.

## Status

Task 2 of the roadmap (database schema and migrations) landed on top of the
task 1 scaffold. The rules engine, calendar, CRM, and booking UI land in
subsequent PRs.

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

CI runs lint, typecheck, tests, and the web build. The workflow file is
inlined in `docs/decisions.md` because of a GitHub App permission limitation —
move it to `.github/workflows/ci.yml` when the permission is available.

### CI workflow file — what needs to happen

GitHub rejects pushes that create or update files under
`.github/workflows/` unless the account pushing them has the `workflows`
permission. The Buildful GitHub App does not have it, so the workflow file
cannot be committed from here. One of these unblocks CI:

1. **A human committer copies the YAML** from `docs/decisions.md` into
   `.github/workflows/ci.yml` and commits it — no other setup needed, or
2. **An org admin grants the Buildful App the `workflows` permission**
   (org Settings → GitHub Apps → Buildful → Permissions), after which the
   agent can commit the file in a normal PR.

## Configuration

All configuration is via environment variables; see `.env.example`. Never
commit secrets. Stored OAuth tokens will be encrypted at rest.

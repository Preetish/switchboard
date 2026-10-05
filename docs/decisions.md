# Architectural decisions

Short-lived log of architectural choices. Newest at the bottom.

## 2026-10-05 — Stack

- **npm workspaces TypeScript monorepo** (`apps/web`, `packages/core`, `packages/ui`): matches the suggested stack; core stays pure-function and testable.
- **Postgres 16 via docker-compose, no Redis**: queue will be pg-boss on the same database (rule 3 — no extra services without justification).
- **Vitest**: fast, ESM-native, no separate test runner.
- **ESLint 9 flat config + typescript-eslint + Prettier**: repo-wide lint in one config.
- **Node 22 engines**: LTS with stable ESM support.
- **plain-CSS tokens in `packages/ui`** instead of Tailwind for now: the design standard needs a token source first; Tailwind v4 can layer on tokens later if a task needs component styling at speed.
- **License: UNLICENSED for now** — must be decided before the first public commit (see chat notes). TODO: pick MIT/Apache-2.0/AGPL. → **Decided 2026-10-05: Apache-2.0** (see below).

## 2026-10-05 — Database layer (task 2)

- **Drizzle ORM + drizzle-kit** (approved in session): SQL-first, typed schema in TypeScript, and SQL migrations committed as plain files that review well in PRs. Lighter than Prisma (no engine binary, no shadow DB).
- **`pg` (node-postgres) driver**: pg-boss (planned job queue) is built on `pg`, so the whole stack shares one Postgres client. No Redis.
- **Migrations are committed SQL** (`packages/db/migrations/`), generated offline with `drizzle-kit generate`; `npm run db:migrate` applies them to the Postgres 16 service in `docker-compose.yml`.
- **Double-booking guard**: `bookings` has a unique index on `(user_id, start_at)` — the transaction + 5-minute slot hold build on this in task 7.
- **Idempotency**: `submissions` has a unique index on `(form_id, idempotency_key)` so webhook/form retries cannot create duplicate routing decisions.
- **Tokens**: `integrations.token_cipher` stores a single encrypted blob (IV + ciphertext). Encryption key management arrives with task 5/9; nothing is ever stored in plaintext.
- **`team_members` has no direct `org_id`** — it cascades via `team`; avoids redundant columns and keeps one ownership path.
- **License: Apache-2.0** (approved in session). Permissive with an explicit patent grant, standard for self-hostable OSS; `LICENSE` file added.

## 2026-10-05 — CI without a committed workflow file

The Buildful GitHub App lacks the `workflows` permission, so GitHub rejects any
push containing files under `.github/workflows/`. To keep pushes green, the CI
definition lives here instead. Once the app gains the permission (or a
human committer adds it), move this to `.github/workflows/ci.yml` verbatim (see README → "CI workflow file"):

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build --workspace @switchboard/web
```

Equivalents of these steps run locally and pass; see the PR description for
the current run.

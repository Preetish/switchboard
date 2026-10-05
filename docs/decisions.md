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

## 2026-10-05 — CI workflow file lands (unblocks earlier workaround)

CI now runs from `.github/workflows/ci.yml` (lint, typecheck, tests, web build
on Node 22). It was previously inlined here because the Buildful GitHub App
lacked the `workflows` permission; an org admin granted it, so the file is
committed normally now.

## 2026-10-05 — Rules engine (task 3)

- **Pure, synchronous `evaluate(ruleSet, inputs)`**: rules evaluate against a
  flat input map the caller builds (`form.*` from the submission, `crm.*`
  prefetched lookups). CRM calls are I/O; keeping them out of the engine means
  it stays a pure function, trivially testable, and the caller controls the
  ~2s CRM timeout. `crmPathsIn(ruleSet)` tells the caller exactly which
  lookups to prefetch.
- **`zod` + `yaml`** are the only new dependencies: `yaml` parses the
  git-friendly rule files (dependency-free), `zod` (planned in the stack)
  validates rule sets with readable per-path errors before they reach the DB.
- **Rule authoring sugar**: bare scalars are `eq` shorthand and the bare word
  `exists` means `{ exists: true }`, so the brief's
  `when: { crm.contact.owner: exists }` validates verbatim.
- **Missing data never routes**: every condition on an absent value fails;
  only the explicit `exists` operator can reason about absence. This avoids
  silently routing leads with half-parsed form data.
- **Loose numeric comparison**: string form values coerce for `gt/gte/lt/lte`
  and cross-type `eq`/`in`/`nin` (forms submit strings), so `"500"` matches
  `{ gte: 500 }`. Empty strings never coerce.
- **Trace on every evaluation**: `evaluate` returns which rules were tried
  and the first failing `when` path for each — this feeds the routing log
  (task 10) so decisions are debuggable, per the brief's "headline feature".
- **Strategies stay out of the engine**: `route: { team, strategy }` returns
  the declared action; resolving round-robin/weights/capacity against roster
  and availability lands with task 6 on top of this output.

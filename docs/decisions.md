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

## 2026-10-06 — Form schema + hosted form page (task 4)

- **Form field type lives in `packages/core`** (not the DB package): the
  rules engine, the DB schema, and the hosted page must agree on one shape;
  `@switchboard/db` imports it type-only.
- **`consent` is a field type**, not a separate table column: forms collect
  personal data, so the brief's consent requirement is part of the definition
  a form author controls. Validators enforce that consent fields are always
  `required`.
- **`forms.slug` is globally unique** (new migration `0001`): the slug is the
  public key of a hosted page and an embed snippet, so `/f/<slug>` must be
  unambiguous; the org-scoped unique index stays for fast per-org lookups.
- **Submission payload validation rejects unknown fields** rather than
  silently dropping them — silent drops would hide misconfigured embeds; the
  rules engine also never sees data the form does not declare.
- **Duplicate submission handling**: `onConflictDoNothing` + re-select keyed
  on `(form_id, idempotency_key)` returns the original decision, so retries
  are read-only. Calls without an idempotency key are not deduped — the
  embed and hosted page always send one; the hosted page reuses the key for
  in-page retries.
- **Broken stored rule sets fail safe**: if `rule_sets.rules` no longer
  validates, the submission still records with the empty rule set (fallback
  queue) — a bad rule deploy never drops a lead.
- **`draftOutcome` in core, `finalizeOutcome` in web**: the engine stays
  I/O-free; the web app attaches `teamId`/`userId` from the database. An
  unmatched team falls back to the queue; an unmatched rep target is recorded
  as pending (owner mapping arrives with HubSpot).
- **GDPR deletion endpoint** (`POST /api/f/<slug>/delete`): deletes
  `submissions` by form + email; `routing_decisions` (which contain the
  inputs) cascade. A "Delete your data" section on the hosted page wires it
  to the lead directly.
- **Seed script is a plain `.mjs`** with raw SQL (`npm run db:seed`): no new
  TS tooling dependency, idempotent upserts, uses the example rule file so
  demo data and docs stay in sync.

## 2026-10-06 — Team strategies (task 6)

- **`selectRep` is pure in `packages/core`** like the rest of the engine: the
  web app supplies each member's load counters (assignment history,
  bookings-this-week) and availability, the function only picks. This keeps
  strategy selection unit-testable without a database and lets future
  callers (embed, API) reuse it.
- **Round robin is deterministic, not random**: smooth weighted round robin —
  the eligible rep with the lowest `assignments / weight` wins, ties go to the
  first member in caller order (members are sorted by email). Rotation state is
  the count of past `route_team` decisions per rep, so it survives restarts and
  needs no extra table or Redis.
- **Weekly capacity uses Monday 00:00 UTC** as the window for every rep.
  Rep-local weeks (time-zone aware) would need per-member window bounds; the
  simplification is acceptable until the calendar task lands per-slot
  availability, and is documented here rather than hidden.
- **`existing_owner` falls back to round robin** when the CRM owner is absent,
  inactive, or at capacity — owner-wins must never drop a lead. Owner
  resolution itself activates with the HubSpot task (the seam already accepts
  an owner user id).
- **No eligible rep ⇒ fallback queue, recorded honestly**: the decision outcome
  carries the reason ("capacity or availability"), so the routing log shows why
  a lead was queued instead of routed.
- **Calendar free/busy is folded into `available`** for now (membership active
  flag); the Google task narrows it with real availability rather than
  changing the strategy interface.

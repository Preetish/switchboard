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

## 2026-10-06 — Google Calendar OAuth + availability (task 5)

- **Slot math is pure in `packages/core` on `Intl`** (zero new dependencies):
  Node and browsers ship the full IANA time-zone database, so wall-time →
  UTC conversion needs no date-fn-tz/moment. A two-pass conversion lands on
  the offset actually in effect, which makes DST transitions correct;
  ambiguous fall-back times resolve to their first occurrence, and the
  (nonexistent) spring-forward gap times never occur in working hours, so the
  engine never relies on their arbitrary resolution.
- **`packages/calendar-google` is fetch-only** (zero new dependencies): the
  OAuth endpoints are two URLs and form posts; an SDK would add surface, not
  capability. Every call takes a ~2s timeout (per the routing brief) via
  `AbortSignal.timeout` and raises typed errors (`GoogleAuthError`,
  `GoogleApiError`) instead of hanging.
- **Availability degrades, never fails**: if Google is unreachable or errors,
  `GET /api/availability/<rep>` still returns slots computed from local
  confirmed bookings and flags `source: "local"` with a `calendarError`. The
  email-a-plain-booking-link fallback for booking creation itself lands with
  task 7.
- **Tokens are encrypted at rest**: `integrations.token_cipher` is
  AES-256-GCM (`base64(iv | tag | ciphertext)`) with `TOKEN_ENCRYPTION_KEY`
  (32-byte hex). Tokens are decrypted only in memory, refreshed lazily 60s
  before expiry, and the stored refresh token is carried forward when Google
  omits it in refresh responses. An unreadable blob (rotated/lost key) counts
  as not connected — the admin reconnects and overwrites the row.
- **Google scopes at connect**: `calendar.freebusy` (availability now) and
  `calendar.events` (event + Meet-link creation in task 7) so one consent
  covers the whole v0.1 calendar scope.
- **`ADMIN_SETUP_KEY` guards the OAuth handshake** as an interim until
  Auth.js (task 13): only a key holder can start the connect that stores an
  org integration. CSRF state round-trips via a signed httpOnly cookie
  compared in the callback.
- **Single-org mode via `ORG_SLUG`** (default: the seed org `acme`) — v0.1 is
  self-hosted single-org; the multi-tenant question is a declared non-goal.
- **`WorkingHours` moved to `@switchboard/core`** (type-only change in the DB
  package): the slot engine, the DB schema, and future booking flows must agree
  on one shape, mirroring the `FormField` decision from task 4.

## 2026-10-06 — Booking creation (task 7)

- **Two-phase booking with a `hold` status**: the slot is claimed by inserting
  a `bookings` row with `status = 'hold'` — the unique index on
  `(user_id, start_at)` makes the claim atomic — and confirmed by a follow-up
  update once the calendar event exists. The hold is *committed before* the
  network call on purpose: a DB transaction held open across the ~2s Google
  call would roll back on a crash and free a slot a lead may have seen as
  booked; a committed hold survives the crash and lazy cleanup releases it
  after ~5 minutes. Cleanup runs on read paths (availability, booking) so no
  background job or extra service is needed.
- **`hold` required no migration**: the `status` column is plain `text` with a
  type-level union (no DB constraint), so adding a state is a schema-type
  change only. The idempotency key *is* a migration (`0002`,
  `bookings.idempotency_key` + unique index).
- **Booking idempotency = the slot claim**: retries with the same
  `idempotencyKey` return the original row (pre-select + on-conflict
  re-select); keyless retries for the same slot hit the unique index and get
  `409 slot_taken`. Either way a retry never creates a second booking.
- **Live free/busy re-check before event creation**: the availability the UI
  used may be stale by minutes; a fresh free/busy fetch for the slot window
  catches a clash and releases the hold with `409`. A free/busy *failure*
  degrades and proceeds — an outage must not make booking impossible, matching
  the availability degradation from task 5.
- **Calendar event failure confirms locally**: per the brief, the booking is
  not lost when Google fails; the failure is logged, surfaced as
  `calendarError`, and the confirmation email carries a plain booking link
  (`FALLBACK_BOOKING_URL`, optional) instead of a Meet link. Rep email is the
  contact in every confirmation email.
- **Email is best-effort with BYO SMTP**: `SMTP_URL` (nodemailer) — the only
  new dependency (justification: the maintained standard SMTP client; Node has
  no built-in SMTP and a hand-rolled client is not a good idea). Without
  `SMTP_URL` the email is skipped with a warning; a failed send logs and the
  booking stands. Meeting time is rendered in the rep's time zone (`Intl`,
  honoring DST) and labeled with it.
- **One Google integration per org** (from task 5) means free/busy and events
  run against the connected calendar; per-rep calendars land with per-rep
  OAuth (admin auth milestone).
- **Slot window validation** on the server: duration clamped to 15–240
  minutes, slot start in the future, `endAt = startAt + duration` — the API
  trusts nothing the client computed.

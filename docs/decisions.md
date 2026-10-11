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

## Instant-booking inline UI (task 9)

- **Slots render in the lead's time zone**: the lead chooses a time, so their
  local calendar view is primary; `groupSlotsByDay` (pure, in core) buckets
  the rep's UTC slots into the lead's local days, DST-correct. The rep's zone
  is displayed alongside, never hidden — a 9:00 booking is the *rep's* 9:00
  nowhere; the label states which zone is which.
- **30-minute meetings, 14-day window, fixed for now**: the availability API
  already parameterizes both, but the form UI pins them; surfacing a picker is
  deferred until a real deployment shows the demand.
- **Two-step confirm (slot, then confirm bar)**: one tap selects, a second
  books. Prevents fat-finger bookings on mobile and gives the lead the exact
  range before committing.
- **Booking idempotency key is per page load**: a retried confirm (double
  click, flaky network) returns the original booking instead of erroring.
- **`409 slot_taken` refreshes the calendar**: the slot list is a snapshot;
  after a race the UI reloads availability and clears the selection rather
  than letting the lead keep pressing a dead slot.
- **Degradation is explicit**: load failure keeps the "routed to <rep>"
  message with a retry button (the routing outcome is already durable);
  an empty calendar says so and promises email follow-up; a Google outage
  renders local-only slots with a note.

## HubSpot OAuth + CRM-aware routing + write-back (task 8)

- **Mirror of `calendar-google`, no SDK**: `packages/crm-hubspot` speaks
  HubSpot OAuth (authorization code + refresh) and the CRM v3 API over plain
  `fetch` with ~2s timeouts, exactly like the Google package. The HubSpot SDK
  would add dependency surface without adding capability.
- **Owner lookup feeds the existing seam**: the rules engine stays pure —
  `crmPathsIn()` already declared which `crm.*` paths a rule set reads, so the
  web app prefetches exactly those (only when the lead has an email) before
  evaluation. The owner's *email* is stored at `crm.contact.owner`, which
  makes both rule shapes work with no engine changes: a
  `route: { to: crm.contact.owner }` resolves to an email that
  `finalizeOutcome` matches against local reps, and
  `strategy: existing_owner` passes the owner's user id into `selectRep`
  (already implemented and unit-tested in task 6).
- **Rep matching is by email**: a HubSpot owner routes to the Switchboard rep
  with the same email. This is the simplest mapping that survives HubSpot's
  owner-id churn (owner ids differ between portals/apps) and is documented in
  the README. An owner without a matching rep degrades to the existing
  fallbacks (pending rep matching / round robin), never an error.
- **Write-backs are best-effort and idempotent**: the contact upsert uses
  HubSpot's `POST /crm/v3/objects/contacts/batch/upsert` endpoint keyed on
  `idProperty=email` (verified against the live API — the
  `idempotent-upsert` route does not exist and returns 405), so a retry
  updates the same contact instead of creating a duplicate CRM record. The
  logged meeting is created once and its HubSpot id stored on
  `bookings.crm_meeting_id` (migration `0003`); repeat booking calls skip the
  API when it is set. Both fire after the durable state (routing decision /
  confirmed booking) is committed, so a HubSpot failure is logged and
  degrades — it never blocks routing or unbooks a meeting, mirroring the
  confirmation-email policy.
- **Only known form fields map to HubSpot properties**: `name` splits into
  `firstname`/`lastname`, `company` maps 1:1. Sending arbitrary org-defined
  form keys would 400 on unknown HubSpot properties, so the whitelist is
  deliberate; the full submission stays in `routing_decisions.inputs`.
- **Overall CRM budget (~3s)**: a context lookup can span two calls (contact +
  owner), so the prefetch races a deadline; a late result is discarded and
  logged, keeping form submits fast even when HubSpot is slow. Per-call
  timeouts remain ~2s each.
- **Meetings carry the owner id when known** (`hubspot_owner_id` from the
  contact), so the meeting lands on the right rep's calendar/timeline in
  HubSpot; association uses the HubSpot-defined "Meeting → contact" type
  (id 199).

## Routing log UI + CSV export (task 10)

- **Read-side lives in the web app, not core**: the log is a DB concern
  (joins, search), while the pure parts (CSV serialization, LIKE escaping,
  outcome labels) are unit-tested helpers in `apps/web/src/lib/decisions-log.ts`.
  Core stays I/O-free domain logic.
- **Search matches email, rule name, and outcome reason** via case-insensitive
  `ILIKE` over `submissions.email`, `routing_decisions.matched_rule`, and the
  outcome's `reason` key. LIKE wildcards in the query (`%`, `_`, `\`) are
  escaped so searching `50%` finds `50%`, not `50` followed by anything.
- **Rep/team names resolve in two small `inArray` queries** for just the ids on
  the page instead of joining on `outcome->>'userId'` in SQL: joining on a
  jsonb key requires a uuid cast, and a malformed id would 500 the page (the
  same class of bug fixed in task 4's `finalizeOutcome`). Ids are filtered to
  UUID shape before querying — defensive, since `finalizeOutcome` only ever
  stores real ids.
- **CSV is RFC 4180 with CRLF endings**, flat columns (`decided_at, lead_email,
  form, matched_rule, outcome, rep, team, latency_ms, reason`). A null
  `matched_rule` renders as `fallback` (only the fallback fired — the column
  is machine-filterable). Cells opening with `=`, `+`, `-`, `@` are prefixed
  with `'` per the OWASP CSV-injection guidance, because lead-controlled form
  data flows into reason cells and admins open this file in spreadsheets.
- **Export is capped at 5,000 rows** (the page shows the latest 100) so a long
  log cannot produce an unbounded download; the same `q` search applies to
  both, and the export link carries it, so "what I see is what I export".
- **Access uses the interim `ADMIN_SETUP_KEY` guard** like `/integrations`,
  until admin auth (Auth.js, task 13) replaces it: the log holds lead PII, so
  it must not be public.

## 2026-10-10 — Embed snippet (task 11)

- **iframe loader, not DOM injection**: v0.1 draft injected the whole form UI
  from a standalone script; minified it was ~14 KB (over the brief's 10 KB
  budget) and duplicated validation, availability grouping, booking, and the
  delete flow that the hosted page already owns. Shipped instead is a ~1 KB
  loader that injects an iframe of `/f/<slug>?embed=1`. One implementation of
  the flow, zero drift, complete style isolation from host pages; the
  cross-origin DOM-injection approach would also have required CORS on every
  lead-facing route (deliberately not shipped).
- **Embed mode** (`?embed=1`) removes the page's own padding and makes the
  body transparent, and the page **reports its height via postMessage**
  (`switchboard:resize`) on a ResizeObserver. The loader accepts a message
  only when `event.origin` is the deployment origin **and** `event.source` is
  the widget's own `contentWindow`, clamps the height to 200–4000 px, so a
  rogue host message cannot shrink or blow up the widget; the payload is a
  number, never HTML.
- **The target origin comes from the message's own referrer** when available,
  falling back to `*` (harmless: the payload is a height and the loader
  validates origin+source on its side; a strict referrer policy must not
  break resizing).
- **Committed minified artifact**: `apps/web/public/embed.js` is built from
  `packages/embed/embed.js` with esbuild (`npm run build -w
  @switchboard/embed`). A guard test pins the artifact under 10 KB,
  byte-identical to a fresh minify, and asserts the safety properties (no
  eval/innerHTML/document.write, validated postMessage). New devDependency:
  `esbuild` in `@switchboard/embed` only — the minifier for the committed
  artifact (it was already present transitively via vite/drizzle-kit; now
  pinned where it is used).
- **Multiple widgets per page** are supported; each placeholder mounts its
  own iframe, guarded by `node.__sbEmbed` against double-mounting when the
  script is loaded twice.

## 2026-10-10 — Speed-to-lead alerts (task 12)

- **pg-boss on the same Postgres** (per the brief: Postgres-backed queue, no
  Redis). The boss installs and migrates its own `pgboss` schema on start and
  shares `DATABASE_URL`; `docker compose up` needs no extra services. The
  worker runs **in-process via `instrumentation.ts`** — a self-hoster gets
  alerts from `npm run dev`/`next start` with no second process. Scaling to
  multiple app instances is safe (pg-boss competing consumers) and documented.
- **Alert scheduling is best-effort**: when a submission routes to a concrete
  rep, the job is scheduled with a `startAfter` of `SPEED_TO_LEAD_MINUTES`
  (default 5, invalid values fall back, sub-minute floors to 1). A queue that
  cannot start never fails the submission — the alert is skipped with a logged
  reason. Leads routed to a team without a resolved rep, self-serve links, or
  the fallback queue schedule nothing (there is no rep to notify yet).
- **The job re-checks reality at fire time**: expired holds are released, then
  a confirmed booking or live hold for the submission suppresses the alert
  ("booked in time"), and the rep is looked up fresh (no stale payload).
- **At-most-once delivery** via an `alerted_at` claim on `submissions`
  (conditional `UPDATE … WHERE alerted_at IS NULL`): only the attempt that
  flips the column may notify, so pg-boss retries cannot double-alert. The
  column dies with the submission under the GDPR delete cascade.
- **Slack first, email as fallback**: the `SLACK_WEBHOOK_URL` incoming
  webhook posts to a channel naming the rep (DM-per-rep needs a Slack app +
  per-user tokens — deferred); without Slack, or when it fails, the alert goes
  by email to the rep over `SMTP_URL` (shared, timeout-pinned sender). With
  neither configured the alert is skipped honestly and logged.
- **pg-boss v12 requires explicit queues**: the alert queue is created
  idempotently (`createQueue`, ON CONFLICT DO NOTHING) before `send` and
  `work`; v12 is ESM-only Node ≥22, so `pg-boss` is listed in
  `serverExternalPackages` and the instrumentation import sits inside the
  `NEXT_RUNTIME === "nodejs"` check so the Node-only graph is never bundled
  for the edge runtime.

## 2026-10-10 — Admin auth + abuse protection (task 13)

- **Auth.js credentials, env-configured admin**: the single self-hosted admin
  account comes from `ADMIN_EMAIL` + `ADMIN_PASSWORD` (never the database —
  no seed secret, nothing to rotate in a UI), with a JWT session cookie
  signed by `AUTH_SECRET`. Chosen over a hand-rolled cookie session because
  the brief mandates Auth.js and it handles the CSRF/cookie/session
  machinery; chosen over an OAuth-provider login because a self-hoster's
  admin should not depend on a third-party identity to manage their own
  instance. Guarded surfaces: `/integrations`, `/routing-log`, both OAuth
  connect routes, and the CSV export (which also accepts `ADMIN_SETUP_KEY`
  so cron/curl exports work without a cookie jar — the key's only remaining
  job). Login attempts are rate-limited per IP.
- **Honeypot before CAPTCHA**: the hosted form renders an off-screen,
  autocomplete-off field ("leave this field empty"); a filled value means a
  bot and the submission is rejected with a generic error. No third-party
  script, no challenge for humans, and the embed inherits it automatically
  because the iframe hosts the same form.
- **Disposable-email check is a static, exact-domain list** in
  `packages/core` (`isDisposableEmail`, next to the free-email list). It
  only needs to catch the common throwaway services bots rotate through;
  subdomain and lookalike hosts are deliberately not matched (same contract
  as `isFreeEmail`). Enforced on the form's email field with an ordinary
  field error, so it degrades to normal validation UX.
- **Rate limiting is in-memory, per instance**: a sliding-window log keyed
  by `x-forwarded-for` (first hop) / `x-real-ip` / "unknown", with limits
  per route purpose (submit 30/5min, delete 10/5min, booking 20/5min,
  availability 60/5min, login 10/5min). Rejected over-limit requests get
  `429` + `Retry-After`. Chosen over a Postgres counter table to keep every
  public request cheap and avoid a migration; the documented tradeoff is
  that limits reset on restart and are per instance (a load-balanced
  deployment multiplies them — acceptable for v0.1 single-node self-hosting;
  revisit with a real multi-node story).

## 2026-10-11 — One-command `docker compose up` (task 14)

- **Full stack in compose, migrations + seed in the entrypoint**: the compose
  file gains an `app` service built from a repo-root `Dockerfile` (Node 22
  alpine, `npm ci`, `next build`, workspace TS-source packages compiled via
  the existing `transpilePackages` setup). The container entrypoint
  (`docker/app-entrypoint.sh`) runs `npm run db:migrate` then
  `node packages/db/scripts/seed.mjs` before `next start` — compose's
  `depends_on: condition: service_healthy` guarantees Postgres is ready, and
  both steps are idempotent so restarts are safe. Chosen over a separate
  migrate service or an init container: one service, one log stream, and
  migrations re-run on every boot (drizzle-kit tracks applied migrations, so
  re-running is a no-op).
- **Demo defaults in compose, real values via `.env`**: `docker compose up`
  alone yields a working demo (admin `admin@example.com` / `admin1234`, a dev
  `AUTH_SECRET`), and compose substitutes anything set in `.env`
  (`${VAR:-default}`). Two deliberate exceptions: `TOKEN_ENCRYPTION_KEY` has
  **no** demo default — encrypting real OAuth tokens with a key published in
  the repo would be a real vulnerability, so connecting Google/HubSpot
  without setting it fails with the existing clear error; and the entrypoint
  prints a warning while the demo `ADMIN_PASSWORD` default is in effect.
  `SEED_DEMO_DATA` (default `true`) gates the demo seed for clean instances.

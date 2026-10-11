# Architectural decisions

Why Switchboard is built the way it is. Newest at the bottom; later entries
note when they supersede earlier ones.

## 2026-10-05: Stack

- **npm workspaces TypeScript monorepo** (`apps/web`, `packages/core`, `packages/ui`): matches the suggested stack; core stays pure-function and testable.
- **Postgres 16 via docker-compose, no Redis**: queue will be pg-boss on the same database (no extra services without justification).
- **Vitest**: fast, ESM-native, no separate test runner.
- **ESLint 9 flat config + typescript-eslint + Prettier**: repo-wide lint in one config.
- **Node 22 engines**: LTS with stable ESM support.
- **plain-CSS tokens in `packages/ui`** instead of Tailwind for now: the design standard needs a token source first; Tailwind v4 can layer on tokens later if component styling needs it at speed.

## 2026-10-05: Database layer

- **Drizzle ORM + drizzle-kit**: SQL-first, typed schema in TypeScript, and SQL migrations committed as plain files that review well in PRs. Lighter than Prisma (no engine binary, no shadow DB).
- **`pg` (node-postgres) driver**: pg-boss (planned job queue) is built on `pg`, so the whole stack shares one Postgres client. No Redis.
- **Migrations are committed SQL** (`packages/db/migrations/`), generated offline with `drizzle-kit generate`; `npm run db:migrate` applies them to the Postgres 16 service in `docker-compose.yml`.
- **Double-booking guard**: `bookings` has a unique index on `(user_id, start_at)`; the transaction + 5-minute slot hold build on this in a later milestone.
- **Idempotency**: `submissions` has a unique index on `(form_id, idempotency_key)` so webhook/form retries cannot create duplicate routing decisions.
- **Tokens**: `integrations.token_cipher` stores a single encrypted blob (IV + ciphertext). Encryption key management arrives with a later milestone/9; nothing is ever stored in plaintext.
- **`team_members` has no direct `org_id`**; it cascades via `team`; avoids redundant columns and keeps one ownership path.
- **License: Apache-2.0**. Permissive with an explicit patent grant, standard for self-hostable OSS; `LICENSE` file added.


## 2026-10-05: Rules engine

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
  `exists` means `{ exists: true }`, so the README's
  `when: { crm.contact.owner: exists }` validates verbatim.
- **Missing data never routes**: every condition on an absent value fails;
  only the explicit `exists` operator can reason about absence. This avoids
  silently routing leads with half-parsed form data.
- **Loose numeric comparison**: string form values coerce for `gt/gte/lt/lte`
  and cross-type `eq`/`in`/`nin` (forms submit strings), so `"500"` matches
  `{ gte: 500 }`. Empty strings never coerce.
- **Trace on every evaluation**: `evaluate` returns which rules were tried
  and the first failing `when` path for each; this feeds the routing log
  so decisions are debuggable, because the log is a headline feature.
- **Strategies stay out of the engine**: `route: { team, strategy }` returns
  the declared action; resolving round-robin/weights/capacity against roster
  and availability lands with a later milestone on top of this output.

## 2026-10-06: Form schema + hosted form page

- **Form field type lives in `packages/core`** (not the DB package): the
  rules engine, the DB schema, and the hosted page must agree on one shape;
  `@switchboard/db` imports it type-only.
- **`consent` is a field type**, not a separate table column: forms collect
  personal data, so the consent requirement is part of the definition
  a form author controls. Validators enforce that consent fields are always
  `required`.
- **`forms.slug` is globally unique** (new migration `0001`): the slug is the
  public key of a hosted page and an embed snippet, so `/f/<slug>` must be
  unambiguous; the org-scoped unique index stays for fast per-org lookups.
- **Submission payload validation rejects unknown fields** rather than
  silently dropping them; silent drops would hide misconfigured embeds; the
  rules engine also never sees data the form does not declare.
- **Duplicate submission handling**: `onConflictDoNothing` + re-select keyed
  on `(form_id, idempotency_key)` returns the original decision, so retries
  are read-only. Calls without an idempotency key are not deduped; the
  embed and hosted page always send one; the hosted page reuses the key for
  in-page retries.
- **Broken stored rule sets fail safe**: if `rule_sets.rules` no longer
  validates, the submission still records with the empty rule set (fallback
  queue); a bad rule deploy never drops a lead.
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

## 2026-10-06: Team strategies

- **`selectRep` is pure in `packages/core`** like the rest of the engine: the
  web app supplies each member's load counters (assignment history,
  bookings-this-week) and availability, the function only picks. This keeps
  strategy selection unit-testable without a database and lets future
  callers (embed, API) reuse it.
- **Round robin is deterministic, not random**: smooth weighted round robin;
  the eligible rep with the lowest `assignments / weight` wins, ties go to the
  first member in caller order (members are sorted by email). Rotation state is
  the count of past `route_team` decisions per rep, so it survives restarts and
  needs no extra table or Redis.
- **Weekly capacity uses Monday 00:00 UTC** as the window for every rep.
  Rep-local weeks (time-zone aware) would need per-member window bounds; the
  simplification is acceptable until calendar integration adds per-slot
  availability, and is documented here rather than hidden.
- **`existing_owner` falls back to round robin** when the CRM owner is absent,
  inactive, or at capacity; owner-wins must never drop a lead. Owner
  resolution itself activates with the HubSpot integration (the seam already accepts
  an owner user id).
- **No eligible rep ⇒ fallback queue, recorded honestly**: the decision outcome
  carries the reason ("capacity or availability"), so the routing log shows why
  a lead was queued instead of routed.
- **Calendar free/busy is folded into `available`** for now (membership active
  flag); the Google integration narrows it with real availability rather than
  changing the strategy interface.

## 2026-10-06: Google Calendar OAuth + availability

- **Slot math is pure in `packages/core` on `Intl`** (zero new dependencies):
  Node and browsers ship the full IANA time-zone database, so wall-time →
  UTC conversion needs no date-fn-tz/moment. A two-pass conversion lands on
  the offset actually in effect, which makes DST transitions correct;
  ambiguous fall-back times resolve to their first occurrence, and the
  (nonexistent) spring-forward gap times never occur in working hours, so the
  engine never relies on their arbitrary resolution.
- **`packages/calendar-google` is fetch-only** (zero new dependencies): the
  OAuth endpoints are two URLs and form posts; an SDK would add surface, not
  capability. Every call takes a ~2s timeout  via
  `AbortSignal.timeout` and raises typed errors (`GoogleAuthError`,
  `GoogleApiError`) instead of hanging.
- **Availability degrades, never fails**: if Google is unreachable or errors,
  `GET /api/availability/<rep>` still returns slots computed from local
  confirmed bookings and flags `source: "local"` with a `calendarError`. The
  email-a-plain-booking-link fallback for booking creation itself lands with
  a later milestone.
- **Tokens are encrypted at rest**: `integrations.token_cipher` is
  AES-256-GCM (`base64(iv | tag | ciphertext)`) with `TOKEN_ENCRYPTION_KEY`
  (32-byte hex). Tokens are decrypted only in memory, refreshed lazily 60s
  before expiry, and the stored refresh token is carried forward when Google
  omits it in refresh responses. An unreadable blob (rotated/lost key) counts
  as not connected; the admin reconnects and overwrites the row.
- **Google scopes at connect**: `calendar.freebusy` (availability now) and
  `calendar.events` (event + Meet-link creation in a later milestone) so one consent
  covers the whole v0.1 calendar scope.
- **`ADMIN_SETUP_KEY` guards the OAuth handshake** as an interim until
  Auth.js: only a key holder can start the connect that stores an
  org integration. CSRF state round-trips via a signed httpOnly cookie
  compared in the callback.
- **Single-org mode via `ORG_SLUG`** (default: the seed org `acme`); v0.1 is
  self-hosted single-org; the multi-tenant question is a declared non-goal.
- **`WorkingHours` moved to `@switchboard/core`** (type-only change in the DB
  package): the slot engine, the DB schema, and future booking flows must agree
  on one shape, mirroring the `FormField` decision from a later milestone.

## 2026-10-06: Booking creation

- **Two-phase booking with a `hold` status**: the slot is claimed by inserting
  a `bookings` row with `status = 'hold'` (the unique index on
  `(user_id, start_at)` makes the claim atomic) and confirmed by a follow-up
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
  degrades and proceeds; an outage must not make booking impossible, matching
  the availability degradation from a later milestone.
- **Calendar event failure confirms locally**: by design, the booking is
  not lost when Google fails; the failure is logged, surfaced as
  `calendarError`, and the confirmation email carries a plain booking link
  (`FALLBACK_BOOKING_URL`, optional) instead of a Meet link. Rep email is the
  contact in every confirmation email.
- **Email is best-effort with BYO SMTP**: `SMTP_URL` (nodemailer); the only
  new dependency (justification: the maintained standard SMTP client; Node has
  no built-in SMTP and a hand-rolled client is not a good idea). Without
  `SMTP_URL` the email is skipped with a warning; a failed send logs and the
  booking stands. Meeting time is rendered in the rep's time zone (`Intl`,
  honoring DST) and labeled with it.
- **One Google integration per org** (from a later milestone) means free/busy and events
  run against the connected calendar; per-rep calendars land with per-rep
  OAuth (admin auth milestone).
- **Slot window validation** on the server: duration clamped to 15 to 240
  minutes, slot start in the future, `endAt = startAt + duration`; the API
  trusts nothing the client computed.

## 2026-10-07: Instant-booking inline UI

- **Slots render in the lead's time zone**: the lead chooses a time, so their
  local calendar view is primary; `groupSlotsByDay` (pure, in core) buckets
  the rep's UTC slots into the lead's local days, DST-correct. The rep's zone
  is displayed alongside, never hidden; a 9:00 booking is the *rep's* 9:00
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

## 2026-10-08: HubSpot OAuth + CRM-aware routing + write-back

- **Mirror of `calendar-google`, no SDK**: `packages/crm-hubspot` speaks
  HubSpot OAuth (authorization code + refresh) and the CRM v3 API over plain
  `fetch` with ~2s timeouts, exactly like the Google package. The HubSpot SDK
  would add dependency surface without adding capability.
- **Owner lookup feeds the existing seam**: the rules engine stays pure;
  `crmPathsIn()` already declared which `crm.*` paths a rule set reads, so the
  web app prefetches exactly those (only when the lead has an email) before
  evaluation. The owner's *email* is stored at `crm.contact.owner`, which
  makes both rule shapes work with no engine changes: a
  `route: { to: crm.contact.owner }` resolves to an email that
  `finalizeOutcome` matches against local reps, and
  `strategy: existing_owner` passes the owner's user id into `selectRep`
  (already implemented and unit-tested in a later milestone).
- **Rep matching is by email**: a HubSpot owner routes to the Switchboard rep
  with the same email. This is the simplest mapping that survives HubSpot's
  owner-id churn (owner ids differ between portals/apps) and is documented in
  the README. An owner without a matching rep degrades to the existing
  fallbacks (pending rep matching / round robin), never an error.
- **Write-backs are best-effort and idempotent**: the contact upsert uses
  HubSpot's `POST /crm/v3/objects/contacts/batch/upsert` endpoint keyed on
  `idProperty=email` (verified against the live API: the
  `idempotent-upsert` route does not exist and returns 405), so a retry
  updates the same contact instead of creating a duplicate CRM record. The
  logged meeting is created once and its HubSpot id stored on
  `bookings.crm_meeting_id` (migration `0003`); repeat booking calls skip the
  API when it is set. Both fire after the durable state (routing decision /
  confirmed booking) is committed, so a HubSpot failure is logged and
  degrades; it never blocks routing or unbooks a meeting, mirroring the
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

## 2026-10-09: Routing log UI + CSV export

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
  same class of bug fixed in a later milestone's `finalizeOutcome`). Ids are filtered to
  UUID shape before querying; defensive, since `finalizeOutcome` only ever
  stores real ids.
- **CSV is RFC 4180 with CRLF endings**, flat columns (`decided_at, lead_email,
  form, matched_rule, outcome, rep, team, latency_ms, reason`). A null
  `matched_rule` renders as `fallback` (only the fallback fired; the column
  is machine-filterable). Cells opening with `=`, `+`, `-`, `@` are prefixed
  with `'` per the OWASP CSV-injection guidance, because lead-controlled form
  data flows into reason cells and admins open this file in spreadsheets.
- **Export is capped at 5,000 rows** (the page shows the latest 100) so a long
  log cannot produce an unbounded download; the same `q` search applies to
  both, and the export link carries it, so "what I see is what I export".
- **Access uses the interim `ADMIN_SETUP_KEY` guard** like `/integrations`,
  until admin auth (Auth.js, a later milestone) replaces it: the log holds lead PII, so
  it must not be public.

## 2026-10-10: Embed snippet

- **iframe loader, not DOM injection**: v0.1 draft injected the whole form UI
  from a standalone script; minified it was ~14 KB (over the 10 KB
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
  the widget's own `contentWindow`, clamps the height to 200 to 4000 px, so a
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
  `esbuild` in `@switchboard/embed` only; the minifier for the committed
  artifact (it was already present transitively via vite/drizzle-kit; now
  pinned where it is used).
- **Multiple widgets per page** are supported; each placeholder mounts its
  own iframe, guarded by `node.__sbEmbed` against double-mounting when the
  script is loaded twice.

## 2026-10-10: Speed-to-lead alerts

- **pg-boss on the same Postgres** (a Postgres-backed queue, no
  Redis). The boss installs and migrates its own `pgboss` schema on start and
  shares `DATABASE_URL`; `docker compose up` needs no extra services. The
  worker runs **in-process via `instrumentation.ts`**; a self-hoster gets
  alerts from `npm run dev`/`next start` with no second process. Scaling to
  multiple app instances is safe (pg-boss competing consumers) and documented.
- **Alert scheduling is best-effort**: when a submission routes to a concrete
  rep, the job is scheduled with a `startAfter` of `SPEED_TO_LEAD_MINUTES`
  (default 5, invalid values fall back, sub-minute floors to 1). A queue that
  cannot start never fails the submission; the alert is skipped with a logged
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
  per-user tokens; deferred); without Slack, or when it fails, the alert goes
  by email to the rep over `SMTP_URL` (shared, timeout-pinned sender). With
  neither configured the alert is skipped honestly and logged.
- **pg-boss v12 requires explicit queues**: the alert queue is created
  idempotently (`createQueue`, ON CONFLICT DO NOTHING) before `send` and
  `work`; v12 is ESM-only Node ≥22, so `pg-boss` is listed in
  `serverExternalPackages` and the instrumentation import sits inside the
  `NEXT_RUNTIME === "nodejs"` check so the Node-only graph is never bundled
  for the edge runtime.

## 2026-10-10: Admin auth + abuse protection

- **Auth.js credentials, env-configured admin**: the single self-hosted admin
  account comes from `ADMIN_EMAIL` + `ADMIN_PASSWORD` (never the database,
  so there is no seed secret and nothing to rotate in a UI), with a JWT session cookie
  signed by `AUTH_SECRET`. Chosen over a hand-rolled cookie session because
  Auth.js handles the CSRF/cookie/session
  machinery; chosen over an OAuth-provider login because a self-hoster's
  admin should not depend on a third-party identity to manage their own
  instance. Guarded surfaces: `/integrations`, `/routing-log`, both OAuth
  connect routes, and the CSV export (which also accepts `ADMIN_SETUP_KEY`
  so cron/curl exports work without a cookie jar; the key's only remaining
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
  deployment multiplies them; acceptable for v0.1 single-node self-hosting;
  revisit with a real multi-node story).

## 2026-10-11: One-command `docker compose up`

- **Full stack in compose, migrations + seed in the entrypoint**: the compose
  file gains an `app` service built from a repo-root `Dockerfile` (Node 22
  alpine, `npm ci`, `next build`, workspace TS-source packages compiled via
  the existing `transpilePackages` setup). The container entrypoint
  (`docker/app-entrypoint.sh`) runs `npm run db:migrate` then
  `node packages/db/scripts/seed.mjs` before `next start`; compose's
  `depends_on: condition: service_healthy` guarantees Postgres is ready, and
  both steps are idempotent so restarts are safe. Chosen over a separate
  migrate service or an init container: one service, one log stream, and
  migrations re-run on every boot (drizzle-kit tracks applied migrations, so
  re-running is a no-op).
- **Demo defaults in compose, real values via `.env`**: `docker compose up`
  alone yields a working demo (admin `admin@example.com` / `admin1234`, a dev
  `AUTH_SECRET`), and compose substitutes anything set in `.env`
  (`${VAR:-default}`). Two deliberate exceptions: `TOKEN_ENCRYPTION_KEY` has
  **no** demo default; encrypting real OAuth tokens with a key published in
  the repo would be a real vulnerability, so connecting Google/HubSpot
  without setting it fails with the existing clear error; and the entrypoint
  prints a warning while the demo `ADMIN_PASSWORD` default is in effect.
  `SEED_DEMO_DATA` (default `true`) gates the demo seed for clean instances.

## 2026-10-11: Docs and demo assets

- **A recorded GIF in `docs/demo.gif`** rather than a YouTube link or a
  screenshot collage: the README's first impression must show the actual
  submit → route → inline-book loop, self-hosters' READMEs render on GitHub
  where external video embeds are noise, and a GIF is a committed file that
  cannot rot into a dead link. Tradeoff accepted: the repo carries about 1 to 2 MB of
  binary; if it grows, it can move to a release asset.
- **Sample rule sets ship as files, not inline YAML in prose**: `examples/`
  now holds the starter set plus `rules.saas.yaml` (a realistic B2B SaaS
  flow). A Vitest pass loads **every** `examples/rules.*.yaml`, so samples
  are enforced-valid by CI instead of drifting out of sync with the format.
- **Self-hosting guide lives in `docs/self-hosting.md`**, keeping the README a
  fast overview: configuration reference table, the bring-your-own Google
  OAuth client walkthrough (Google requires verification for calendar scopes
  on public apps, so every self-hoster registers their own), HubSpot app
  setup, SMTP/Slack, HTTPS/proxy notes, upgrade path, and a pre-launch
  security checklist.

## 2026-10-11: Pre-launch hardening

A full audit before the first public release changed several earlier
decisions. Each item notes what it supersedes.

- **Google Calendar is per rep** (supersedes "one Google integration per
  org"). `integrations.user_id` with partial unique indexes: org-wide rows
  for HubSpot, per-rep rows for Google. Reps connect through signed,
  expiring links (`AUTH_SECRET` HMAC) so they never need the admin login;
  OAuth state is signed too, so a rep can't attach a calendar to someone
  else. A single org-wide calendar made every rep's availability the
  admin's, which defeated the product.
- **`switchboard.yaml` replaces the seed script** as the way to define reps,
  teams, forms, and rules. Config-as-code over an admin UI: it matches the
  "rules in git" promise, reviews like code, and validates cross-references
  (fields, teams, reps) before anything reaches a lead. Applied in one
  transaction; reps and forms are never deleted by omission because they
  hold history and lead data. `ORG_SLUG` became optional.
- **Rotation is smooth weighted round robin with persisted credit**
  (supersedes "assignment counts from routing_decisions"). Lifetime decision
  counts flooded new reps, mixed teams, rewound on deletes, and raced under
  concurrency. Credit per membership, updated under `SELECT … FOR UPDATE`,
  is exact, fair from day one, and serialized per team.
- **Overlap guard is an exclusion constraint** (supersedes the unique index
  on `user_id, start_at`): `EXCLUDE USING gist (user_id WITH =,
  tstzrange(start_at, end_at) WITH &&)` over live bookings. Needs
  `btree_gist`, available on every mainstream managed Postgres.
- **Bookings are scoped to the routed lead**: a submission id is required,
  its decision must name the rep, and the time must be an offered slot.
  Availability is served on the same terms. Before, the public API could
  book any rep at any time.
- **Rate limits key on the socket address** via a thin `server.mjs` wrapper
  and `TRUSTED_PROXY_HOPS` (supersedes trusting the first `X-Forwarded-For`
  hop, which any client could forge). A custom server was the only way:
  Next.js doesn't expose the socket to route handlers and only fills
  `X-Forwarded-For` when the client didn't send one.
- **No published secrets.** Compose generates missing secrets into a volume;
  production refuses to start on missing, short, or known-default values.
- **Side effects run on the queue** (CRM write-back, confirmation email,
  meeting log), not in the request, with send-once markers. The submission
  and its decision are written in one transaction.
- **Data deletion is verified by email** (supersedes the unauthenticated
  delete-by-email endpoint, which let anyone erase anyone's data and
  revealed who had submitted).
- **Rule semantics:** string comparisons are case-insensitive; an
  unresolved `form.`/`crm.` route target falls back instead of creating a
  phantom pending rep; the validator rejects typo'd paths and unreachable
  rules.
- **Tests:** a Postgres integration suite and Playwright browser tests join
  the unit tests in CI, because the bugs that mattered lived in SQL and in
  the browser, where mocked tests couldn't see them.
- **Screenshots replace the demo GIF** (supersedes "a recorded GIF"). The
  GIF went stale with the redesign; `scripts/screenshots.mjs` regenerates
  sharp PNGs of each step from a running instance, so the README can't drift
  from the product again.

## 2026-10-11: Attribution and conversion tracking

- **The loader collects attribution, not the iframe.** Only the script on
  the customer's page can see the landing URL, the real referrer, and
  first-party cookies. The form asks for it with a postMessage handshake
  (`switchboard:ready` → `switchboard:attribution`) rather than through the
  iframe URL, which keeps click IDs out of access logs and Referer headers.
- **Consent gates storage and cookies, not URL parameters.** Reading the
  current page's UTMs stores nothing on the device. Keeping first touch in
  localStorage and reading `_ga`/`_fbp`/`_fbc`/`_gcl_aw`/`hubspotutk` does,
  so it waits for `data-switchboard-consent="granted"` or
  `Switchboard.setConsent(true)`. The loader's own default is the
  privacy-safe one, but the documented snippet (and the one the Setup page
  copies) includes the attribute: most B2B sites want full attribution, and
  sites that need a consent banner remove it and call `setConsent` instead.
- **Last touch flat, first touch nested.** Rules mostly care about the visit
  that converted (`attribution.utm_medium`); first touch is there for
  reporting and ABM rules (`attribution.first.utm_source`).
- **The server trusts nothing.** Attribution comes from the browser, so it is
  allowlisted, length-capped, and URL-stripped (origin and path only), and a
  malformed payload never blocks a lead.
- **Conversions fire on the host page.** The iframe can't run the
  customer's tags, so the loader pushes `switchboard_submitted` /
  `switchboard_booked` to `dataLayer` and dispatches DOM events; ad platforms
  then match them to their own cookies. Payloads carry the form and outcome,
  never personal data. Offline conversion uploads (Google Ads, Meta CAPI)
  are left for later; the stored click IDs make them possible.
- **HubSpot properties are mapped, not guessed.** Portals name custom UTM
  properties differently and reject unknown ones, so `switchboard.yaml`
  states the mapping.


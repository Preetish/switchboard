# Switchboard

Open-source inbound lead routing and instant booking. Qualify a form
submission, route it to the right rep using your CRM data, and book the meeting
in seconds. Self-hostable.

## Status

Task 5 of the roadmap (Google Calendar OAuth, free/busy lookup, slot
calculation with working hours, time zones, and DST) landed on top of team
strategies, hosted forms, the rules engine, the database schema, and the
scaffold. The inline booking UI, CRM write-back, and the routing log UI land
in subsequent PRs.

## Hosted forms

Every form gets a hosted page at `/f/<slug>` (slugs are globally unique —
they are the public key of a form link or embed):

- Field definitions are validated with `validateFormFields` before storage and
  `validateSubmission` on submit (required fields, email format, select
  options, numeric values, max lengths). A `consent` field type renders a
  required checkbox for GDPR/CASL consent.
- `POST /api/f/<slug>/submit` validates the payload, evaluates the form's rule
  set, and stores a `submissions` row plus a `routing_decisions` row (inputs,
  matched rule, outcome, latency in ms). Retries with the same
  `idempotencyKey` return the original decision instead of creating a second
  submission.
- `POST /api/f/<slug>/delete` is the GDPR data-deletion endpoint: it erases
  every submission (and, by cascade, every routing decision) for the given
  email. The hosted page includes a "Delete your data" section wired to it.
- Rules read submitted values as `form.<key>` paths (`crm.*` lookups arrive
  with the HubSpot task).

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

## Strategies

When a rule routes to a team, the strategy picks the rep (`selectRep` in
`packages/core`, pure and deterministic — the app supplies each member's load
counters and availability):

- **`round_robin`** — smooth weighted round robin: the eligible rep with the
  lowest `assignments / weight` is next, so `weight: 2` gets roughly twice the
  turns. Assignment counts come from past `routing_decisions` rows.
- **`existing_owner`** — the CRM owner gets the lead when they are on the team
  and eligible; otherwise the team falls back to round robin so a missing or
  busy owner never drops a lead. (Owner resolution activates with the HubSpot
  task.)
- **Eligibility** — a rep is skipped when their membership is inactive (OOO or
  offboarding) or when `weekly_capacity` is set and their confirmed bookings in
  the current week (Monday 00:00 UTC) have reached it; `weekly_capacity: 0`
  means unlimited.
- If nobody on the team is eligible, the decision honestly records the reason
  and the lead goes to the fallback queue — never dropped silently.

## Calendar & availability

Availability is computed per rep from three inputs: their working hours
(local to their IANA time zone), confirmed local bookings, and — when
connected — Google Calendar free/busy:

- **Connect**: `/integrations` starts the OAuth handshake (guarded by
  `ADMIN_SETUP_KEY` until admin auth lands). Tokens are stored AES-256-GCM
  encrypted (`TOKEN_ENCRYPTION_KEY`), never in plaintext, and refreshed
  lazily before expiry. Self-hosters bring their own Google OAuth client
  (Google requires app verification for calendar scopes on public apps) with
  redirect URI `<base-url>/api/integrations/google/callback`.
- **Slots**: `computeSlots()` in `packages/core` is pure — it cuts a rep's
  working hours into slots in their zone, converts to UTC (DST-correct, half
  -hour offsets supported), and drops slots overlapping busy intervals or the
  lead-time window. Adjacent busy intervals do not conflict.
- **Degradation**: every Google call times out after ~2 seconds. If Google is
  unreachable or errors, availability falls back to local bookings only and
  the response flags `source: "local"` with a `calendarError` — the rep is
  never shown as unavailable because of an outage.
- **API**: `GET /api/availability/<repUserId>?duration=30&days=14` returns the
  slots (UTC ISO times) the instant-booking UI (task 9) will render.

## Quick start

```bash
npm install
docker compose up -d   # Postgres 16
cp .env.example .env
npm run db:migrate     # create tables from packages/db/migrations
npm run db:seed        # optional: demo org + form at /f/book-a-demo
npm run dev            # web app on http://localhost:3000
```

## Scripts

| Script                | What it does                                    |
| --------------------- | ----------------------------------------------- |
| `npm run dev`         | Next.js dev server (`apps/web`)                 |
| `npm run build`       | Production build                                |
| `npm run lint`        | ESLint across all workspaces                    |
| `npm run typecheck`   | TypeScript across all workspaces                |
| `npm test`            | Vitest across all workspaces                    |
| `npm run format`      | Prettier                                        |
| `npm run db:generate` | Generate SQL migrations from the Drizzle schema |
| `npm run db:migrate`  | Apply migrations to `DATABASE_URL`              |
| `npm run db:seed`     | Idempotent demo data (org, rules, teams, form)  |

## Layout

- `apps/web` — Next.js app (forms, booking UI, admin)
- `packages/core` — rules engine, calendar slot math, pure functions
- `packages/calendar-google` — Google OAuth + free/busy client (fetch-only)
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
commit secrets. Stored OAuth tokens are encrypted at rest with
`TOKEN_ENCRYPTION_KEY` (AES-256-GCM).

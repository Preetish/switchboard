# Switchboard

Open-source inbound lead routing and instant booking. Qualify a form
submission, route it to the right rep using your CRM data, and book the meeting
in seconds. Self-hostable.

## Status

Task 7 of the roadmap (booking creation: slot hold, Google Calendar event with
a Meet link, BYO-SMTP confirmation email) landed on top of Google availability,
team strategies, hosted forms, the rules engine, the database schema, and the
scaffold. The inline booking UI, CRM write-back, and the routing log UI land in
subsequent PRs.

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
- Rules read submitted values as `form.<key>` paths; `crm.<path>` conditions
  resolve from HubSpot when connected (see "HubSpot CRM" below).

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
  busy owner never drops a lead. The owner comes from the HubSpot lookup (see
  "HubSpot CRM" below); without HubSpot data it behaves like round robin.
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
  slots (UTC ISO times) that the instant-booking UI renders.

## Instant booking

The headline flow lives on the hosted form page (`/f/<slug>`): the moment a
submission is routed to a rep, their calendar renders inline on the same
page — day tabs in the lead's time zone, 30-minute slots, a one-tap confirm.
The lead books before leaving the page; no calendar embed, no email tag.

- Slots are grouped into the **lead's local days** (`groupSlotsByDay` in
  `packages/core`, DST-correct) and labeled in the lead's zone; the rep's zone
  is shown alongside for honesty.
- Confirming calls `POST /api/bookings` with the submission reference, so the
  booking, the routing decision, and the confirmation email all tie back to
  the same lead. A slot that was taken while the lead was choosing returns a
  clear error and the calendar refreshes.
- When routing has no concrete rep (pending owner match, self-serve link,
  fallback queue), the page shows the routed confirmation instead — the flow
  degrades, never lies.
- Failed calendar loads and empty calendars are honest states with a retry,
  not dead ends.

## Bookings

`POST /api/bookings` turns a slot into a confirmed meeting:

```json
{
  "userId": "<rep uuid>",
  "startAt": "2026-10-07T13:00:00Z",
  "durationMinutes": 30,
  "submissionId": "<optional submission uuid>",
  "idempotencyKey": "<optional retry key>"
}
```

- **Double-booking guard**: the slot is claimed atomically by a `hold` booking
  row against the unique index on `user_id + start_at`; a second claim for the
  same slot gets `409 slot_taken`. Before the event is created the slot is
  re-checked against live Google free/busy, so a stale slot list cannot
  double-book either.
- **Slot hold**: the hold row is committed first and confirmed when the
  calendar event exists. If the process dies in between, the slot stays
  reserved and lazy cleanup releases it after ~5 minutes (availability and
  booking requests run the cleanup — no background job).
- **Calendar failure fallback**: every Google call times out after ~2s. If
  event creation fails, the booking is still confirmed locally, the failure is
  logged and surfaced in the response as `calendarError`, and the confirmation
  email carries a plain booking link (`FALLBACK_BOOKING_URL`, optional) instead
  of a Meet link.
- **Confirmation email** (bring-your-own SMTP): sent to the lead from the
  linked submission with the meeting time in the rep's time zone, the Meet
  link, and the rep as contact. Configure `SMTP_URL`
  (`smtps://user:pass@smtp.example.com:465`) and optionally `SMTP_FROM`. Email
  is best-effort: a failure is logged and the booking stands. Without
  `SMTP_URL` no email is attempted.
- **Idempotent**: retries with the same `idempotencyKey` return the original
  booking instead of creating a second one; keyless retries for the same slot
  are deduped by the unique index itself.

## HubSpot CRM

Connecting HubSpot (`/integrations`, same admin-key guard as Google) activates
the CRM-aware half of the routing brief:

- **Owner lookup before routing**: when a rule set reads `crm.*` paths (e.g.
  `when: { crm.contact.owner: exists }`), the submission's email is looked up
  in HubSpot before evaluation. The owner's email lands at
  `crm.contact.owner`, so `route: { to: crm.contact.owner }` sends the lead to
  the matching Switchboard rep, and a `route: { team: …, strategy:
  existing_owner }` route wins with that owner when they are on the team and
  eligible (round robin otherwise).
- **Rep matching is by email**: the rep's Switchboard email must equal their
  HubSpot owner email. An owner without a matching rep degrades to the
  documented fallback, never an error.
- **Contact upsert**: every submission with an email is upserted into HubSpot
  idempotently (per-submission idempotency key), so retries never create
  duplicate CRM records.
- **Logged meeting**: a confirmed booking is logged on the contact's timeline
  as a HubSpot meeting (associated to the contact), with the Meet link when
  Google created one. Idempotent via `bookings.crm_meeting_id` — already
  logged bookings skip the API. Best-effort like the confirmation email: a
  HubSpot failure is logged and the booking stands.
- **Degradation**: lookups and write-backs time out after ~2 seconds and are
  wrapped in an overall budget (~3s) so form submits stay fast. A HubSpot
  outage simply removes the `crm.*` inputs — non-CRM rules still route, and
  the failure is logged.
- **Setup**: self-hosters create their own HubSpot app (scopes
  `crm.objects.contacts.read`, `crm.objects.contacts.write`,
  `crm.objects.owners.read`) with redirect URI
  `<base-url>/api/integrations/hubspot/callback`, then set `HUBSPOT_CLIENT_ID`
  and `HUBSPOT_CLIENT_SECRET`.

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
- `packages/calendar-google` — Google OAuth + free/busy + event creation (fetch-only)
- `packages/crm-hubspot` — HubSpot OAuth + contact/owner/meeting write-back (fetch-only)
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
double-booking guard — plus an idempotency key and `hold`/`confirmed`
statuses), and `integrations` (encrypted OAuth token blobs).

## CI

CI runs lint, typecheck, tests, and the web build on every push to `main` and
every pull request (`.github/workflows/ci.yml`, Node 22).

## Configuration

All configuration is via environment variables; see `.env.example`. Never
commit secrets. Stored OAuth tokens are encrypted at rest with
`TOKEN_ENCRYPTION_KEY` (AES-256-GCM).

# Self-hosting Switchboard

Everything you need to run Switchboard on your own infrastructure: setup,
configuration, your own Google/HubSpot OAuth apps, email, and upgrades.

## Requirements

- **Docker** (recommended) or Node.js 22 with a reachable **Postgres 16**.
- ~512 MB RAM for the app container plus your Postgres.
- Outbound HTTPS for Google/HubSpot/Slack calls (no inbound ports besides the
  app itself).

## Quick start

```bash
docker compose up
```

This starts Postgres 16, applies all migrations, seeds demo data (a form at
`/f/book-a-demo`), and serves the app at **http://localhost:3000**.

Before using it for real leads, finish the [security checklist](#security-checklist)
— the demo ships with known admin credentials and no encryption key.

## Configuration reference

All configuration is via environment variables (compose reads your `.env`
automatically; see `.env.example`).

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | compose default | Postgres connection string (`postgres://user:pass@host:5432/db`) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | yes (real use) | demo values | The single admin login (`/login`) |
| `AUTH_SECRET` | yes (real use) | demo value | JWT session signing secret — `openssl rand -hex 32` |
| `TOKEN_ENCRYPTION_KEY` | for Google/HubSpot | — | AES-256-GCM key for stored OAuth tokens — `openssl rand -hex 32` |
| `APP_BASE_URL` | behind a proxy | `http://localhost:3000` | Public base URL; used to build OAuth redirect URIs |
| `ORG_SLUG` | multi-org DBs | seed org | Which org this instance serves (single-org mode) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | for calendars | — | Your Google OAuth client (see below) |
| `HUBSPOT_CLIENT_ID` / `HUBSPOT_CLIENT_SECRET` | for CRM routing | — | Your HubSpot app (see below) |
| `SMTP_URL` / `SMTP_FROM` | for email | — | Confirmation emails + email alerts (`smtps://user:pass@smtp.example.com:465`) |
| `SLACK_WEBHOOK_URL` | for alerts | — | Incoming webhook for speed-to-lead alerts (preferred over email) |
| `SPEED_TO_LEAD_MINUTES` | no | `5` | Alert a rep when a routed lead hasn't booked after this many minutes |
| `FALLBACK_BOOKING_URL` | no | — | Plain booking link emailed when calendar event creation fails |
| `SEED_DEMO_DATA` | no | `true` (compose) | Set `false` for a clean instance |
| `ADMIN_SETUP_KEY` | no | — | Alternative key auth for scripted CSV exports only |

Everything except `DATABASE_URL` and the admin trio degrades gracefully:
unset integrations show as "not connected", unset email/Slack skip their
notifications with a logged reason.

## Bring your own Google OAuth client

Google requires app verification for calendar scopes on public apps, so
Switchboard does not ship a shared OAuth client — you register your own (free,
takes ~10 minutes) and only your instance uses it.

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and
   create (or pick) a project.
2. **APIs & Services → Library**: enable the **Google Calendar API**.
3. **APIs & Services → OAuth consent screen**:
   - User type **Internal** (Google Workspace) needs no verification. Choose
     **External** otherwise; while your app is in *Testing*, any account you
     list as a test user can consent — enough for a small team.
   - Add the scopes `.../auth/calendar.freebusy` and `.../auth/calendar.events`.
   - Add your own email as a test user while in Testing mode.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type **Web application**.
   - **Authorized redirect URI** (exact):
     `<APP_BASE_URL>/api/integrations/google/callback`
     e.g. `https://switchboard.yourcompany.com/api/integrations/google/callback`.
5. Set the client id/secret:
   ```bash
   GOOGLE_CLIENT_ID=….apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=…
   TOKEN_ENCRYPTION_KEY=$(openssl rand -hex 32)   # tokens are encrypted at rest
   ```
6. Restart, sign in at `/login`, open `/integrations`, and connect Google for
   each rep with their own Google account.

Notes:

- Reps connect **their own** calendars; the free/busy lookup and event
  creation act as the connected rep, not as a service account.
- Publishing the app to *Production* requires Google's verification for the
  calendar scopes. With unverified scopes Google shows a warning screen
  ("unverified app") — advanced users can proceed, but verifying is the
  polished path for wider rollouts.
- If you change `APP_BASE_URL` later, update the redirect URI in Google's
  console to match — a mismatch fails the callback with a clear error.

## HubSpot app setup

1. Sign up for a [HubSpot developer account](https://developers.hubspot.com/)
   and create a public **App** (a private app can't do the user OAuth flow
   Switchboard uses).
2. **Auth** tab: redirect URL `<APP_BASE_URL>/api/integrations/hubspot/callback`.
3. **Scopes**: `crm.objects.contacts.read`, `crm.objects.contacts.write`,
   `crm.objects.owners.read`.
4. Set `HUBSPOT_CLIENT_ID` / `HUBSPOT_CLIENT_SECRET`, restart, connect at
   `/integrations`.

Rep matching is by email: a Switchboard rep routes as an existing owner only
when their Switchboard email equals the HubSpot owner's email.

## Email and Slack

- **SMTP** (`SMTP_URL`, optional `SMTP_FROM`) powers lead confirmation emails
  and the email flavor of speed-to-lead alerts. Any provider's SMTP works
  (Postmark, SES, Mailgun, …). Without `SMTP_URL`, no email is attempted.
- **Slack** (`SLACK_WEBHOOK_URL`) is an
  [incoming webhook](https://api.slack.com/messaging/webhooks) — alerts post
  to the webhook's channel naming the rep. Slack wins when both are set;
  a Slack failure falls back to email.
- Alert timing: `SPEED_TO_LEAD_MINUTES` (default 5). The queue is Postgres
  (pg-boss) — no extra services.

## HTTPS and reverse proxy

Terminate TLS at your proxy (Caddy, nginx, Traefik, your cloud LB) and
forward to the app container. Then set the public URL:

```bash
APP_BASE_URL=https://switchboard.yourcompany.com
```

`APP_BASE_URL` must match what the browser sees — it is baked into both OAuth
redirect URIs. Forward the standard headers (`X-Forwarded-For`,
`X-Forwarded-Proto`); rate limiting keys on the client IP from those headers.

## Database

- Any Postgres 16+ works. Point `DATABASE_URL` at a managed instance (Neon,
  RDS, Supabase) instead of the compose `db` service if you prefer.
- Migrations are committed SQL under `packages/db/migrations` and run
  automatically on container start (`npm run db:migrate`). Applied migrations
  are tracked, so re-running on every boot is a no-op.
- Back up Postgres as usual (`pg_dump`); all product state — forms, rules,
  decisions, bookings, encrypted tokens — lives there.

## Upgrading

```bash
git pull
docker compose build
docker compose up -d
```

Migrations apply on start; seeds are idempotent. Check
`docs/decisions.md` for behavior changes between pulls.

## Security checklist

Before pointing real leads at your instance:

- [ ] Set `ADMIN_EMAIL` + `ADMIN_PASSWORD` (the entrypoint warns while the
      demo password `admin1234` is in effect).
- [ ] Set `AUTH_SECRET` and `TOKEN_ENCRYPTION_KEY` (`openssl rand -hex 32`
      each). Without the encryption key, connecting Google/HubSpot is refused
      rather than storing tokens in plaintext.
- [ ] Set `SEED_DEMO_DATA=false` (or delete the demo org) if you don't want
      the sample form and rule set.
- [ ] Serve over HTTPS and set `APP_BASE_URL` accordingly.
- [ ] Never commit your `.env`.

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| Google connect fails with `redirect_uri_mismatch` | The redirect URI in Google Cloud doesn't exactly match `<APP_BASE_URL>/api/integrations/google/callback` |
| Connecting Google/HubSpot fails with `TOKEN_ENCRYPTION_KEY is not set` | Set `TOKEN_ENCRYPTION_KEY` (64 hex chars) — tokens must be encrypted at rest |
| Reps never receive speed-to-lead alerts | Neither `SLACK_WEBHOOK_URL` nor `SMTP_URL` is set; both are optional and the skip is logged |
| Availability shows no slots | The rep's working hours/timezone on their user record, existing bookings, and (when connected) Google free/busy all narrow the window — check `/routing-log` and the availability API |
| Everything routes to the fallback queue | The form's rule set references fields the form doesn't define, or a team name doesn't exist — the decision row in `/routing-log` records the reason |

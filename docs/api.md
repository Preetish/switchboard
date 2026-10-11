# HTTP API

The hosted form and the embed use these endpoints. They're documented so you
can build your own form front end or automate exports; anything not listed
here is internal and may change.

All bodies are JSON (at most 64 KB). Public endpoints are rate limited per
client address and answer `429` with `Retry-After` when over the limit. They
also answer CORS requests (from any site, or only from `EMBED_ALLOWED_ORIGINS`
when set), so you can [build your own form](custom-form.md) on your site.

## Submit a form

`POST /api/f/{slug}/submit`

```json
{
  "data": { "name": "Priya Shah", "email": "priya@globex.example", "company_size": "1200", "consent": true },
  "idempotencyKey": "a-uuid-per-page-load",
  "attribution": { "utm_source": "google", "utm_medium": "cpc", "gclid": "Cj0…", "first": { "utm_source": "linkedin" } },
  "honeypot": "",
  "captchaToken": "only when Turnstile is on"
}
```

`201` (or `200` with `"duplicate": true` for a retry with the same key):

```json
{
  "submissionId": "9b2c…",
  "decision": { "kind": "route_team", "userId": "4f1e…" },
  "repName": "Alice Chen"
}
```

`attribution` is optional; the embed fills it in. The server keeps only the
known fields (see [embed tracking](embed.md#tracking-and-attribution)), caps
their length, reduces URLs to origin and path, and never rejects a lead over
it.

`decision.kind` is `route_user`, `route_team`, `self_serve_link`, or
`fallback_queue`. When `userId` is set, the lead can book with that rep.
Validation failures return `400` with `{ "errors": { "<field>": "message" } }`
(`_form` for errors not tied to one field).

## Open times for the routed rep

`GET /api/availability/{userId}?submission={submissionId}&duration=30&days=14`

Only answers for the rep that submission was routed to (`404` otherwise).
`duration` is 15 to 240 minutes; `days` is 1 to 42.

```json
{
  "rep": { "name": "Alice Chen", "timeZone": "America/New_York" },
  "durationMinutes": 30,
  "degraded": false,
  "slots": [{ "start": "2026-10-12T13:00:00.000Z", "end": "2026-10-12T13:30:00.000Z" }]
}
```

`degraded: true` means the rep's live calendar couldn't be read and times
reflect Switchboard bookings only.

## Book

`POST /api/bookings`

```json
{
  "submissionId": "9b2c…",
  "userId": "4f1e…",
  "startAt": "2026-10-12T13:00:00.000Z",
  "durationMinutes": 30,
  "idempotencyKey": "optional-retry-key"
}
```

The rep must be the one the submission was routed to, and `startAt` must be
one of their offered slots for that duration. A lead has at most one live
booking; asking again returns it with `"duplicate": true`.

| Status | Meaning |
| --- | --- |
| `201` | Booked: `{ booking, duplicate, calendarFailed, emailQueued, invited }` |
| `200` | The lead already had a booking; it's returned |
| `400` | Not this lead's rep, or not an offered time |
| `404` | Unknown submission or rep |
| `409` | Someone else just took the time; fetch availability again |

## Request data deletion

`POST /api/f/{slug}/delete` with `{ "email": "…" }`

Always `202` with the same message, whether or not the address submitted the
form; if it did, a confirmation link is emailed to it. `503` when email isn't
configured.

## Export the routing log

`GET /api/decisions/export?q={search}`

CSV (RFC 4180, at most 5,000 rows) with columns `decided_at, lead_email,
form, matched_rule, outcome, rep, team, latency_ms, reason, utm_source,
utm_medium, utm_campaign, utm_term, utm_content, click_id, referrer,
landing_page, first_utm_source, first_utm_campaign`. `click_id` is the first
click ID present, prefixed with its type (`gclid:Cj0…`). Requires the
admin session, or for scripts:

```bash
curl -H "Authorization: Bearer $ADMIN_SETUP_KEY" \
  "https://switchboard.yourcompany.com/api/decisions/export" -o routing-log.csv
```

## Health

`GET /api/health` → `200 {"ok":true}`, or `503` when the database is
unreachable. Used by the Docker healthcheck.

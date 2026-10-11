# Building your own form

The embed is the quickest way to put Switchboard on your site, and themes
cover most styling needs. If your design system needs full control over the
markup, build the form yourself and call the [HTTP API](api.md). Your form
does three things: submit, show the routed rep's times, and book.

Switchboard still validates the fields, routes the lead, holds the slot,
creates the calendar event, and writes to your CRM. Your code only draws the
screens.

## 1. Submit

Send the answers with the field keys from your `switchboard.yaml`. Generate
one `idempotencyKey` per page load so a double click can't create two leads.

```js
const idempotencyKey = crypto.randomUUID();

async function submit(data, attribution) {
  const response = await fetch("https://switchboard.yourcompany.com/api/f/book-a-demo/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data, idempotencyKey, attribution }),
  });
  const body = await response.json();
  if (!response.ok) throw body.errors; // { field_key: "message", _form: "message" }
  return body; // { submissionId, decision: { kind, userId }, repName }
}
```

Show each error next to its field. `decision.kind` tells you what to show
next:

| `kind` | Show |
| --- | --- |
| `route_user` / `route_team` with a `userId` | The booking step (below) |
| `self_serve_link` | Your self-serve signup or scheduling page |
| Anything else | A thank-you: "{repName or your team} will be in touch" |

**Attribution.** Pass the lead's UTMs and click IDs as `attribution` so rules
and the routing log can use them. The simplest version reads the current
URL; the [embed loader](embed.md#tracking-and-attribution) shows how to keep
first touch across pages.

```js
const params = new URLSearchParams(location.search);
const attribution = Object.fromEntries(
  ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "gbraid", "wbraid", "fbclid", "msclkid"]
    .filter((key) => params.get(key))
    .map((key) => [key, params.get(key)]),
);
attribution.page_url = location.origin + location.pathname;
```

## 2. Show open times

```js
async function openTimes(userId, submissionId) {
  const query = new URLSearchParams({ submission: submissionId, duration: "30", days: "14" });
  const response = await fetch(`https://switchboard.yourcompany.com/api/availability/${userId}?${query}`);
  return response.json(); // { rep: { name, timeZone }, slots: [{ start, end }], degraded }
}
```

Slots are UTC ISO strings. Group and label them in the visitor's time zone
(`Intl.DateTimeFormat().resolvedOptions().timeZone`).

## 3. Book

```js
const bookingKey = crypto.randomUUID();

async function book(userId, submissionId, startAt) {
  const response = await fetch("https://switchboard.yourcompany.com/api/bookings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId, submissionId, startAt, durationMinutes: 30, idempotencyKey: bookingKey }),
  });
  const body = await response.json();
  if (response.status === 409) return { taken: true }; // reload times and let them pick again
  if (!response.ok) throw new Error(body.error);
  return body; // { booking: { startAt, endAt, meetLink }, invited, emailQueued }
}
```

## Things to keep

- **Cross-origin requests.** The submit, availability, booking, and deletion
  endpoints answer CORS requests from any site, or only from the sites in
  `EMBED_ALLOWED_ORIGINS` when it's set. They don't use cookies, so no
  credentials are involved.
- **Consent field.** If the form has a `consent` field, send `true` only when
  the visitor ticked it.
- **Data deletion.** Offer a way to request deletion, either a link to
  `POST /api/f/<slug>/delete` (see the [API](api.md#request-data-deletion)) or
  your own privacy page.
- **Conversions.** You own the page, so fire your analytics events yourself
  after steps 1 and 3.

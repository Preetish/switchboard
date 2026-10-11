# Embedding a form on your site

The embed puts the whole flow (form, routing, and booking on the rep's
calendar) on any page of your site, so the lead never leaves it.

## Quick start

Copy the snippet from **Setup** in the admin, or paste this and replace the
host and the form's slug:

```html
<div data-switchboard-form="book-a-demo"></div>
<script src="https://switchboard.yourcompany.com/embed.js" data-switchboard-consent="granted" defer></script>
```

The loader (about 4 KB, no dependencies) turns every
`data-switchboard-form` placeholder into the form. Several placeholders on one
page each get their own form.

`data-switchboard-consent="granted"` turns on full attribution: the loader
remembers where a visitor first came from across pages and visits, and reads
your analytics and ad cookie IDs. If your site has to ask visitors before
storing that (for example under GDPR), remove the attribute and let your
consent banner turn it on instead; see
[Tracking and attribution](#tracking-and-attribution).

To capture campaigns from your landing pages, not just the page with the
form, add the script tag (without a placeholder) to every page, for example
in your site's shared layout or through your tag manager.

## Single-page apps, modals, and tag managers

- Placeholders added after the page loads (client-side routing, a modal that
  opens later) are mounted automatically.
- To mount on demand, call `window.Switchboard.mount()`.
- If a tag manager injects the script, add `data-switchboard-embed` to the
  `<script>` tag so the loader can find its own origin:

  ```html
  <script src="https://switchboard.yourcompany.com/embed.js" data-switchboard-embed data-switchboard-consent="granted" defer></script>
  ```

- Set an accessible name for the frame with
  `data-switchboard-title="Book a demo with Acme"` on the placeholder.

## How it works

`embed.js` inserts an iframe of the hosted form page (`/f/<slug>?embed=1`).
All the logic runs there, so the embed can't drift from the hosted form and
your site's CSS can't collide with it. Embed mode drops the page padding and
background so the form sits on your page.

The form reports its height with
`postMessage({ type: "switchboard:resize", height })`. The loader accepts the
message only when it comes from the Switchboard origin **and** from one of
its own iframes, and clamps heights to 200 to 4000 px, so there are no nested
scrollbars.

## Tracking and attribution

The loader runs on your page, so it sees what the iframe can't: your
landing URL, the referrer, and your first-party cookies. When the form
loads, it asks the loader for that data and sends it with the submission.

**What's captured**

| Data | Source | Needs consent |
| --- | --- | --- |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `utm_id` | Page URL | No |
| Click IDs: `gclid`, `gbraid`, `wbraid` (Google), `fbclid` (Meta), `msclkid` (Microsoft), `li_fat_id` (LinkedIn), `ttclid` (TikTok), `twclid` (X) | Page URL | No |
| Referrer and landing page (origin and path only, never the query string) | Browser | No |
| First touch, kept across pages and visits for 90 days | localStorage on your site | Yes |
| Cookie IDs: `_ga`, `_fbp`, `_fbc`, `_gcl_aw`, `hubspotutk` | Your site's cookies | Yes |

The snippets in this guide include `data-switchboard-consent="granted"`, so
everything in the table is captured. Without the attribute, the loader reads
only the current page's URL and referrer and stores nothing; a visitor who
lands on `/pricing?utm_source=google` and then clicks to `/demo` would arrive
with no campaign.

If your site needs consent before storing data or reading cookies, leave the
attribute off and call this from your consent banner once the visitor
accepts analytics or marketing cookies:

```js
window.Switchboard.setConsent(true);
```

Each lead stores a last touch (the visit that converted) and a first touch.
Rules can route on them (`attribution.utm_medium`,
`attribution.first.utm_source`; see [configuration](configuration.md#what-a-rule-can-read)),
the routing log shows the source, and the CSV export has a column for each.
With `hubspot.properties` in `switchboard.yaml`, they're also written to the
HubSpot contact.

Direct links to the hosted form work too:
`https://switchboard.yourcompany.com/f/book-a-demo?utm_source=newsletter`.

**Conversion events on your page**

The iframe can't run your analytics tags, so the form tells the loader when a
lead submits or books, and the loader reports it on your page:

```js
// Pushed to window.dataLayer (Google Tag Manager, GA4):
{ event: "switchboard_submitted", switchboard_form: "book-a-demo", switchboard_outcome: "route_team" }
{ event: "switchboard_booked",    switchboard_form: "book-a-demo", switchboard_outcome: "route_team" }

// And dispatched as DOM events on the placeholder (they bubble to document):
document.addEventListener("switchboard:booked", (event) => {
  fbq("track", "Schedule");            // Meta Pixel
  gtag("event", "conversion", { send_to: "AW-XXXX/YYYY" });  // Google Ads
});
```

In GTM, add a Custom Event trigger on `switchboard_booked` (and
`switchboard_submitted` if you count form fills) and attach your GA4, Google
Ads, or Meta tags to it. The events fire in your page's context, so the ad
platforms match them to the visitor's cookies as usual. `switchboard_outcome`
is `route_user`, `route_team`, `self_serve_link`, or `fallback_queue`; the
events never include the lead's name or email.

## Restricting who can embed

By default any site can frame your forms. Limit it to your own domains with
`EMBED_ALLOWED_ORIGINS` (sent as `Content-Security-Policy: frame-ancestors`):

```bash
EMBED_ALLOWED_ORIGINS="https://yourcompany.com https://www.yourcompany.com"
```

Admin pages can never be framed.

If **your** site sends a Content Security Policy, allow the script and the
frame:

```
script-src https://switchboard.yourcompany.com;
frame-src  https://switchboard.yourcompany.com;
```

## Styling

The form uses Switchboard's design tokens, including dark mode that follows
the visitor's system setting. Control the width by sizing the placeholder;
the form is at most 34rem wide inside it. Styles inside the iframe can't be
changed from your page; that isolation is what keeps your CSS and ours apart.

## Behavior notes

- **Retries are safe.** Double clicks and flaky networks reuse the same
  request key, so a lead is never routed or booked twice.
- **Slot races are handled.** If someone else takes a time while the lead is
  choosing, they see a clear message and the calendar refreshes.
- **Consent and data deletion come with it.** The consent checkbox and the
  "Delete my data" link work the same inside the embed.

## Building the loader

The source is `packages/embed/embed.js`; the served file is the minified
`apps/web/public/embed.js`:

```bash
npm run build -w @switchboard/embed
```

`apps/web/test/embed.test.ts` keeps the artifact under 10 KB and identical to
a fresh build, and runs the loader against a fake DOM to check mounting,
message validation, attribution, consent, and conversion events.
`e2e/attribution.spec.ts` runs the whole journey in a browser.

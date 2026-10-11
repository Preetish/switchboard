# Embedding a form on your site

The embed puts the whole flow (form, routing, and booking on the rep's
calendar) on any page of your site, so the lead never leaves it.

## Quick start

Copy the snippet from **Setup** in the admin, or paste this and replace the
host and the form's slug:

```html
<div data-switchboard-form="book-a-demo"></div>
<script src="https://switchboard.yourcompany.com/embed.js" defer></script>
```

The loader (about 1.5 KB, no dependencies) turns every
`data-switchboard-form` placeholder into the form. Several placeholders on one
page each get their own form.

## Single-page apps, modals, and tag managers

- Placeholders added after the page loads (client-side routing, a modal that
  opens later) are mounted automatically.
- To mount on demand, call `window.Switchboard.mount()`.
- If a tag manager injects the script, add `data-switchboard-embed` to the
  `<script>` tag so the loader can find its own origin:

  ```html
  <script src="https://switchboard.yourcompany.com/embed.js" data-switchboard-embed defer></script>
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
a fresh build, and runs the loader against a fake DOM to check mounting and
message validation.

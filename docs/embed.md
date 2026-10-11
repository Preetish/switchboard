# Embedding Switchboard on your site

The embed puts the whole flow — form, routing, and instant booking — inline on
any page. The lead never leaves your site.

## Quick start

Paste two tags into any page and replace `your-switchboard.example.com` with
your Switchboard deployment and `book-a-demo` with your form's slug:

```html
<div data-switchboard-form="book-a-demo"></div>
<script src="https://your-switchboard.example.com/embed.js" defer></script>
```

That is all. The loader script (about 1 KB minified, vanilla JS, no
dependencies) turns every `data-switchboard-form` placeholder into the hosted
form experience: submit → route → the rep's calendar inline → booked.

## How it works

`embed.js` injects an **iframe** of the hosted form page
(`/f/<slug>?embed=1`). All product logic — field validation, rule evaluation,
the inline calendar, the confirmation, the GDPR delete section — runs in that
hosted page. The embed is a mount point, so:

- it can never drift from the product (no duplicated flow logic),
- it stays tiny (the brief's budget is 10 KB; the loader is ~1 KB),
- your site's CSS and the widget's styles cannot collide.

Embed mode (`?embed=1`) removes the hosted page's own vertical padding and
makes its background transparent, so the widget blends into your page.

## Auto-resize protocol

The hosted page reports its content height with
`postMessage({ type: "switchboard:resize", height })` whenever it changes
(submit, calendar load, booked card). The loader only accepts a message when
**both** its `origin` is your Switchboard deployment and its `source` is the
widget's own iframe `contentWindow`, and clamps heights to 200–4000 px. It
then sets the iframe height, so there are no nested scrollbars.

Options on the placeholder (v0.1): none — one form per placeholder, multiple
placeholders per page are supported, each mounting its own iframe.

## Styling

The widget is styled entirely by the Switchboard design tokens
(`packages/ui/src/tokens.css`), including a dark-mode variant. To adjust how
it looks inside your site:

- Wrap the placeholder to control width — the iframe fills it
  (`max-width: 34rem` inside).
- The card's surface, border, and radius come from the tokens; overriding
  them inside the iframe from the host page is not possible by design
  (style isolation is the point of the iframe).

## Behavior notes

- **Submissions are idempotent per page load**: retries (double click, flaky
  network) reuse the same idempotency key, so no duplicate leads.
- **Slot races are handled**: if someone else books the slot while the lead
  is choosing, the confirm shows a clear error and the calendar refreshes.
- **Consent and data deletion travel with the form**: the hosted page's
  consent checkbox and "Delete your data" section work unchanged inside the
  embed.
- **The loader needs `document.currentScript`** (or a `script[src]` selector)
  to know the deployment origin — load it as a plain `<script src>`, not by
  pasting its contents into a bundle.
- **Same-origin embeds are fine too**: embedding from the Switchboard origin
  itself works and skips cross-origin restrictions entirely.

## Building the loader

The readable source is `packages/embed/embed.js`; the served artifact is the
minified `apps/web/public/embed.js`:

```bash
npm run build -w @switchboard/embed
```

A test (`apps/web/test/embed.test.ts`) keeps the artifact under 10 KB, byte-identical
to a fresh minify of the source, and checks its safety properties (no
`eval`/`innerHTML`/`document.write`, validated postMessage).

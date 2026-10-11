# @switchboard/embed

The embeddable Switchboard widget: a form submission becomes a booked meeting
inline, on any page.

## How it works

`embed.js` is a tiny loader (about 1 KB minified) that finds
`<div data-switchboard-form="<slug>">` elements and injects an **iframe** pointing at
the hosted form page (`/f/<slug>`). The entire submit → route → book flow —
validation, inline calendar, confirmation, the GDPR delete section — runs in the
hosted page, so the embed never duplicates product logic.

Two modes, selected automatically by URL parameters:

- **Full page** (no params): the normal hosted form page.
- **Embed mode** (`?embed=1`): hides the outer page padding and auto-resizes
  the iframe via `postMessage`.

## Embedding

```html
<div data-switchboard-form="book-a-demo"></div>
<script src="https://your-switchboard.example.com/embed.js" defer></script>
```

See `docs/embed.md` for options, styling, and the postMessage protocol.

# Changelog

Notable changes to Switchboard. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- The Docker image no longer reports unhealthy. Docker sets `HOSTNAME` to
  the container ID, so the app listened only on the container's network
  address and the built-in health check on 127.0.0.1 never connected. The
  image now sets `HOSTNAME=0.0.0.0`. The site worked either way; only
  `docker compose ps` and anything watching container health saw the
  difference.

### Added

- The home page has link previews: Open Graph and Twitter card tags with
  a 1200x630 image, so a shared link shows the product instead of a blank
  card. The image URL is built from `APP_BASE_URL`. Hosted form pages keep
  their own titles and carry no Switchboard image.
- The README opens with a short clip of a lead picking a time and booking.

### Changed

- The hero replay's last step, "Meeting booked", now shows its check mark
  when the replay finishes (and in the reduced-motion view), instead of
  staying in the pending state.

- The demo form now uses full country names instead of two-letter codes,
  and the example DACH rule matches on those names.
- The demo form now lists 15 countries (United States, Canada, United
  Kingdom, Germany, Austria, Switzerland, France, Netherlands, Ireland,
  Spain, Italy, Australia, India, Japan, and Other), so visitors can try
  the dropdown's search box.
- Select fields on the lead form (hosted and embedded) are now a custom
  dropdown instead of the native picker, so they look the same on every
  device. Lists with more than 10 options get a search box; shorter
  ones support type-ahead. The dropdown follows the ARIA listbox
  pattern with full keyboard support, and in the embed it opens in
  flow so the iframe grows instead of clipping it. Form fields are
  also taller (at least 44px) and easier to tap.
- The live demo form on the home page no longer sits inside a second
  padded frame: the panel chrome is gone, so the form's own card is
  the only frame and the fields get the full section width, most
  visibly on phones.

- The home page is dark by design in both OS schemes, with Instrument
  Sans display type, a clearer headline and lede, a one-line proof
  strip, and header/footer content aligned to the same column as the
  sections.
- The hero visual is now a staged replay of one lead's trip through
  the board (submitted, rules evaluated, round-robin, booked) using
  the demo rules; the live form moved to its own "Try the board"
  section lower on the page.
- Each How-it-works step now carries a small looping animation in the
  same canvas language: a form qualifying, a round-robin landing, a
  slot being booked.
- New "On your site" section in marketer language (Webflow, Framer,
  WordPress, Contentful; three plain setup steps), and the self-host
  section now leads with ownership instead of a Docker command, with
  the guide one click away on GitHub.
- Copy pass: the "On your site" steps gained titles and small product
  details, the rules section and statement now state facts plainly
  instead of slogans, and the live-form section is headed "Try the
  demo" and says what happens on submit.
- The public form's "Delete my data" control now appears only after a
  submission (on the outcome screens), not on the entry form where a
  lead has nothing to delete yet. The erasure flow is unchanged.
- The instance home page is now a real front door: the live form
  embedded on the page with the standard embed snippet, the routing
  rules shown on a dark band, and a self-host section. Design standard
  updated with the home page's exceptions (docs/design.md).
- The home page drops its navbar "Sign in" link (a public page does not
  need it; the footer link now points at /login).

## [0.1.2] — 2026-10-30

### Fixed

- The published Docker image could not boot: `next.config.ts` made Next
  require TypeScript at server start, but the image prunes devDependencies,
  and pg-boss's telemetry import needs `@opentelemetry/api`, which was only
  a peer dependency and did not survive the prune either. The config is now
  plain JavaScript (`next.config.mjs`) and `@opentelemetry/api` is a direct
  dependency of the web app.
- Form text fields (public form and admin) no longer draw a hard accent
  outline around the whole field on focus: browsers apply `:focus-visible`
  to text inputs even on mouse clicks, so the ring read as a stray border.
  Focus now shows as a soft ring with an accent border.

### Added

- A `self_serve_link` rule can carry a `message`, shown on the self-serve
  page in place of the default text, so a lead who is not routed to a rep
  can be told why (for example, a one-person company).

### Changed

- The demo rule set (`examples/rules.example.yaml`) is tuned so visitors
  actually reach the calendar: a company of one goes self-serve with an
  explanation, and any larger company is routed to a rep (the old
  500-employee threshold first sent most test submissions to self-serve).

## [0.1.1] — 2026-10-29

### Fixed

- Admin sign-in no longer hangs when the server is started with `HOSTNAME`
  unset (the "without Docker" path): the server passed its 0.0.0.0 bind
  address to Next as the app's hostname, and Auth.js's internal sign-in
  request to that address never answered. The bind address is still used
  for listening, but Next now hears "localhost" for a bind-all address.
  Covered by a new browser test that signs in through the login form.
- The consent checkbox's keyboard focus ring now outlines just the
  checkbox instead of the whole consent sentence, and no longer appears
  on mouse clicks.

## [0.1.0] — 2026-10-13

The first public release: qualify a form submission, route it to the right
rep, and book the meeting on that rep's calendar from the same page.

### Added

- Hosted forms (`/f/<slug>`) and a 1.5 KB embed snippet.
- Rules engine: YAML rules over form answers and HubSpot data, first match
  wins, with case-insensitive comparisons and a full routing trace.
- Teams with smooth weighted round robin, weekly capacity, pause switches,
  and an existing-owner strategy.
- Inline booking on the routed rep's own Google Calendar, with Meet links,
  slot holds, and an overlap-proof booking constraint.
- HubSpot: owner-based routing, contact write-back, meeting logging.
- Speed-to-lead alerts to Slack or email.
- Routing log with search and CSV export; Setup and Integrations pages.
- `switchboard.yaml` for reps, teams, forms, and rules, with
  `config:check` / `config:apply`.
- One-command `docker compose up` with generated secrets, a published image
  on GHCR, and a healthcheck.
- Privacy: consent fields, verified self-service data deletion, admin
  erasure.
- Abuse protection: rate limits keyed on the real client address, honeypot,
  disposable-email check, optional Cloudflare Turnstile.
- Attribution: the embed captures UTM parameters, ad click IDs (`gclid`,
  `gbraid`, `wbraid`, `fbclid`, `msclkid`, `li_fat_id`, `ttclid`, `twclid`),
  the referrer, and the landing page from your site. With consent it also
  keeps first touch for 90 days and reads `_ga`, `_fbp`, `_fbc`, `_gcl_aw`,
  and `hubspotutk`. Direct links to `/f/<slug>` keep their UTMs too.
- Rules can route on `attribution.*`; the routing log shows each lead's
  source, the CSV export has attribution columns, and `hubspot.properties`
  writes attribution to HubSpot contacts.
- Themes: `theme` in `switchboard.yaml` (org-wide and per form) sets the
  accent, corner radius, font (with a stylesheet URL), light/dark/auto, a
  borderless `plain` layout, and the background. Embed snippets can override
  them with `data-switchboard-accent`, `-scheme`, `-layout`, `-radius`, and
  `-background`. Button text and accent-colored text stay readable.
- `customCss` in `switchboard.yaml`, with stable `sb-*` class names to target.
- Live, non-submitting previews of each form on the Setup page.
- CORS on the public endpoints and a guide to building your own form on the
  API.
- Conversion events on the host page: `switchboard_submitted` and
  `switchboard_booked` in `window.dataLayer`, plus matching DOM events.

[Unreleased]: https://github.com/Preetish/switchboard/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Preetish/switchboard/releases/tag/v0.1.0

# Changelog

Notable changes to Switchboard. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Attribution: the embed captures UTM parameters, ad click IDs (`gclid`,
  `gbraid`, `wbraid`, `fbclid`, `msclkid`, `li_fat_id`, `ttclid`, `twclid`),
  the referrer, and the landing page from your site. With consent it also
  keeps first touch for 90 days and reads `_ga`, `_fbp`, `_fbc`, `_gcl_aw`,
  and `hubspotutk`. Direct links to `/f/<slug>` keep their UTMs too.
- Rules can route on `attribution.*`; the routing log shows each lead's
  source, the CSV export has attribution columns, and `hubspot.properties`
  writes attribution to HubSpot contacts.
- Conversion events on the host page: `switchboard_submitted` and
  `switchboard_booked` in `window.dataLayer`, plus matching DOM events.

## [0.1.0]

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

[Unreleased]: https://github.com/Preetish/switchboard/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Preetish/switchboard/releases/tag/v0.1.0

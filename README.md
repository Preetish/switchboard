# Switchboard

**Open-source inbound lead routing that ends in a booked meeting.**

A lead fills in your form. Switchboard decides who should talk to them — using
the form answers and your CRM — and shows that rep's real calendar on the same
page, so the meeting is booked before the lead leaves. Self-hosted, configured
in a YAML file you keep in git, no per-seat pricing.

[![CI](https://github.com/Preetish/switchboard/actions/workflows/ci.yml/badge.svg)](https://github.com/Preetish/switchboard/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

<p align="center">
  <img src="docs/images/1-form.png" width="32%" alt="The hosted form">
  <img src="docs/images/2-pick-a-time.png" width="32%" alt="The routed rep's open times, inline">
  <img src="docs/images/3-booked.png" width="32%" alt="Booked confirmation">
</p>

## Try it in two minutes

```bash
git clone https://github.com/Preetish/switchboard && cd switchboard
docker compose up
```

Open **http://localhost:3000/f/book-a-demo**, fill in the form with a company
size over 500, and book a time. Then sign in at **/login** to see the routing
log — the admin password is printed once in the startup logs:

```bash
docker compose logs app | grep "Admin login"
```

The demo loads four fictional reps, three teams, and the rules in
[`examples/rules.example.yaml`](examples/rules.example.yaml).

## How it works

1. **Qualify.** Leads submit a hosted form (`/f/<slug>`) or the same form
   embedded on your site with two lines of HTML.
2. **Route.** Rules run top to bottom against the answers and, when HubSpot
   is connected, CRM data. The first match wins: send existing customers to
   their owner, big companies to the enterprise team, personal emails to
   self-serve, and so on. Teams rotate by weight with weekly caps and
   pause switches.
3. **Book.** The chosen rep's free time — from their own Google Calendar —
   appears inline. One click creates the event with a Meet link, logs the
   meeting in HubSpot, and emails a confirmation. If nobody books within a
   few minutes, the rep gets a speed-to-lead alert in Slack or email.

Every decision is recorded — inputs, matched rule, outcome, latency — in a
searchable routing log with CSV export.

<p align="center">
  <img src="docs/images/4-routing-log.png" width="90%" alt="The routing log">
</p>

## Set it up for your team

Everything lives in one file, reviewed like code:

```yaml
# config/switchboard.yaml
org: { name: Acme, slug: acme }

reps:
  - { email: ana@acme.com, name: Ana Lopez, timezone: America/New_York }
  - { email: ben@acme.com, name: Ben Ito, timezone: America/Los_Angeles }

teams:
  - key: sales
    members: [{ rep: ana@acme.com, weight: 2 }, ben@acme.com]

forms:
  - slug: book-a-demo
    name: Book a demo
    fields:
      - { key: name, label: Full name, type: text, required: true }
      - { key: email, label: Work email, type: email, required: true }
      - { key: company_size, label: Company size, type: number, required: true }
    rules:
      rules:
        - name: Personal email goes self-serve
          when: { form.email: { freeEmail: true } }
          route: { action: self_serve_link }
      fallback: { team: sales, strategy: round_robin }
```

```bash
cp switchboard.example.yaml config/switchboard.yaml   # then edit it
npm run config:check -- config/switchboard.yaml       # validate (great in CI)
docker compose up -d                                   # applied on every start
```

Mistakes are caught before they reach a lead, with the exact place to fix:
`forms[0] (book-a-demo) rules rules[1] (DACH): team "dach" is not defined in teams`.

Then connect calendars and CRM at **/integrations**: each rep connects their
own Google Calendar through a link you send them, and HubSpot connects once
for the org.

## Documentation

| Guide | What's in it |
| --- | --- |
| [Configuration](docs/configuration.md) | `switchboard.yaml`, rule operators, routing strategies |
| [Self-hosting](docs/self-hosting.md) | Deploying, environment variables, Google/HubSpot apps, HTTPS, upgrades |
| [Embedding](docs/embed.md) | Putting the form on your site |
| [HTTP API](docs/api.md) | The public and admin endpoints |
| [Architecture](docs/architecture.md) | How the pieces fit, and how to add a calendar or CRM |
| [Design decisions](docs/decisions.md) | Why things are the way they are |

## Status and limits

Switchboard is at **v0.1**: the full loop works and is covered by unit,
Postgres integration, and browser tests, but it is young software. Today it
supports:

- **Calendars:** Google Calendar (per rep). Outlook is not supported yet.
- **CRM:** HubSpot. Salesforce is not supported yet.
- **One org per instance**, one admin login, English-only lead pages.
- **30-minute meetings** on the inline booking step.
- **Rate limits are per instance** (in memory); run one instance or put a
  shared limiter in front if you scale out.

See the [changelog](CHANGELOG.md) for what changed between releases.

## Contributing

Bug reports, ideas, and pull requests are welcome — start with
[CONTRIBUTING.md](CONTRIBUTING.md). Please report security issues privately
as described in [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE)

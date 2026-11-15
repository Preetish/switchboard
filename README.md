# Switchboard

**Route each inbound lead to the right rep, then let the lead book that rep's
calendar on the same page.**

Switchboard is an open-source, self-hosted alternative to inbound routing
tools like Chili Piper. A lead fills in your demo form. Your rules pick the rep
using the form answers and HubSpot. As soon as the lead submits, the form
turns into that rep's open times from their Google Calendar, and the lead
books without leaving the page. You set up reps, teams, forms, and rules on
the Setup page in the app, and you can download the whole setup as a YAML
file to keep in git. You pay nothing per seat.

[![CI](https://github.com/Preetish/switchboard/actions/workflows/ci.yml/badge.svg)](https://github.com/Preetish/switchboard/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

**Live demo: [switchboard.preetish.me](https://switchboard.preetish.me)** — the demo workspace from the quick start below, running the latest release.

<p align="center">
  <img src="docs/images/booking.gif" width="640" alt="After the lead submits, the form shows Alice Chen's open times; the lead picks 9:00 AM, books, and sees the confirmation">
</p>

<p align="center">
  <img src="docs/images/1-form.png" width="32%" alt="The hosted form">
  <img src="docs/images/2-pick-a-time.png" width="32%" alt="The routed rep's open times, shown inline">
  <img src="docs/images/3-booked.png" width="32%" alt="Booked confirmation">
</p>

## Try it locally

```bash
git clone https://github.com/Preetish/switchboard && cd switchboard
docker compose up
```

Open http://localhost:3000/f/book-a-demo, enter a company size over 1, and
book a time (a size of 1 shows the self-serve message instead). To see the
decision in the routing log, sign in at
http://localhost:3000/login. Docker prints the admin password once when it
first starts:

```bash
docker compose logs app | grep "Admin login"
```

The demo comes with four fictional reps, three teams, and the rules in
[`examples/rules.example.yaml`](examples/rules.example.yaml).

## What happens when a lead submits

1. The lead fills in a hosted form at `/f/<slug>`, or the same form embedded
   on your site with two lines of HTML.
2. Your rules run in order against the answers and, if you connect HubSpot,
   the lead's CRM record. The first match decides. The demo rules send
   existing customers to their account owner, one-person companies to
   self-serve with a short explanation, companies in Germany, Austria, or
   Switzerland to the DACH team, and every larger company to the enterprise
   team. Within a team, reps take turns by weight, and you can cap a rep's
   meetings per week or pause them while they're away.
3. The lead sees open times from that rep's own Google Calendar and books
   one. Switchboard creates the event with a Google Meet link, logs the
   meeting in HubSpot, and emails the lead a confirmation. If the lead leaves
   without booking, the rep gets a Slack or email alert a few minutes later.

The routing log records every decision: what the lead entered, where they
came from (UTMs and ad click IDs such as `gclid` and `fbclid`), which rule
matched, who got the lead, and how long routing took. You can search it and
export it as CSV. When a lead submits or books inside the embed, your page
gets `switchboard_submitted` and `switchboard_booked` events in the GTM
`dataLayer`, so your GA4, Google Ads, and Meta tags count the conversion.

<p align="center">
  <img src="docs/images/4-routing-log.png" width="90%" alt="The routing log">
</p>

## Set it up for your team

You set Switchboard up on the **Setup** page in the app. Sign in, then:

1. Open `/integrations` and connect HubSpot once for the whole org.
2. Open **Setup**. Start from a template (B2B SaaS demo, Territory split,
   Paid campaign fast lane, or Blank) or from the setup you already have.
3. Add reps by picking them from your HubSpot owners (or type an email), set
   their working hours, and put them in teams with weights, weekly caps, and
   pauses.
4. Edit each form's fields and theme in the form builder: accent color,
   background, corner radius, light or dark, layout, and font. A switch sets
   the routed rep as the lead's HubSpot contact owner.
5. Write the rules as sentences, such as "When Country is any of Germany,
   Austria, Switzerland then route to team DACH, take turns", and drag them
   into order. The last row catches every lead no rule matches.
6. Try a test lead in the simulator beside the rules. It shows where the lead
   goes and which rules it tried, without saving anything.
7. Select **Save changes**, read the review of what changes (in words and as
   a YAML diff), then select **Apply changes**. **Roll back last save** undoes
   the last save.
8. Back on `/integrations`, send each rep a link to connect their own Google
   Calendar.

<p align="center">
  <img src="docs/images/5-setup.png" width="90%" alt="The Setup page: rules written as sentences, with the simulator beside them">
</p>

Switchboard checks the whole setup before it saves anything, and tells you
where a problem is. The Setup page also shows each form's link, embed code,
and a live preview of the saved form; see
[Matching your site](docs/embed.md#matching-your-site).

The Setup page editors appear once the instance has a form. With Docker, the
demo gives you one to start from. The container loads the demo again on every
start while `SEED_DEMO_DATA` is `true` (the compose default) and there is no
`config/switchboard.yaml`, which replaces your Setup page changes. Set
`SEED_DEMO_DATA=false` in `.env` once you start editing.

### Keep the config in git instead

Underneath, the setup is one `switchboard.yaml` file, and **Download YAML** on
the Setup page exports it at any time. If you would rather review changes like
code, keep that file in git and apply it:

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
npm run config:check -- config/switchboard.yaml       # validate it (works in CI)
docker compose up -d                                   # applies it on every start
```

If you make a mistake, Switchboard tells you where it is before any lead hits
it, for example:
`forms[0] (book-a-demo) rules rules[1] (DACH): team "dach" is not defined in teams`.

Applying the file replaces changes made on the Setup page, so if you use both,
download the YAML after each save on the Setup page and commit it.

## Documentation

| Guide | Covers |
| --- | --- |
| [Configuration](docs/configuration.md) | The Setup page, `switchboard.yaml`, rule operators, how reps are picked |
| [Self-hosting](docs/self-hosting.md) | Deploying, environment variables, Google and HubSpot apps, HTTPS, upgrades |
| [Embedding](docs/embed.md) | Putting the form on your site, matching your brand, tracking campaigns |
| [Building your own form](docs/custom-form.md) | Using the API with your own markup |
| [HTTP API](docs/api.md) | The public and admin endpoints |
| [Architecture](docs/architecture.md) | How the code fits together, and how to add a calendar or CRM |
| [Design decisions](docs/decisions.md) | Why it works the way it does |

## Status and limits

This is v0.2. The full flow works, and unit, Postgres, and browser tests cover
it in CI, but the project is new. Today Switchboard supports Google Calendar
(Outlook isn't supported yet) and HubSpot (Salesforce isn't either). Each
instance serves one company with one admin login, and lead pages are in
English. The inline booking step offers 30-minute meetings. Rate limits live
in memory, so they apply per instance; if you run several, put a shared
limiter in front.

The [roadmap issue](https://github.com/Preetish/switchboard/issues/56) tracks
what's missing and what's next; comment there with what you need. The
[changelog](CHANGELOG.md) lists what changes in each release.

## Contributing

Bug reports, ideas, and pull requests are welcome. Start with
[CONTRIBUTING.md](CONTRIBUTING.md), and ask questions in
[Discussions](https://github.com/Preetish/switchboard/discussions). Please
report security issues privately as described in [SECURITY.md](SECURITY.md).

If Switchboard is useful to you, a star helps other people find it.

## License

[Apache-2.0](LICENSE)

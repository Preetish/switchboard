# Configuration: `switchboard.yaml`

Your reps, teams, forms, and routing rules live in one YAML file. Start from
[`switchboard.example.yaml`](../switchboard.example.yaml); the demo setup is
[`examples/switchboard.demo.yaml`](../examples/switchboard.demo.yaml).

```bash
npm run config:check -- config/switchboard.yaml   # validate only, no database
npm run config:apply -- config/switchboard.yaml   # validate, then write to DATABASE_URL
```

With Docker, put the file at `./config/switchboard.yaml`; it is applied on
every container start. If it doesn't validate, the container stops and prints
every problem with its location.

**How applying works.** Switchboard writes everything in one transaction, so
either all of it lands or none of it does.

| Section | Matched by | When removed from the file |
| --- | --- | --- |
| `reps` | email (case-insensitive) | Kept (bookings and history stay); reported as "not in config" |
| `teams` | `key` | Deleted, with their memberships |
| team `members` | rep email | Removed from the team (rotation position resets) |
| `forms` | `slug` | Kept (they hold lead data); reported |
| `rules` | content | Identical rules reuse their version; changed rules get a new one |

## `org`

```yaml
org:
  name: Acme Inc        # shown on forms and in emails
  slug: acme            # lowercase, digits, dashes
```

One instance serves one org. If a database ever holds several, `ORG_SLUG`
selects which one the app uses.

## `theme` (optional)

How every form looks; a form can override any of it with its own `theme`.
See [Matching your site](embed.md#matching-your-site) for examples and the
embed-snippet overrides.

| Setting | Values | Default |
| --- | --- | --- |
| `accent` | Hex color, `#RGB` or `#RRGGBB` | Switchboard orange |
| `radius` | Whole pixels, 0 to 24 | 8 |
| `font.family` | CSS font list, e.g. `"Inter, system-ui, sans-serif"` | System fonts |
| `font.stylesheet` | https URL of a stylesheet that loads the font | None |
| `colorScheme` | `light`, `dark`, `auto` (follow the visitor) | `auto` |
| `layout` | `card` (bordered panel), `plain` (fields only, full width) | `card` |
| `background` | `transparent` or a hex color, behind the form | Page background (hosted), transparent (embed) |

`customCss` (top level and per form) adds CSS after the theme; see
[custom CSS](embed.md#custom-css) for the class names it can target and what
isn't allowed.

## `hubspot` (optional)

Write a lead's attribution onto their HubSpot contact. Map each field to a
contact property; the properties must already exist in your portal (create
them under Settings → Properties), or HubSpot rejects the update.

```yaml
hubspot:
  properties:
    utm_source: utm_source
    utm_medium: utm_medium
    utm_campaign: utm_campaign
    gclid: google_click_id
    first.utm_source: first_touch_source
    cookies.ga: ga_client_id
```

Fields are the attribution names from [rules](#what-a-rule-can-read) without
the `attribution.` prefix, plus `cookies.<id>` for the consented cookie IDs.

## `reps`

```yaml
reps:
  - email: ana@acme.com          # must match their Google account and HubSpot owner
    name: Ana Lopez
    timezone: America/New_York   # IANA zone; default UTC
    workingHours:                # optional; default Mon to Fri, 09:00 to 17:00
      days: [mon, tue, wed, thu, fri]
      hours: "09:00-17:00"       # 24-hour, in the rep's time zone
```

Overnight shifts aren't supported (the end must be after the start).

## `teams`

```yaml
teams:
  - key: enterprise          # what rules refer to: route: { team: enterprise }
    name: Enterprise         # optional display name
    members:
      - ana@acme.com                       # shorthand: weight 1, no cap, active
      - rep: ben@acme.com
        weight: 2                          # share of leads (2 = twice as many)
        weeklyCapacity: 15                 # max bookings per week; 0 = no cap
        active: false                      # paused (vacation, offboarding)
```

**How round robin picks.** Smooth weighted round robin: each eligible rep
earns their weight in credit per lead, the rep with the most credit gets the
lead and pays back the team's total weight. Weights are exact (2:1 means
exactly two of every three) and interleaved (a, b, a, a, b, a), new members
get their fair share right away, and concurrent submissions take turns because
Switchboard locks the rotation per team. Switchboard skips a rep who is paused
or at weekly capacity. If nobody on the team is eligible, the lead goes to the
fallback queue instead of being dropped.

## `forms`

```yaml
forms:
  - slug: book-a-demo                      # public URL: /f/book-a-demo
    name: Book a demo                      # heading on the form
    submitLabel: Request a demo            # optional; default "Continue"
    selfServeUrl: https://acme.com/signup  # where self-serve leads go
    theme: { accent: "#E4002B" }           # optional; overrides the top-level theme
    customCss: ".sb-title { font-weight: 600 }"  # optional
    fields: [...]
    rules: rules/book-a-demo.yaml          # a file (relative to this one) or inline
```

### Fields

```yaml
fields:
  - { key: name, label: Full name, type: text, required: true }
  - { key: email, label: Work email, type: email, required: true }
  - { key: company_size, label: Company size, type: number, required: true, helpText: Number of employees. }
  - { key: country, label: Country, type: select, required: true, options: [United States, Canada, Germany] }
  - { key: message, label: Anything we should know?, type: textarea, required: false }
  - key: consent
    label: I agree that my details are stored to process this request.
    type: consent      # a required checkbox (GDPR/CASL)
    required: true
```

Types: `text` (≤1,000 characters), `textarea` (≤5,000), `email` (≤254),
`number`, `select` (needs `options`), `consent` (must be `required: true`).
Keys are letters, digits, and underscores, starting with a letter. The first
`email` field is the lead's address for CRM lookups, confirmations, and
deletion requests. Disposable addresses are rejected.

## Rules

```yaml
rules:
  - name: Existing owner wins
    when: { crm.contact.owner: exists }
    route: { to: crm.contact.owner }

  - name: Enterprise
    when: { form.company_size: { gte: 500 } }
    route: { team: enterprise, strategy: round_robin }

  - name: Personal email goes self-serve
    when: { form.email: { freeEmail: true } }
    route: { action: self_serve_link }

fallback: { team: default, strategy: round_robin }
```

Rules run top to bottom and **the first match wins**; if none match,
`fallback` applies. Every condition in a rule's `when` must hold.

### What a rule can read

| Path | Value |
| --- | --- |
| `form.<field key>` | The submitted answer (trimmed; emails lowercased) |
| `form.email_domain` | Derived from the form's email field, e.g. `gmail.com` |
| `crm.contact.owner` | The HubSpot owner's email for this lead's contact (needs HubSpot) |
| `crm.contact.id` | The HubSpot contact id |
| `attribution.utm_source` … `attribution.utm_id` | Last-touch campaign parameters ([embed tracking](embed.md#tracking-and-attribution)) |
| `attribution.gclid`, `.gbraid`, `.wbraid`, `.fbclid`, `.msclkid`, `.li_fat_id`, `.ttclid`, `.twclid` | Ad click IDs |
| `attribution.referrer`, `attribution.landing_page`, `attribution.page_url` | Where the visit came from and where the form was |
| `attribution.first.<field>` | The same fields for the first touch (needs consent on your site) |

Paths are checked when the file is applied: `form.*` must be a field of that
form (or a derived key), and `attribution.*` must be one of the fields above. A typo like `from.country` fails validation instead of
becoming a rule that never matches.

### Operators

| Operator | Matches when the value… | Example |
| --- | --- | --- |
| *(bare value)* | equals it | `form.country: Germany` |
| `exists` | is present (`exists: false`: is missing) | `crm.contact.owner: exists` |
| `eq` / `neq` | equals / doesn't equal | `{ neq: Other }` |
| `in` / `nin` | is / isn't one of a list | `{ in: [Germany, Austria, Switzerland] }` |
| `gt` `gte` `lt` `lte` | compares numerically (`"500"` counts as 500) | `{ gte: 500 }` |
| `contains` | contains the text | `{ contains: demo }` |
| `matches` | matches a regular expression (case-sensitive) | `{ matches: "^\\+49" }` |
| `freeEmail` | is (or isn't) a free/personal email provider | `{ freeEmail: true }` |
| `workEmail` | is a non-free email address | `{ workEmail: true }` |

Text comparisons (`eq`, `in`, `contains`, …) **ignore case**. A condition on a
missing value fails (including `neq`/`nin`); only `exists` reasons about
absence. Several operators in one condition must all hold:
`{ gte: 50, lt: 500 }`.

### Routes

| Route | Effect |
| --- | --- |
| `{ team: <key>, strategy: round_robin }` | Weighted rotation within the team |
| `{ team: <key>, strategy: existing_owner }` | The lead's CRM owner if they're on the team and available; otherwise round robin |
| `{ to: <rep email> }` | That rep |
| `{ to: crm.contact.owner }` | The rep whose email matches the CRM owner; no owner → fallback queue |
| `{ action: self_serve_link }` | The lead sees a button to `selfServeUrl` |
| `{ action: fallback_queue }` | Recorded for follow-up; no rep chosen |

The validator also rejects rules that can never run (anything after a rule
with an empty `when`), empty `in` lists, `exists: false` mixed with value
operators, and a `fallback` that routes to a `form.`/`crm.` path (which may be
empty).

For example, send paid search to the team that calls back fastest:

```yaml
- name: Paid search
  when: { attribution.utm_medium: { in: [cpc, ppc, paid] } }
  route: { team: inbound-fast, strategy: round_robin }
```

### Testing rule changes

The example rule files are run against realistic leads in the test suite
([`packages/core/test/rule-inputs.test.ts`](../packages/core/test/rule-inputs.test.ts));
copying that pattern for your own rules is the quickest way to know a change
does what you expect. In CI, `npm run config:check -- path/to/switchboard.yaml`
validates the file without a database.

# Contributing to Switchboard

Thanks for helping! Bug reports, docs fixes, and pull requests are all
welcome. For anything bigger than a small fix, please open an issue first so
we can agree on the approach before you spend time on it.

## Development setup

You need Node.js 22 and Postgres 16+ (Docker is the easiest way).

```bash
npm install
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db   # Postgres on localhost
cp .env.example .env                 # set ADMIN_PASSWORD and AUTH_SECRET
npm run db:migrate
npm run demo:load                    # demo reps, teams, and /f/book-a-demo
npm run dev                          # http://localhost:3000
```

## Checks

| Command | What it runs |
| --- | --- |
| `npm run lint` / `npm run typecheck` | ESLint, TypeScript |
| `npm test` | Unit tests |
| `TEST_DATABASE_URL=postgres://…/switchboard_test npm run test:db` | Postgres integration tests (wipes that database) |
| `npm run build && npm run test:e2e` | Browser tests against a production build (needs the demo loaded) |
| `npm run config:check -- path/to/switchboard.yaml` | Validate a config file |

CI runs all of these on every pull request.

## Guidelines

- **Keep `packages/core` pure.** Rules, validation, slot math, and rotation
  are plain functions with no I/O; database and network code lives in
  `apps/web/src/lib` and the provider packages. See
  [docs/architecture.md](docs/architecture.md).
- **Schema changes** go in `packages/db/src/schema.ts`; run
  `npm run db:generate`, give the migration a descriptive name, and commit
  the SQL. Constraints Drizzle can't express are appended to the generated
  file.
- **UI** follows [docs/design.md](docs/design.md): tokens only, keyboard
  paths, both themes, honest loading and error states. Lead-facing changes
  come with a Playwright test.
- **Copy** is written for the person reading it: plain sentences, verbs on
  buttons, errors that say what to do next.
- **Tests** for behavior changes; for anything involving constraints,
  transactions, or concurrency, an integration test against Postgres.
- **Decisions** worth explaining go in [docs/decisions.md](docs/decisions.md).
- Note user-facing changes under "Unreleased" in [CHANGELOG.md](CHANGELOG.md).

## Adding a calendar or CRM

Outlook and Salesforce support would be very welcome. The steps are in
[docs/architecture.md](docs/architecture.md#adding-a-calendar-or-crm-provider);
open an issue to coordinate before starting.

## License

By contributing, you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE).

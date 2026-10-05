# Switchboard

Open-source inbound lead routing and instant booking. Qualify a form
submission, route it to the right rep using your CRM data, and book the meeting
in seconds. Self-hostable.

## Status

Early scaffold (task 1 of the roadmap). The rules engine, calendar, CRM, and
booking UI land in subsequent PRs.

## Quick start

```bash
npm install
docker compose up -d   # Postgres 16 for later tasks
cp .env.example .env
npm run dev            # web app on http://localhost:3000
```

## Scripts

| Script             | What it does                          |
| ------------------ | ------------------------------------- |
| `npm run dev`      | Next.js dev server (`apps/web`)       |
| `npm run build`    | Production build                      |
| `npm run lint`     | ESLint across all workspaces          |
| `npm run typecheck`| TypeScript across all workspaces      |
| `npm test`         | Vitest across all workspaces          |
| `npm run format`   | Prettier                              |

## Layout

- `apps/web` — Next.js app (forms, booking UI, admin)
- `packages/core` — rules engine, pure functions
- `packages/ui` — design tokens (see `docs/design.md`)
- `docs/decisions.md` — architectural decision log

## CI

CI runs lint, typecheck, tests, and the web build. The workflow file is
inlined in `docs/decisions.md` because of a GitHub App permission limitation —
move it to `.github/workflows/ci.yml` when the permission is available.

## Configuration

All configuration is via environment variables; see `.env.example`. Never
commit secrets. Stored OAuth tokens will be encrypted at rest.

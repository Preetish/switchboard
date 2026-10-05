# Architectural decisions

Short-lived log of architectural choices. Newest at the bottom.

## 2026-10-05 — Stack

- **npm workspaces TypeScript monorepo** (`apps/web`, `packages/core`, `packages/ui`): matches the suggested stack; core stays pure-function and testable.
- **Postgres 16 via docker-compose, no Redis**: queue will be pg-boss on the same database (rule 3 — no extra services without justification).
- **Vitest**: fast, ESM-native, no separate test runner.
- **ESLint 9 flat config + typescript-eslint + Prettier**: repo-wide lint in one config.
- **Node 22 engines**: LTS with stable ESM support.
- **plain-CSS tokens in `packages/ui`** instead of Tailwind for now: the design standard needs a token source first; Tailwind v4 can layer on tokens later if a task needs component styling at speed.
- **License: UNLICENSED for now** — must be decided before the first public commit (see chat notes). TODO: pick MIT/Apache-2.0/AGPL.

## 2026-10-05 — CI without a committed workflow file

The Buildful GitHub App lacks the `workflows` permission, so GitHub rejects any
push containing files under `.github/workflows/`. To keep pushes green, the CI
definition lives here instead. Once the app gains the permission (or a
human committers adds it), move this to `.github/workflows/ci.yml` verbatim:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build --workspace @switchboard/web
```

Equivalents of these steps run locally and pass; see the PR description for
the current run.

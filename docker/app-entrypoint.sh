#!/bin/sh
# Container entrypoint: migrate, optionally seed demo data, then serve.
# The db service is already healthy (compose `depends_on` condition), so
# migrations run against a ready Postgres on every start — idempotent.
set -e

echo "[switchboard] applying database migrations..."
npm run db:migrate

if [ "${SEED_DEMO_DATA:-true}" = "true" ]; then
  echo "[switchboard] seeding demo data (SEED_DEMO_DATA=true; set false to skip)..."
  node packages/db/scripts/seed.mjs
fi

if [ "$ADMIN_PASSWORD" = "admin1234" ]; then
  echo "[switchboard] WARNING: ADMIN_PASSWORD is the demo default — set a real password in .env before real use."
fi

echo "[switchboard] starting web app on port ${PORT:-3000}..."
exec npm run start --workspace @switchboard/web

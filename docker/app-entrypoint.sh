#!/bin/sh
# Container entrypoint: fill in any missing secrets, migrate, optionally load
# demo data, then serve. The db service is already healthy (compose
# `depends_on` condition), so migrations run against a ready Postgres on
# every start — idempotent.
set -e

DATA_DIR="${SWITCHBOARD_DATA_DIR:-/var/lib/switchboard}"
mkdir -p "$DATA_DIR"

# Secrets you don't set are generated once and kept in the data volume, so a
# fresh `docker compose up` never runs with a published default. Set your own
# in .env to manage them yourself.
secret() {
  name="$1"
  file="$DATA_DIR/$name"
  if [ ! -s "$file" ]; then
    (umask 077 && head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$file")
    echo "[switchboard] generated $name (stored in $file)"
  fi
  cat "$file"
}

if [ -z "$AUTH_SECRET" ]; then
  AUTH_SECRET="$(secret auth_secret)"
  export AUTH_SECRET
fi
if [ -z "$TOKEN_ENCRYPTION_KEY" ]; then
  TOKEN_ENCRYPTION_KEY="$(secret token_encryption_key)"
  export TOKEN_ENCRYPTION_KEY
fi
if [ -z "$ADMIN_PASSWORD" ]; then
  first_run=""
  [ -s "$DATA_DIR/admin_password" ] || first_run="yes"
  ADMIN_PASSWORD="$(secret admin_password)"
  export ADMIN_PASSWORD
  if [ -n "$first_run" ]; then
    echo "[switchboard] ------------------------------------------------------------"
    echo "[switchboard] Admin login: ${ADMIN_EMAIL:-admin@example.com} / $ADMIN_PASSWORD"
    echo "[switchboard] Shown once. Later: docker compose exec app cat $DATA_DIR/admin_password"
    echo "[switchboard] ------------------------------------------------------------"
  fi
fi
export ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"

echo "[switchboard] applying database migrations..."
npm run --silent db:migrate

if [ "${SEED_DEMO_DATA:-false}" = "true" ]; then
  echo "[switchboard] loading demo data (SEED_DEMO_DATA=true)..."
  node packages/db/scripts/seed.mjs
fi

echo "[switchboard] starting web app on port ${PORT:-3000}..."
exec npm run start --workspace @switchboard/web

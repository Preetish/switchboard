# Switchboard app image — one `docker compose up` runs Postgres, migrations,
# the demo seed, and this web app (see docker-compose.yml).
FROM node:22-alpine

WORKDIR /app

# Install dependencies first so source edits don't bust this layer.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/ui/package.json packages/ui/
COPY packages/calendar-google/package.json packages/calendar-google/
COPY packages/crm-hubspot/package.json packages/crm-hubspot/
COPY packages/embed/package.json packages/embed/
RUN npm ci

# Build the web app (workspace packages ship TypeScript source and are
# compiled by Next via transpilePackages — no per-package build step).
COPY . .
RUN npm run build --workspace @switchboard/web

EXPOSE 3000
ENTRYPOINT ["sh", "docker/app-entrypoint.sh"]

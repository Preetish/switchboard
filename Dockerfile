# Switchboard app image — `docker compose up` runs Postgres, migrations,
# your config, and this web app (see docker-compose.yml).

# ---- build: full dependencies, compile the Next.js app ----
FROM node:22-alpine AS build
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

# Workspace packages ship TypeScript source and are compiled by Next via
# transpilePackages — no per-package build step.
COPY . .
RUN npm run build --workspace @switchboard/web \
  && npm prune --omit=dev \
  && npm cache clean --force

# ---- runtime: production dependencies only, non-root ----
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    SWITCHBOARD_DATA_DIR=/var/lib/switchboard
WORKDIR /app

COPY --from=build --chown=node:node /app /app
RUN mkdir -p "$SWITCHBOARD_DATA_DIR" && chown node:node "$SWITCHBOARD_DATA_DIR"

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1
ENTRYPOINT ["sh", "docker/app-entrypoint.sh"]

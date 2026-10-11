/**
 * Apply the committed SQL migrations in packages/db/migrations. Uses
 * drizzle-orm's runtime migrator (same bookkeeping table as `drizzle-kit
 * migrate`), so production images don't need drizzle-kit. Re-running is a
 * no-op once everything is applied.
 *
 *   npm run db:migrate
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

// The repo-root .env, when present (real environment variables win).
const rootEnv = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const client = new pg.Client({ connectionString });
await client.connect();
try {
  await migrate(drizzle(client), {
    migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)),
  });
  console.log("[switchboard] database migrations are up to date.");
} finally {
  await client.end();
}

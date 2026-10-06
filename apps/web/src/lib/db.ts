import { createDb, type Database } from "@switchboard/db";

const globalForDb = globalThis as unknown as { sbDb?: Database };

/** Per-process Drizzle instance over `DATABASE_URL` (survives dev HMR). */
export function getDb(): Database {
  if (!globalForDb.sbDb) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set — copy .env.example to .env first.");
    }
    globalForDb.sbDb = createDb(url);
  }
  return globalForDb.sbDb;
}

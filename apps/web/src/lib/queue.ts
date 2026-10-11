import { PgBoss } from "pg-boss";
import { log } from "./log";

/**
 * Postgres-backed job queue (pg-boss) for work that should not hold up a
 * lead's request and should be retried when a provider is down: delayed
 * speed-to-lead alerts, CRM write-backs, and booking follow-ups (email and
 * the CRM meeting log). No Redis — pg-boss keeps its own `pgboss` schema in
 * the app's database. The worker runs in-process (jobs-worker.ts).
 *
 * If the queue can't start, immediate jobs run inline instead and delayed
 * ones are skipped with a logged reason; a transient start failure retries
 * on the next use.
 */

export const JOBS = {
  speedToLead: "speed-to-lead-alert",
  crmContact: "crm-upsert-contact",
  bookingFollowup: "booking-followup",
} as const;

export type JobName = (typeof JOBS)[keyof typeof JOBS];

/** Retries with exponential backoff: ~30s, 1m, 2m, 4m, 8m. */
const RETRY = { retryLimit: 5, retryDelay: 30, retryBackoff: true } as const;

let boss: PgBoss | null = null;
let starting: Promise<PgBoss | null> | null = null;
/** Config-level disable (no DATABASE_URL): deterministic, not worth retrying. */
let disabled = false;

export async function getQueue(): Promise<PgBoss | null> {
  if (disabled) return null;
  if (boss) return boss;
  starting ??= startBoss();
  const result = await starting;
  if (!boss && !disabled) starting = null; // transient failure: retry on next use
  return result;
}

async function startBoss(): Promise<PgBoss | null> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    disabled = true;
    log.warn("DATABASE_URL is not set, so the job queue is disabled.");
    return null;
  }
  try {
    const instance = new PgBoss({ connectionString: url });
    instance.on("error", (error: unknown) =>
      log.error(
        `Job queue error: ${error instanceof Error ? error.message : JSON.stringify(error)}`,
      ),
    );
    await instance.start();
    for (const name of Object.values(JOBS)) {
      // Idempotent: pg-boss v12 queues are explicit, created once.
      await instance.createQueue(name);
    }
    boss = instance;
    return instance;
  } catch (cause) {
    log.error(
      `Job queue failed to start (will retry): ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    return null;
  }
}

/**
 * Queue a job. `singletonKey` makes repeat enqueues for the same subject
 * (e.g. a retried submit) a no-op. When the queue is unavailable, `inline`
 * runs the work in this request instead so nothing is silently lost.
 */
export async function enqueue(
  name: JobName,
  data: Record<string, string>,
  options: { singletonKey: string; startAfterSeconds?: number; inline?: () => Promise<void> },
): Promise<void> {
  try {
    const queue = await getQueue();
    if (queue) {
      await queue.send(name, data, {
        ...RETRY,
        singletonKey: options.singletonKey,
        ...(options.startAfterSeconds ? { startAfter: options.startAfterSeconds } : {}),
      });
      return;
    }
  } catch (cause) {
    log.error(
      `Queueing ${name} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  if (options.inline) {
    await options.inline().catch((cause: unknown) =>
      log.error(
        `${name} failed inline: ${cause instanceof Error ? cause.message : String(cause)}`,
      ),
    );
  } else {
    log.warn(`${name} skipped: the job queue is unavailable.`);
  }
}

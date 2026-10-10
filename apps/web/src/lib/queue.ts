import { PgBoss } from "pg-boss";
import { SPEED_TO_LEAD_JOB, alertWindowMinutes } from "./alerts";

/**
 * Postgres-backed job queue (pg-boss) for delayed speed-to-lead alerts — no
 * Redis. The boss installs and migrates its own `pgboss` schema on start and
 * shares the app's `DATABASE_URL`. The queue is best-effort: if it cannot
 * start, submissions still succeed and the alert is skipped with a logged
 * reason; a transient start failure retries on the next scheduling attempt.
 */

let boss: PgBoss | null = null;
let starting: Promise<PgBoss | null> | null = null;
/** Config-level disable (no DATABASE_URL): deterministic, not worth retrying. */
let disabled = false;

export async function getAlertQueue(): Promise<PgBoss | null> {
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
    console.warn("DATABASE_URL is not set — speed-to-lead alerts are disabled.");
    return null;
  }
  try {
    const instance = new PgBoss({ connectionString: url });
    instance.on("error", (error: unknown) =>
      console.error(
        `Alert queue error: ${
          error instanceof Error ? error.message : JSON.stringify(error)
        }`,
      ),
    );
    await instance.start();
    boss = instance;
    return instance;
  } catch (cause) {
    console.error(
      `Alert queue failed to start (alerts are skipped until it can): ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    return null;
  }
}

/**
 * Create the alert queue if missing. pg-boss v12 keeps queues explicit and
 * `createQueue` is idempotent (ON CONFLICT DO NOTHING).
 */
export async function ensureAlertQueue(instance: PgBoss): Promise<void> {
  await instance.createQueue(SPEED_TO_LEAD_JOB);
}

/**
 * Schedule the alert job for a submission. The handler re-checks bookings at
 * fire time, so a lead who books within the window never triggers a notice.
 */
export async function scheduleSpeedToLeadAlert(submissionId: string): Promise<void> {
  try {
    const instance = await getAlertQueue();
    if (!instance) return;
    await ensureAlertQueue(instance);
    const jobId = await instance.send(
      SPEED_TO_LEAD_JOB,
      { submissionId },
      {
        startAfter: alertWindowMinutes() * 60,
        retryLimit: 2,
        retryDelay: 30,
      },
    );
    if (!jobId) {
      console.warn(`Speed-to-lead alert for submission ${submissionId} was deduplicated.`);
    }
  } catch (cause) {
    console.error(
      `Scheduling the speed-to-lead alert for submission ${submissionId} failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }
}

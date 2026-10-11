/**
 * Runs once per server boot. server.mjs has already checked the
 * configuration (and exits on errors in production); this repeats the check
 * for `next dev`/`next start` run directly. Then it starts the job worker
 * (alerts, CRM write-backs, booking follow-ups), so no separate worker
 * process is needed — the queue lives in the same Postgres (no Redis).
 *
 * The imports sit inside the runtime check (Next's documented pattern) so
 * the Node-only graph is never bundled for the edge runtime.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { enforceConfig } = await import("../config-check.mjs");
    enforceConfig();
    const { startJobWorker } = await import("./lib/jobs");
    await startJobWorker();
  }
}

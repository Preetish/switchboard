/**
 * Runs once per server boot. Starts the speed-to-lead alert worker so
 * delayed jobs fire without a separate worker process — self-hosters run
 * one command and the queue lives in the same Postgres (no Redis).
 *
 * The import sits inside the runtime check (Next's documented pattern) so
 * the Node-only worker graph is never bundled for the edge runtime.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startAlertWorker } = await import("./lib/alerts-worker");
    await startAlertWorker();
  }
}

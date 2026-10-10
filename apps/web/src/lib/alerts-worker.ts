import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  bookings,
  forms,
  routingDecisions,
  submissions,
  users,
  type Database,
} from "@switchboard/db";
import {
  SPEED_TO_LEAD_JOB,
  buildSpeedToLeadAlert,
  decideSpeedToLeadAlert,
  sendSlackAlert,
} from "./alerts";
import { sendEmail } from "./email";
import { releaseExpiredHolds } from "./holds";
import { getDb } from "./db";
import { ensureAlertQueue, getAlertQueue } from "./queue";

/**
 * Speed-to-lead alert worker: fires the alert job scheduled when a lead was
 * routed to a rep. At fire time the handler re-checks reality — a lead who
 * booked within the window (or holds a slot) is skipped, and an
 * at-most-once claim on `submissions.alerted_at` keeps pg-boss retries from
 * double-notifying. Slack is preferred; email to the rep is the fallback.
 */

export type SpeedToLeadJobData = { submissionId: string };

export async function handleSpeedToLeadAlert(
  db: Database,
  data: SpeedToLeadJobData,
): Promise<void> {
  const [row] = await db
    .select({ submission: submissions, formName: forms.name })
    .from(submissions)
    .innerJoin(forms, eq(submissions.formId, forms.id))
    .where(eq(submissions.id, data.submissionId))
    .limit(1);
  if (!row) {
    // The lead (or their data) was deleted — e.g. the GDPR endpoint; nothing to alert about.
    return;
  }

  const repId = await routedRepId(db, data.submissionId);
  if (!repId) {
    console.warn(
      `Speed-to-lead alert skipped for submission ${data.submissionId}: no rep was routed.`,
    );
    return;
  }
  const [rep] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, repId))
    .limit(1);
  if (!rep) return;

  await releaseExpiredHolds(db);
  const activeBookings = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.submissionId, data.submissionId),
        inArray(bookings.status, ["confirmed", "hold"]),
      ),
    );
  const decision = decideSpeedToLeadAlert({
    hasActiveBooking: activeBookings.length > 0,
    alreadyAlerted: row.submission.alertedAt !== null,
  });
  if (decision === "skip_booked") {
    console.log(`Speed-to-lead alert skipped: submission ${data.submissionId} booked in time.`);
    return;
  }
  if (decision === "skip_already_alerted") {
    console.log(`Speed-to-lead alert already sent for submission ${data.submissionId}.`);
    return;
  }

  // At-most-once claim: only the attempt that flips alerted_at may notify.
  const claimed = await db
    .update(submissions)
    .set({ alertedAt: new Date() })
    .where(and(eq(submissions.id, data.submissionId), isNull(submissions.alertedAt)))
    .returning({ id: submissions.id });
  if (!claimed[0]) {
    console.log(`Speed-to-lead alert already sent for submission ${data.submissionId}.`);
    return;
  }

  const waitedMinutes = Math.max(
    1,
    Math.round((Date.now() - row.submission.createdAt.getTime()) / 60_000),
  );
  const alert = buildSpeedToLeadAlert({
    repName: rep.name,
    leadName: typeof row.submission.data?.name === "string" ? row.submission.data.name : null,
    leadEmail: row.submission.email,
    formName: row.formName,
    waitedMinutes,
    submissionId: data.submissionId,
  });

  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  const notified = webhookUrl
    ? await sendSlackAlert(webhookUrl, alert.slackText)
    : await sendEmail(
        { to: rep.email, subject: alert.subject, text: alert.text },
        { context: "speed-to-lead alert" },
      );
  if (!notified && webhookUrl) {
    // Slack failed — fall back to email so the rep still hears about the lead.
    await sendEmail(
      { to: rep.email, subject: alert.subject, text: alert.text },
      { context: "speed-to-lead alert" },
    );
  }
}

async function routedRepId(db: Database, submissionId: string): Promise<string | null> {
  const [decision] = await db
    .select({ outcome: routingDecisions.outcome })
    .from(routingDecisions)
    .where(eq(routingDecisions.submissionId, submissionId))
    .orderBy(desc(routingDecisions.createdAt))
    .limit(1);
  return decision?.outcome.userId ?? null;
}

let workerStarted = false;

/**
 * Start the in-process alert worker (called once per server boot from
 * instrumentation.ts). A failed start never blocks the server; scheduling
 * retries on the next submission.
 */
export async function startAlertWorker(): Promise<void> {
  if (workerStarted) return;
  workerStarted = true;
  try {
    const boss = await getAlertQueue();
    if (!boss) return;
    await ensureAlertQueue(boss);
    await boss.work<SpeedToLeadJobData>(SPEED_TO_LEAD_JOB, async (jobs) => {
      const db = getDb();
      for (const job of jobs) {
        await handleSpeedToLeadAlert(db, job.data);
      }
    });
    console.log("Speed-to-lead alert worker is running.");
  } catch (cause) {
    console.error(
      `Speed-to-lead alert worker failed to start: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }
}

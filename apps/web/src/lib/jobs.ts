import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  bookings,
  forms,
  orgs,
  routingDecisions,
  submissions,
  users,
  type Database,
} from "@switchboard/db";
import {
  alertWindowMinutes,
  buildSpeedToLeadAlert,
  decideSpeedToLeadAlert,
  sendSlackAlert,
} from "./alerts";
import { logCrmMeeting, syncLeadToCrm } from "./crm";
import { getDb } from "./db";
import { safeDisplayName } from "./display-name";
import { fallbackBookingUrl, sendConfirmationEmail, sendEmail, smtpConfigured } from "./email";
import { releaseExpiredHolds } from "./holds";
import { JOBS, enqueue, getQueue } from "./queue";

/**
 * Queued side effects and the in-process worker that runs them. Every
 * handler is idempotent (send-once markers on the rows) and throws only for
 * failures worth retrying, so pg-boss retries with backoff instead of the
 * work being dropped on the first outage.
 */

// ---- scheduling (called from request handlers) ----

/** Alert the routed rep if the lead hasn't booked after the window. */
export function scheduleSpeedToLeadAlert(submissionId: string): Promise<void> {
  return enqueue(
    JOBS.speedToLead,
    { submissionId },
    { singletonKey: submissionId, startAfterSeconds: alertWindowMinutes() * 60 },
  );
}

/** Write the lead to the CRM without holding up their response. */
export function scheduleCrmSync(db: Database, submissionId: string): Promise<void> {
  return enqueue(
    JOBS.crmContact,
    { submissionId },
    { singletonKey: submissionId, inline: () => syncLeadToCrm(db, submissionId) },
  );
}

/** Confirmation email and CRM meeting log for a confirmed booking. */
export function scheduleBookingFollowup(db: Database, bookingId: string): Promise<void> {
  return enqueue(
    JOBS.bookingFollowup,
    { bookingId },
    { singletonKey: bookingId, inline: () => followUpBooking(db, bookingId) },
  );
}

// ---- handlers ----

export async function followUpBooking(db: Database, bookingId: string): Promise<void> {
  const [row] = await db
    .select({
      booking: bookings,
      repName: users.name,
      repEmail: users.email,
      repTimeZone: users.timezone,
      orgName: orgs.name,
      leadEmail: submissions.email,
      leadData: submissions.data,
    })
    .from(bookings)
    .innerJoin(users, eq(bookings.userId, users.id))
    .innerJoin(orgs, eq(bookings.orgId, orgs.id))
    .leftJoin(submissions, eq(bookings.submissionId, submissions.id))
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!row || row.booking.status !== "confirmed") return;
  const { booking } = row;
  const leadName = safeDisplayName(row.leadData?.name);
  let retry: unknown = null;

  if (row.leadEmail && !booking.confirmationSentAt && smtpConfigured()) {
    const sent = await sendConfirmationEmail({
      to: row.leadEmail,
      leadName,
      orgName: row.orgName,
      repName: row.repName,
      repEmail: row.repEmail,
      startAt: booking.startAt,
      repTimeZone: row.repTimeZone,
      meetLink: booking.meetLink,
      fallbackUrl: booking.meetLink ? null : fallbackBookingUrl(),
    });
    if (sent) {
      await db
        .update(bookings)
        .set({ confirmationSentAt: new Date() })
        .where(eq(bookings.id, booking.id));
    } else {
      retry = new Error("Confirmation email was not delivered.");
    }
  }

  try {
    await logCrmMeeting(db, booking.orgId, {
      id: booking.id,
      crmMeetingId: booking.crmMeetingId,
      startAt: booking.startAt,
      endAt: booking.endAt,
      leadEmail: row.leadEmail,
      leadName,
      repName: row.repName,
      repEmail: row.repEmail,
      meetLink: booking.meetLink,
    });
  } catch (cause) {
    retry ??= cause;
  }
  if (retry) throw retry;
}

/**
 * Speed-to-lead alert. At fire time the handler re-checks reality: a lead
 * who booked within the window (or holds a slot) is skipped. The send-once
 * marker is set only after a channel delivered, and an undelivered alert
 * throws so the job retries instead of the rep never hearing about the lead.
 */
export async function handleSpeedToLeadAlert(
  db: Database,
  submissionId: string,
): Promise<void> {
  const [row] = await db
    .select({ submission: submissions, formName: forms.name })
    .from(submissions)
    .innerJoin(forms, eq(submissions.formId, forms.id))
    .where(eq(submissions.id, submissionId))
    .limit(1);
  // The lead (or their data) was deleted, e.g. on request; nothing to alert about.
  if (!row) return;

  const [decision] = await db
    .select({ outcome: routingDecisions.outcome })
    .from(routingDecisions)
    .where(eq(routingDecisions.submissionId, submissionId))
    .orderBy(desc(routingDecisions.createdAt))
    .limit(1);
  const repId = decision?.outcome.userId;
  if (!repId) return;
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
        eq(bookings.submissionId, submissionId),
        inArray(bookings.status, ["confirmed", "hold"]),
      ),
    );
  const verdict = decideSpeedToLeadAlert({
    hasActiveBooking: activeBookings.length > 0,
    alreadyAlerted: row.submission.alertedAt !== null,
  });
  if (verdict !== "send") return;

  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl && !smtpConfigured()) {
    console.warn(
      `Speed-to-lead alert for submission ${submissionId} skipped: set SLACK_WEBHOOK_URL or SMTP_URL to receive alerts.`,
    );
    return;
  }

  const waitedMinutes = Math.max(
    1,
    Math.round((Date.now() - row.submission.createdAt.getTime()) / 60_000),
  );
  const alert = buildSpeedToLeadAlert({
    repName: rep.name,
    leadName: safeDisplayName(row.submission.data?.name),
    leadEmail: row.submission.email,
    formName: row.formName,
    waitedMinutes,
    submissionId,
  });
  const email = () =>
    sendEmail(
      { to: rep.email, subject: alert.subject, text: alert.text },
      { context: "speed-to-lead alert" },
    );
  // Slack first when configured; email as the fallback channel.
  const delivered =
    (webhookUrl ? await sendSlackAlert(webhookUrl, alert.slackText) : false) ||
    (smtpConfigured() ? await email() : false);
  if (!delivered) {
    throw new Error(`Speed-to-lead alert for submission ${submissionId} was not delivered.`);
  }
  await db
    .update(submissions)
    .set({ alertedAt: new Date() })
    .where(and(eq(submissions.id, submissionId), isNull(submissions.alertedAt)));
}

// ---- worker ----

let workerRunning = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Start the in-process worker (once per server boot, from instrumentation).
 * If the database isn't reachable yet, it keeps retrying with backoff
 * instead of leaving queued jobs without a consumer until a restart.
 */
export async function startJobWorker(attempt = 0): Promise<void> {
  if (workerRunning) return;
  try {
    const queue = await getQueue();
    if (!queue) throw new Error("queue unavailable");
    await queue.work<{ submissionId: string }>(JOBS.speedToLead, async (jobs) => {
      for (const job of jobs) await handleSpeedToLeadAlert(getDb(), job.data.submissionId);
    });
    await queue.work<{ submissionId: string }>(JOBS.crmContact, async (jobs) => {
      for (const job of jobs) await syncLeadToCrm(getDb(), job.data.submissionId);
    });
    await queue.work<{ bookingId: string }>(JOBS.bookingFollowup, async (jobs) => {
      for (const job of jobs) await followUpBooking(getDb(), job.data.bookingId);
    });
    workerRunning = true;
    console.log("[switchboard] job worker is running.");
  } catch (cause) {
    const delayMs = Math.min(60_000, 2_000 * 2 ** attempt);
    console.error(
      `[switchboard] job worker failed to start (retrying in ${delayMs / 1000}s): ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    retryTimer ??= setTimeout(() => {
      retryTimer = null;
      void startJobWorker(attempt + 1);
    }, delayMs);
    retryTimer.unref?.();
  }
}

import { log } from "./log";

/**
 * Speed-to-lead alerts: when a lead routed to a rep does not book within a
 * configurable window, the rep is notified by Slack or email. Scheduling and
 * delivery run on a Postgres-backed queue (pg-boss) — see queue.ts and
 * jobs.ts; this module holds the pure pieces and the Slack sender.
 */

export const DEFAULT_ALERT_MINUTES = 5;

/**
 * `SPEED_TO_LEAD_MINUTES` sets how long a routed lead may sit unbooked before
 * the rep is alerted. Invalid or sub-minute values fall back to the default.
 */
export function alertWindowMinutes(): number {
  const raw = Number(process.env.SPEED_TO_LEAD_MINUTES);
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_ALERT_MINUTES;
  return Math.floor(raw);
}

export type SpeedToLeadAlertInput = {
  repName: string;
  leadName: string | null;
  leadEmail: string | null;
  formName: string | null;
  waitedMinutes: number;
  submissionId: string;
};

export function leadDisplay(leadName: string | null, leadEmail: string | null): string {
  if (leadName && leadEmail) return `${leadName} (${leadEmail})`;
  return leadName ?? leadEmail ?? "An unnamed lead";
}

/**
 * Slack treats `<…>` as links and mentions (`<!channel>`, `<https://x|Click>`)
 * and `&` as an entity start, so lead-supplied text is escaped before it is
 * posted to an internal channel.
 */
export function escapeSlack(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildSpeedToLeadAlert(input: SpeedToLeadAlertInput): {
  subject: string;
  text: string;
  slackText: string;
} {
  const lead = leadDisplay(input.leadName, input.leadEmail);
  const formPart = input.formName ? ` via "${input.formName}"` : "";
  const body =
    `${lead} submitted${formPart} ${input.waitedMinutes} minute(s) ago ` +
    `and no meeting is booked yet.`;
  return {
    subject: `Speed-to-lead: ${lead} has not booked yet`,
    text: [
      `Hi ${input.repName},`,
      "",
      body,
      "",
      `Reference: ${input.submissionId}`,
      "",
      "Reach out while the request is fresh.",
      "",
      "Switchboard",
    ].join("\n"),
    slackText: `:hourglass: *Speed-to-lead:* ${escapeSlack(body)} Rep: ${escapeSlack(input.repName)}. Reference: ${input.submissionId}`,
  };
}

/** Whether the alert should still go out when the job fires. */
export type AlertDecisionContext = {
  /** The lead has a confirmed booking (or a live slot hold). */
  hasActiveBooking: boolean;
  /** A previous job attempt already delivered the alert. */
  alreadyAlerted: boolean;
};

export type AlertDecision = "send" | "skip_booked" | "skip_already_alerted";

/**
 * Booked-in-time wins over already-alerted: a retry that lands after both the
 * alert and a late booking reports the happy skip, not a duplicate send.
 */
export function decideSpeedToLeadAlert(context: AlertDecisionContext): AlertDecision {
  if (context.hasActiveBooking) return "skip_booked";
  if (context.alreadyAlerted) return "skip_already_alerted";
  return "send";
}

/**
 * Post the alert to an incoming Slack webhook. Best-effort like every alert
 * channel: failures are logged and reported as `false`, never thrown.
 */
export async function sendSlackAlert(
  webhookUrl: string,
  text: string,
  timeoutMs = 2_000,
): Promise<boolean> {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      log.error(`Slack alert webhook responded ${response.status}.`);
      return false;
    }
    return true;
  } catch (cause) {
    log.error(
      `Slack alert failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    return false;
  }
}

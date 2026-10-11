import { createTransport } from "nodemailer";
import { log } from "./log";

/**
 * Confirmation email (bring-your-own SMTP): `SMTP_URL` like
 * `smtps://user:pass@smtp.example.com:465`. Email is best-effort — a failure
 * is logged and the booking stands; the lead can always be reached through
 * the rep. Without `SMTP_URL` the email is skipped and that is logged too.
 */

export type ConfirmationEmailInput = {
  to: string;
  leadName?: string | null;
  orgName: string;
  repName: string;
  repEmail: string;
  startAt: Date;
  /** The rep's IANA zone — the meeting's local time is shown in it. */
  repTimeZone: string;
  meetLink: string | null;
  /** Plain booking link offered when no calendar event could be created. */
  fallbackUrl: string | null;
};

/** Plain booking link offered by email when the calendar event cannot be created. */
export function fallbackBookingUrl(): string | null {
  return process.env.FALLBACK_BOOKING_URL || null;
}

export function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_URL);
}

/** Operational safety net so a slow SMTP server can't hang the request. */
const SMTP_TIMEOUTS = {
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 15_000,
};

/**
 * nodemailer merges `SMTP_URL` query params OVER the transport options, so a
 * bad `?connectionTimeout=abc` would silently disable the timeouts above.
 * Strip them from the URL and pin them in code instead.
 */
function smtpUrlWithPinnedTimeouts(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of Object.keys(SMTP_TIMEOUTS)) {
      parsed.searchParams.delete(key);
    }
    return parsed.toString();
  } catch {
    return url; // unparseable: nodemailer reports its own clear error
  }
}

const SUBJECT_OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
};

const BODY_OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "long",
};

function formatWhen(
  date: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  // timeZone is a constructor option, not a per-format option.
  return new Intl.DateTimeFormat("en", { ...options, timeZone }).format(date);
}

export function buildConfirmationEmail(input: ConfirmationEmailInput): {
  subject: string;
  text: string;
} {
  const whenSubject = formatWhen(input.startAt, input.repTimeZone, SUBJECT_OPTIONS);
  const whenBody = formatWhen(input.startAt, input.repTimeZone, BODY_OPTIONS);
  const greeting = input.leadName ? `Hi ${input.leadName.split(" ")[0]}` : "Hello";

  const lines = [
    `${greeting},`,
    "",
    `Your meeting with ${input.repName} (${input.orgName}) is confirmed for ${whenBody}.`,
  ];
  if (input.meetLink) {
    lines.push("", `Join online: ${input.meetLink}`);
  } else {
    lines.push(
      "",
      "We could not create the calendar event automatically, so the meeting is not on a calendar yet.",
    );
    if (input.fallbackUrl) {
      lines.push(`You can pick another time here: ${input.fallbackUrl}`);
    }
    lines.push(
      `Or simply reply to this email and ${input.repName} will set it up with you.`,
    );
  }
  lines.push(
    "",
    `Questions? Reply to ${input.repName} at ${input.repEmail}.`,
    "",
    `— ${input.orgName}`,
  );

  return {
    subject: `Confirmed: meeting with ${input.repName} — ${whenSubject}`,
    text: lines.join("\n"),
  };
}

export async function sendConfirmationEmail(
  input: ConfirmationEmailInput,
): Promise<boolean> {
  const message = buildConfirmationEmail(input);
  return sendEmail(
    { to: input.to, subject: message.subject, text: message.text },
    { context: "confirmation email" },
  );
}

/** `jane.doe@corp.com` → `j***@corp.com`, so logs don't collect lead addresses. */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${address[0]}***${address.slice(at)}`;
}

/** A short label used in the skip/failure logs, e.g. "confirmation email". */
export type EmailContext = { context: string };

export async function sendEmail(
  message: { to: string; subject: string; text: string },
  { context }: EmailContext,
): Promise<boolean> {
  const url = process.env.SMTP_URL;
  if (!url) {
    log.warn(`SMTP_URL is not set — ${context} skipped.`);
    return false;
  }
  try {
    const transport = createTransport({
      url: smtpUrlWithPinnedTimeouts(url),
      ...SMTP_TIMEOUTS,
    });
    await transport.sendMail({
      from: process.env.SMTP_FROM ?? "Switchboard <no-reply@switchboard.local>",
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
    return true;
  } catch (cause) {
    log.error(
      `Email (${context}) to ${maskEmail(message.to)} failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    return false;
  }
}

import { createTransport } from "nodemailer";

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

export function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_URL);
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

function formatWhen(date: Date, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  // timeZone is a constructor option, not a per-format option.
  return new Intl.DateTimeFormat("en", { ...options, timeZone }).format(date);
}

export function buildConfirmationEmail(input: ConfirmationEmailInput): {
  subject: string;
  text: string;
} {
  const whenSubject = formatWhen(input.startAt, input.repTimeZone, SUBJECT_OPTIONS);
  const whenBody = formatWhen(input.startAt, input.repTimeZone, BODY_OPTIONS);
  const greeting = input.leadName ? `Hi ${input.leadName}` : "Hello";

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
    lines.push(`Or simply reply to this email and ${input.repName} will set it up with you.`);
  }
  lines.push("", `Questions? Reach ${input.repName} at ${input.repEmail}.`, "", "— Switchboard");

  return {
    subject: `Confirmed: meeting with ${input.repName} — ${whenSubject}`,
    text: lines.join("\n"),
  };
}

export async function sendConfirmationEmail(
  input: ConfirmationEmailInput,
): Promise<boolean> {
  const url = process.env.SMTP_URL;
  if (!url) {
    console.warn("SMTP_URL is not set — confirmation email skipped.");
    return false;
  }
  try {
    const transport = createTransport({
      url,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    const message = buildConfirmationEmail(input);
    await transport.sendMail({
      from: process.env.SMTP_FROM ?? "Switchboard <no-reply@switchboard.local>",
      to: input.to,
      subject: message.subject,
      text: message.text,
    });
    return true;
  } catch (cause) {
    console.error(
      `Confirmation email to ${input.to} failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    return false;
  }
}

import { and, eq } from "drizzle-orm";
import { forms, submissions, type Database } from "@switchboard/db";
import { appBaseUrl } from "./integrations";
import { sendEmail, smtpConfigured } from "./email";
import { signToken, verifyToken } from "./signed-token";

/**
 * Lead data erasure (GDPR/CASL). A lead asks with their email; we email a
 * signed link to that address and only delete when it is opened and
 * confirmed, so nobody can erase someone else's data by typing their
 * address. Responses never reveal whether an address has submitted.
 *
 * Erasure removes Switchboard's copy: submissions and, by cascade, routing
 * decisions and bookings. Calendar events and CRM records live in the org's
 * own systems and are handled there.
 */

const LINK_TTL_MS = 24 * 60 * 60_000;
const TOKEN_KIND = "erase-lead";

type ErasureRequest = { slug: string; email: string };

export type RequestErasureResult = "sent" | "unavailable";

/**
 * Email a confirmation link if this address submitted the form. Returns
 * "unavailable" only when email isn't configured (the caller then tells the
 * lead to contact the org); otherwise "sent", whether or not a link went out.
 */
export async function requestErasure(
  db: Database,
  slug: string,
  email: string,
): Promise<RequestErasureResult> {
  if (!smtpConfigured() || !process.env.AUTH_SECRET) return "unavailable";
  const [form] = await db
    .select({ id: forms.id, name: forms.name })
    .from(forms)
    .where(eq(forms.slug, slug))
    .limit(1);
  if (!form) return "sent";
  const [match] = await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(and(eq(submissions.formId, form.id), eq(submissions.email, email)))
    .limit(1);
  if (!match) return "sent";

  const token = signToken<ErasureRequest>(TOKEN_KIND, { slug, email }, LINK_TTL_MS);
  if (!token) return "unavailable";
  const link = `${appBaseUrl()}/f/${encodeURIComponent(slug)}/delete?token=${token}`;
  await sendEmail(
    {
      to: email,
      subject: `Confirm deleting your data (${form.name})`,
      text: [
        "Hello,",
        "",
        `Someone asked to delete the details submitted with this address through "${form.name}".`,
        "If that was you, confirm here (the link works for 24 hours):",
        "",
        link,
        "",
        "If it wasn't you, ignore this email and nothing will change.",
      ].join("\n"),
    },
    { context: "data deletion link" },
  );
  return "sent";
}

/** The request a deletion link was issued for, or null when invalid/expired. */
export function readErasureToken(token: unknown): ErasureRequest | null {
  return verifyToken<ErasureRequest>(TOKEN_KIND, token);
}

/** Erase every submission for `email` on the form (decisions and bookings cascade). */
export async function eraseFormSubmissions(
  db: Database,
  request: ErasureRequest,
): Promise<number> {
  const [form] = await db
    .select({ id: forms.id })
    .from(forms)
    .where(eq(forms.slug, request.slug))
    .limit(1);
  if (!form) return 0;
  const deleted = await db
    .delete(submissions)
    .where(and(eq(submissions.formId, form.id), eq(submissions.email, request.email)))
    .returning({ id: submissions.id });
  return deleted.length;
}

/** Admin erasure across every form in the org (from the routing log). */
export async function eraseOrgSubmissions(
  db: Database,
  orgId: string,
  email: string,
): Promise<number> {
  const deleted = await db
    .delete(submissions)
    .where(and(eq(submissions.orgId, orgId), eq(submissions.email, email)))
    .returning({ id: submissions.id });
  return deleted.length;
}

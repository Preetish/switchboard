import { NextResponse } from "next/server";
import { emailFieldKey, validateFormFields } from "@switchboard/core";
import { and, eq } from "drizzle-orm";
import { forms, submissions } from "@switchboard/db";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * GDPR data-deletion endpoint: removes every submission (and, by cascade,
 * every routing decision) for this form whose stored email matches.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const email =
    body && typeof body === "object" && typeof (body as Record<string, unknown>).email === "string"
      ? (body as { email: string }).email.trim().toLowerCase()
      : "";
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Enter the email you submitted." }, { status: 400 });
  }

  const db = getDb();
  const [form] = await db.select().from(forms).where(eq(forms.slug, slug)).limit(1);
  if (!form) return NextResponse.json({ error: "Form not found." }, { status: 404 });
  const emailKey = emailFieldKey(validateFormFields(form.fields).ok ? form.fields : []);
  if (!emailKey) {
    return NextResponse.json(
      { error: "This form does not collect an email, so there is nothing to look up." },
      { status: 400 },
    );
  }

  const deleted = await db
    .delete(submissions)
    .where(and(eq(submissions.formId, form.id), eq(submissions.email, email)))
    .returning({ id: submissions.id });
  return NextResponse.json({ deleted: deleted.length });
}

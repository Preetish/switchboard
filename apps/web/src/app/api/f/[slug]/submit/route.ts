import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { handleSubmission } from "@/lib/submit";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ errors: { _form: "Expected a JSON body." } }, { status: 400 });
  }
  const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const idempotencyKey =
    typeof payload.idempotencyKey === "string" && payload.idempotencyKey.length <= 128
      ? payload.idempotencyKey
      : undefined;

  const result = await handleSubmission(getDb(), slug, payload.data, idempotencyKey);

  switch (result.status) {
    case "not_found":
      return NextResponse.json({ error: "Form not found." }, { status: 404 });
    case "invalid":
      return NextResponse.json({ errors: result.errors }, { status: 400 });
    case "created":
      return NextResponse.json(
        { submissionId: result.submissionId, decision: result.decision },
        { status: 201 },
      );
    case "duplicate":
      return NextResponse.json({
        submissionId: result.submissionId,
        decision: result.decision,
        duplicate: true,
      });
  }
}

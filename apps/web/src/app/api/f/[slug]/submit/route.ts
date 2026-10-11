import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { handleSubmission } from "@/lib/submit";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const limit = checkRateLimit("submit", clientIp(request));
  if (!limit.allowed) {
    return NextResponse.json(
      {
        errors: {
          _form: "Too many submissions from your network — please try again shortly.",
        },
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { errors: { _form: "Expected a JSON body." } },
      { status: 400 },
    );
  }
  const payload =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};

  // Honeypot (task 13): the hosted form renders an off-screen field a human
  // never fills; bots that fill every input reveal themselves here. A real
  // user is never affected because the field is invisible and
  // autocomplete-disabled.
  if (typeof payload.honeypot === "string" && payload.honeypot.trim() !== "") {
    return NextResponse.json(
      { errors: { _form: "This submission was rejected." } },
      { status: 400 },
    );
  }

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
        {
          submissionId: result.submissionId,
          decision: result.decision,
          repName: result.repName,
        },
        { status: 201 },
      );
    case "duplicate":
      return NextResponse.json({
        submissionId: result.submissionId,
        decision: result.decision,
        repName: result.repName,
        duplicate: true,
      });
  }
}

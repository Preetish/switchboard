import { NextResponse } from "next/server";
import type { DecisionOutcome } from "@switchboard/db";
import { verifyTurnstile } from "@/lib/captcha";
import { getDb } from "@/lib/db";
import { readJsonBody } from "@/lib/http";
import { checkRateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";
import { handleSubmission } from "@/lib/submit";

export const dynamic = "force-dynamic";

/**
 * What the lead's browser needs from a routing decision: what kind of
 * outcome it was and, for instant booking, which rep. Rule names, reasons,
 * team ids, and strategies stay in the routing log.
 */
function publicDecision(decision: DecisionOutcome | null) {
  return decision ? { kind: decision.kind, userId: decision.userId ?? null } : null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const ip = clientIp(request);
  const limit = checkRateLimit("submit", ip);
  if (!limit.allowed) {
    return tooManyRequests(limit.retryAfterSeconds, {
      errors: {
        _form: "Too many submissions from your network. Try again in a few minutes.",
      },
    });
  }
  const body = await readJsonBody(request);
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { errors: { _form: "Something went wrong sending the form. Please try again." } },
      { status: 400 },
    );
  }
  const payload = body as Record<string, unknown>;
  // Honeypot: the hosted form renders an off-screen field a human never
  // fills; bots that fill every input reveal themselves here.
  if (typeof payload.honeypot === "string" && payload.honeypot.trim() !== "") {
    return NextResponse.json(
      { errors: { _form: "This submission was rejected." } },
      { status: 400 },
    );
  }
  // Optional CAPTCHA (Cloudflare Turnstile) when TURNSTILE_SECRET_KEY is set.
  if (!(await verifyTurnstile(payload.captchaToken, ip))) {
    return NextResponse.json(
      { errors: { _form: "Please complete the verification and try again." } },
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
    case "duplicate":
      return NextResponse.json(
        {
          submissionId: result.submissionId,
          decision: publicDecision(result.decision),
          repName: result.repName,
          ...(result.status === "duplicate" ? { duplicate: true } : {}),
        },
        { status: result.status === "created" ? 201 : 200 },
      );
  }
}

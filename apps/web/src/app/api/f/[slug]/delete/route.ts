import { NextResponse } from "next/server";
import { isEmailAddress } from "@switchboard/core";
import { getDb } from "@/lib/db";
import { requestErasure } from "@/lib/erasure";
import { readJsonBody } from "@/lib/http";
import { checkRateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Start a data-deletion request: email the address a confirmation link.
 * The response is the same whether or not the address ever submitted, so
 * this endpoint can't be used to check who filled in the form.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const limit = checkRateLimit("delete", clientIp(request));
  if (!limit.allowed) {
    return tooManyRequests(limit.retryAfterSeconds, {
      error: "Too many requests. Try again in a few minutes.",
    });
  }
  const body = await readJsonBody(request);
  const raw =
    body && typeof body === "object" ? (body as Record<string, unknown>).email : undefined;
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!isEmailAddress(email)) {
    return NextResponse.json({ error: "Enter the email you submitted." }, { status: 400 });
  }
  const result = await requestErasure(getDb(), slug, email);
  if (result === "unavailable") {
    return NextResponse.json(
      {
        error:
          "Self-service deletion isn't available here. Contact the company that owns this form to delete your data.",
      },
      { status: 503 },
    );
  }
  return NextResponse.json(
    {
      message:
        "If that address submitted this form, we've emailed it a link to confirm the deletion.",
    },
    { status: 202 },
  );
}

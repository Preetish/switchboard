import { NextResponse } from "next/server";
import { createBooking, parseBookingInput } from "@/lib/bookings";
import { getDb } from "@/lib/db";
import { corsPreflight, readJsonBody, withCors } from "@/lib/http";
import { checkRateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Book the rep a lead was routed to. Public by design — the lead books
 * themselves — so the submission id, the routed-rep check, slot validation,
 * the overlap constraint, and the per-address rate limit are the guards
 * (see lib/bookings.ts).
 */
async function handlePOST(request: Request) {
  const limit = checkRateLimit("booking", clientIp(request));
  if (!limit.allowed) {
    return tooManyRequests(limit.retryAfterSeconds, {
      error: "Too many booking attempts. Try again in a few minutes.",
    });
  }
  const parsed = parseBookingInput(await readJsonBody(request));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const result = await createBooking(getDb(), parsed.input);
  switch (result.status) {
    case "not_found":
      return NextResponse.json({ error: result.error }, { status: 404 });
    case "invalid":
      return NextResponse.json({ error: result.error }, { status: 400 });
    case "slot_taken":
      return NextResponse.json({ error: result.error }, { status: 409 });
    case "created":
      return NextResponse.json(
        {
          booking: result.booking,
          duplicate: result.duplicate,
          calendarFailed: result.calendarFailed,
          emailQueued: result.emailQueued,
          invited: result.invited,
        },
        { status: result.duplicate ? 200 : 201 },
      );
  }
}

export const POST = withCors(handlePOST);
export const OPTIONS = corsPreflight;

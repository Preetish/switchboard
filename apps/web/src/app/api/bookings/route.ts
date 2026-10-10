import { NextResponse } from "next/server";
import { createBooking, parseBookingInput } from "@/lib/bookings";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Create a booking for one rep at one slot. The instant-booking UI (roadmap
 * task 9) calls this after a routing decision picks the rep; the embed uses
 * the same surface. Public by design — the lead books themselves, and abuse
 * protection (honeypot, rate limiting) lands with task 15.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = parseBookingInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const result = await createBooking(getDb(), parsed.input);

  switch (result.status) {
    case "invalid":
    case "not_found":
      return NextResponse.json({ error: result.error }, { status: result.status === "not_found" ? 404 : 400 });
    case "slot_taken":
      return NextResponse.json({ error: result.error }, { status: 409 });
    case "created":
      return NextResponse.json(
        {
          booking: result.booking,
          duplicate: result.duplicate,
          calendarError: result.calendarError ?? null,
          emailSent: result.emailSent,
        },
        { status: 201 },
      );
  }
}

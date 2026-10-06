import { NextResponse } from "next/server";
import { getAvailability } from "@/lib/integrations";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function intParam(
  params: URLSearchParams,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = params.get(name);
  const parsed = raw === null ? Number.NaN : Number(raw);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * Public read-only availability for one rep — the surface the instant-booking
 * UI (roadmap task 9) will call after a routing decision. Rep name + slot
 * times only, no lead data. Google free/busy degrades to local bookings on
 * failure.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  if (!UUID_RE.test(userId)) {
    return NextResponse.json({ error: "Rep not found." }, { status: 404 });
  }
  const searchParams = new URL(request.url).searchParams;
  const duration = intParam(searchParams, "duration", 30, 15, 240);
  const days = intParam(searchParams, "days", 14, 1, 42);

  const availability = await getAvailability(getDb(), userId, duration, days);
  if (!availability) {
    return NextResponse.json({ error: "Rep not found." }, { status: 404 });
  }
  return NextResponse.json(availability);
}

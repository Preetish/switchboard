import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { MAX_HORIZON_DAYS, getAvailability } from "@/lib/integrations";
import { findRoutedLead } from "@/lib/lead-access";
import { checkRateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";
import { isUuid } from "@/lib/http";

export const dynamic = "force-dynamic";

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
 * Open times for the rep a lead was routed to — the inline booking UI calls
 * this right after submit. `?submission=<id>` is required and must have been
 * routed to this rep, so rep calendars can't be browsed by anyone holding a
 * rep id. Returns the rep's name and zone plus slot times only.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const limit = checkRateLimit("availability", clientIp(request));
  if (!limit.allowed) {
    return tooManyRequests(limit.retryAfterSeconds, {
      error: "Too many requests. Try again in a few minutes.",
    });
  }
  const { userId } = await params;
  const searchParams = new URL(request.url).searchParams;
  const submissionId = searchParams.get("submission");
  const notFound = () => NextResponse.json({ error: "Rep not found." }, { status: 404 });
  if (!isUuid(userId) || !submissionId || !isUuid(submissionId)) return notFound();

  const db = getDb();
  const lead = await findRoutedLead(db, submissionId);
  if (!lead || lead.repId !== userId) return notFound();

  const duration = intParam(searchParams, "duration", 30, 15, 240);
  const days = intParam(searchParams, "days", 14, 1, MAX_HORIZON_DAYS);
  const availability = await getAvailability(db, userId, duration, days);
  if (!availability) return notFound();
  return NextResponse.json(availability, { headers: { "Cache-Control": "no-store" } });
}

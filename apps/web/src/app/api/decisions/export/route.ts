import { NextResponse } from "next/server";
import { adminSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { adminKeyOk, findOrg } from "@/lib/integrations";
import {
  decisionRowsToCsv,
  decisionToCsvRow,
  fetchDecisionLog,
} from "@/lib/decisions-log";

export const dynamic = "force-dynamic";

/** Export cap so a runaway log cannot produce an unbounded download. */
const EXPORT_LIMIT = 5000;

/** `Authorization: Bearer <ADMIN_SETUP_KEY>` — headers stay out of access logs and history. */
function bearerKey(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() ?? null;
}

/**
 * CSV export of the routing log — same search (`?q=`) and columns as
 * /routing-log. The admin session guards browser use; scripted exports
 * (cron, curl) send `ADMIN_SETUP_KEY` as a bearer token instead.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if (!(await adminSession()) && !adminKeyOk(bearerKey(request))) {
    return NextResponse.json({ error: "Sign in or send the export key." }, { status: 401 });
  }
  const db = getDb();
  const org = await findOrg(db);
  if (!org) {
    return NextResponse.json(
      { error: "No organization found. Run the migrations and load your config first." },
      { status: 404 },
    );
  }
  const entries = await fetchDecisionLog(db, org.id, {
    q: params.get("q") ?? undefined,
    limit: EXPORT_LIMIT,
  });
  const csv = decisionRowsToCsv(entries.map(decisionToCsvRow));
  const filename = `routing-log-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

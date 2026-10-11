import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
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

/**
 * CSV export of the routing log — same guard and shape as /routing-log,
 * honoring the same `q` search. The admin session guards browser use;
 * `ADMIN_SETUP_KEY` stays accepted as an alternative so scripted exports
 * (cron, curl) can pull the CSV without a cookie jar. Columns are flat and
 * machine-readable; null matched_rule renders as `fallback` (only the
 * fallback fired).
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const session = await auth();
  if (!session && !adminKeyOk(params.get("key"))) {
    return NextResponse.json({ error: "admin_key" }, { status: 401 });
  }
  const db = getDb();
  const org = await findOrg(db);
  if (!org) {
    return NextResponse.json(
      { error: "No organization found. Run the migrations and seed script first." },
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

import { serializeConfig } from "@switchboard/config";
import { NextResponse } from "next/server";
import { adminSession } from "@/lib/auth";
import { getCurrentConfigPlan } from "@/lib/config-admin";
import { getDb } from "@/lib/db";
import { findOrg } from "@/lib/integrations";

export const dynamic = "force-dynamic";

/** The current setup as a switchboard.yaml download (rules written inline). */
export async function GET() {
  if (!(await adminSession())) {
    return NextResponse.json({ error: "Sign in to download the config." }, { status: 401 });
  }
  const db = getDb();
  const org = await findOrg(db);
  const plan = org ? await getCurrentConfigPlan(db, org.id) : null;
  if (!plan) {
    return NextResponse.json(
      { error: "No organization found. Run the migrations and load your config first." },
      { status: 404 },
    );
  }
  return new NextResponse(serializeConfig(plan), {
    headers: {
      "Content-Type": "text/yaml; charset=utf-8",
      "Content-Disposition": 'attachment; filename="switchboard.yaml"',
      "Cache-Control": "no-store",
    },
  });
}

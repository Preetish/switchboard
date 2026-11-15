import { loadConfigObject } from "@switchboard/config";
import { NextResponse } from "next/server";
import { adminSession } from "@/lib/auth";
import { MAX_CONFIG_BYTES, readJsonBody } from "@/lib/http";
import { parseTestLead, simulateLead } from "@/lib/simulate";

export const dynamic = "force-dynamic";

/**
 * The Setup page's simulator: `{ config, form, lead }`, where `config` is the
 * draft config object (as POST /api/admin/config/apply takes it), `form` a
 * form slug in it, and `lead` a test lead. The draft is validated the same
 * way as on apply, then the lead runs through the real rules engine. Nothing
 * is saved, no lead is created, and the database is not read.
 */
export async function POST(request: Request) {
  if (!(await adminSession())) {
    return NextResponse.json(
      { errors: ["Sign in to simulate a lead."] },
      { status: 401 },
    );
  }
  const body = (await readJsonBody(request, MAX_CONFIG_BYTES)) as
    { config?: unknown; form?: unknown; lead?: unknown } | null | undefined;
  const lead = parseTestLead(body?.lead);
  if (!body || typeof body.form !== "string" || !lead) {
    return NextResponse.json(
      { errors: ["Send { config, form, lead } as a JSON object (under 1 MB)."] },
      { status: 400 },
    );
  }
  const result = loadConfigObject(body.config);
  if (!result.ok) return NextResponse.json({ errors: result.errors }, { status: 400 });
  const simulation = simulateLead(result.plan, body.form, lead);
  if (!simulation) {
    return NextResponse.json(
      { errors: [`There is no form "${body.form}" in this config.`] },
      { status: 400 },
    );
  }
  return NextResponse.json(simulation);
}

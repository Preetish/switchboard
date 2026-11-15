import { applyConfig, loadConfigObject } from "@switchboard/config";
import { NextResponse } from "next/server";
import { adminSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { MAX_CONFIG_BYTES, readJsonBody } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Save a config from the visual builder: the body is the config as a JSON
 * object (switchboard.yaml's shape, rules inline). It is validated in full
 * first; any problem returns 400 with every error and nothing is written.
 * A valid config is applied in one transaction, like `npm run config:apply`.
 */
export async function POST(request: Request) {
  if (!(await adminSession())) {
    return NextResponse.json({ errors: ["Sign in to change the config."] }, { status: 401 });
  }
  const body = await readJsonBody(request, MAX_CONFIG_BYTES);
  if (body === undefined) {
    return NextResponse.json(
      { errors: ["Send the config as a JSON object (under 1 MB)."] },
      { status: 400 },
    );
  }
  const result = loadConfigObject(body);
  if (!result.ok) return NextResponse.json({ errors: result.errors }, { status: 400 });
  const summary = await applyConfig(getDb(), result.plan);
  return NextResponse.json(summary);
}

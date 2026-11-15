import { loadConfigObject, serializeConfig } from "@switchboard/config";
import { NextResponse } from "next/server";
import { adminSession } from "@/lib/auth";
import { MAX_CONFIG_BYTES, readJsonBody } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Check a config from the visual builder without saving it, for the review
 * screen: the body is the same config object POST /api/admin/config/apply
 * takes, validated the same way (`config:check`'s checks). A valid config
 * returns its plan, its switchboard.yaml text, and any warnings; any problem
 * returns 400 with every error. Nothing is written and the database is not
 * read.
 */
export async function POST(request: Request) {
  if (!(await adminSession())) {
    return NextResponse.json(
      { errors: ["Sign in to check the config."] },
      { status: 401 },
    );
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
  return NextResponse.json({
    plan: result.plan,
    yaml: serializeConfig(result.plan),
    warnings: result.warnings,
  });
}

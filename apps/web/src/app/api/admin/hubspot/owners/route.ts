import { HubspotApiError, listOwners } from "@switchboard/crm-hubspot";
import { NextResponse } from "next/server";
import { adminSession } from "@/lib/auth";
import { getValidHubspotAccessToken } from "@/lib/crm";
import { getDb } from "@/lib/db";
import { findOrg } from "@/lib/integrations";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

/** Listing every owner can take several pages; allow more than a single lookup. */
const OWNERS_TIMEOUT_MS = 5_000;

/**
 * Every HubSpot owner with an email ({ id, email, name }[]), for the Setup
 * page's rep picker. 404 when HubSpot is not connected; the picker then
 * falls back to typing the email by hand.
 */
export async function GET() {
  if (!(await adminSession())) {
    return NextResponse.json({ error: "Sign in to list HubSpot owners." }, { status: 401 });
  }
  const db = getDb();
  const org = await findOrg(db);
  const accessToken = org ? await getValidHubspotAccessToken(db, org.id) : null;
  if (!accessToken) {
    return NextResponse.json(
      { error: "HubSpot is not connected. Connect it on the Integrations page to pick owners." },
      { status: 404 },
    );
  }
  try {
    const owners = await listOwners({ accessToken, timeoutMs: OWNERS_TIMEOUT_MS });
    return NextResponse.json(owners, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    if (!(cause instanceof HubspotApiError)) throw cause;
    log.error(`Listing HubSpot owners failed: ${cause.message}`);
    return NextResponse.json(
      { error: "HubSpot didn't return its owners. Try again, or type the rep's email." },
      { status: 502 },
    );
  }
}

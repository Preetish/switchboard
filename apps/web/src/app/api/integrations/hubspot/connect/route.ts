import { NextResponse } from "next/server";
import { authorizationUrl } from "@switchboard/crm-hubspot";
import { adminSession } from "@/lib/auth";
import { hubspotConfig } from "@/lib/crm";
import { getDb } from "@/lib/db";
import { appBaseUrl, findOrg } from "@/lib/integrations";
import { STATE_COOKIE, STATE_COOKIE_OPTIONS, newOAuthState } from "@/lib/oauth-state";

export const dynamic = "force-dynamic";

/**
 * Start the HubSpot OAuth handshake (admin-only): HubSpot is one org-wide
 * connection. Stash a signed CSRF state cookie and redirect to consent.
 */
export async function GET() {
  const base = appBaseUrl();
  const fail = (error: string) => NextResponse.redirect(`${base}/integrations?error=${error}`);

  if (!(await adminSession())) return NextResponse.redirect(`${base}/login`);
  const config = hubspotConfig();
  if (!config) return fail("hubspot_not_configured");
  const org = await findOrg(getDb());
  if (!org) return fail("org_missing");

  const state = newOAuthState("hubspot", null);
  if (!state) return fail("auth_not_configured");
  const response = NextResponse.redirect(authorizationUrl(config, state));
  response.cookies.set(STATE_COOKIE.hubspot, state, STATE_COOKIE_OPTIONS);
  return response;
}

import { NextResponse } from "next/server";
import { OAUTH_STATE_COOKIE_HUBSPOT, findOrg, newStateValue } from "@/lib/integrations";
import { auth } from "@/lib/auth";
import { hubspotConfig } from "@/lib/crm";
import { authorizationUrl } from "@switchboard/crm-hubspot";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Start the HubSpot OAuth handshake (admin-only, task 13): require a
 * signed-in admin session, stash a CSRF state cookie, redirect to HubSpot's
 * consent screen.
 */
export async function GET(request: Request) {
  const baseUrl = new URL(request.url).origin;
  const fail = (error: string) =>
    NextResponse.redirect(`${baseUrl}/integrations?error=${error}`);

  if (!(await auth())) return NextResponse.redirect(`${baseUrl}/login`);
  const config = hubspotConfig();
  if (!config) return fail("hubspot_not_configured");

  const org = await findOrg(getDb());
  if (!org) return fail("org_missing");

  const state = newStateValue();
  const response = NextResponse.redirect(authorizationUrl(config, state));
  response.cookies.set(OAUTH_STATE_COOKIE_HUBSPOT, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return response;
}

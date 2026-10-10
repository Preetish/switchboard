import { NextResponse } from "next/server";
import {
  OAUTH_STATE_COOKIE_HUBSPOT,
  adminKeyOk,
  findOrg,
  newStateValue,
} from "@/lib/integrations";
import { hubspotConfig } from "@/lib/crm";
import { authorizationUrl } from "@switchboard/crm-hubspot";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Start the HubSpot OAuth handshake (admin-only via `ADMIN_SETUP_KEY` until
 * Auth.js lands): verify the key, stash a CSRF state cookie, redirect to
 * HubSpot's consent screen.
 */
export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key");
  const baseUrl = new URL(request.url).origin;
  const fail = (error: string) =>
    NextResponse.redirect(`${baseUrl}/integrations?error=${error}`);

  if (!adminKeyOk(key)) return fail("admin_key");
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

import { NextResponse } from "next/server";
import {
  OAUTH_STATE_COOKIE,
  adminKeyOk,
  findOrg,
  googleConfig,
  newStateValue,
} from "@/lib/integrations";
import { authorizationUrl } from "@switchboard/calendar-google";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Start the Google OAuth handshake (admin-only via `ADMIN_SETUP_KEY` until
 * Auth.js lands): verify the key, stash a CSRF state cookie, redirect to
 * Google's consent screen.
 */
export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key");
  const baseUrl = new URL(request.url).origin;
  const fail = (error: string) =>
    NextResponse.redirect(`${baseUrl}/integrations?error=${error}`);

  if (!adminKeyOk(key)) return fail("admin_key");
  const config = googleConfig();
  if (!config) return fail("google_not_configured");

  const org = await findOrg(getDb());
  if (!org) return fail("org_missing");

  const state = newStateValue();
  const response = NextResponse.redirect(authorizationUrl(config, state));
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return response;
}

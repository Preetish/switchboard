import { NextResponse } from "next/server";
import {
  OAUTH_STATE_COOKIE,
  findOrg,
  googleConfig,
  newStateValue,
} from "@/lib/integrations";
import { auth } from "@/lib/auth";
import { authorizationUrl } from "@switchboard/calendar-google";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Start the Google OAuth handshake (admin-only, task 13): require a signed-in
 * admin session, stash a CSRF state cookie, redirect to Google's consent
 * screen.
 */
export async function GET(request: Request) {
  const baseUrl = new URL(request.url).origin;
  const fail = (error: string) =>
    NextResponse.redirect(`${baseUrl}/integrations?error=${error}`);

  if (!(await auth())) return NextResponse.redirect(`${baseUrl}/login`);
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

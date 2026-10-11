import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { authorizationUrl } from "@switchboard/calendar-google";
import { users } from "@switchboard/db";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { appBaseUrl, findOrg, googleConfig } from "@/lib/integrations";
import {
  STATE_COOKIE,
  STATE_COOKIE_OPTIONS,
  newOAuthState,
  verifyConnectLink,
} from "@/lib/oauth-state";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Start the Google OAuth handshake for one rep. Two ways in:
 * - a signed-in admin with `?userId=<rep>` (the rep is at the keyboard), or
 * - a signed connect link (`?rep=…&exp=…&sig=…`) the admin sent the rep, so
 *   reps connect their own calendar without the admin password.
 * Either way a signed state cookie records which rep the tokens belong to.
 */
export async function GET(request: Request) {
  const base = appBaseUrl();
  const params = new URL(request.url).searchParams;
  const linkRep = verifyConnectLink(params);
  const isAdmin = Boolean(await auth());
  const fail = (error: string) =>
    NextResponse.redirect(
      isAdmin
        ? `${base}/integrations?error=${error}`
        : `${base}/connect/result?provider=google&error=${error}`,
    );

  const userId = linkRep ?? (isAdmin ? params.get("userId") : null);
  if (!userId) return fail(isAdmin ? "rep_missing" : "link_invalid");
  if (!UUID_RE.test(userId)) return fail("rep_missing");

  const config = googleConfig();
  if (!config) return fail("google_not_configured");

  const db = getDb();
  const org = await findOrg(db);
  if (!org) return fail("org_missing");
  const [rep] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.orgId, org.id)))
    .limit(1);
  if (!rep) return fail("rep_missing");

  const state = newOAuthState("google", rep.id);
  if (!state) return fail("auth_not_configured");
  const response = NextResponse.redirect(authorizationUrl(config, state));
  response.cookies.set(STATE_COOKIE.google, state, STATE_COOKIE_OPTIONS);
  return response;
}

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { users } from "@switchboard/db";
import { adminSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { appBaseUrl, connectGoogle, findOrg } from "@/lib/integrations";
import { STATE_COOKIE, readCookie, verifyOAuthState } from "@/lib/oauth-state";

export const dynamic = "force-dynamic";

/**
 * Google redirects here with `code` + `state`; verify the signed state,
 * exchange the code, and store the tokens for the rep named in the state.
 * Admins land back on /integrations; reps who used a connect link get a
 * plain result page (they have no admin access).
 */
export async function GET(request: Request) {
  const base = appBaseUrl();
  const url = new URL(request.url);
  const isAdmin = Boolean(await adminSession());
  const done = (query: string) => {
    const response = NextResponse.redirect(
      isAdmin
        ? `${base}/integrations?${query}`
        : `${base}/connect/result?provider=google&${query}`,
    );
    response.cookies.delete(STATE_COOKIE.google);
    return response;
  };

  // CSRF guard: the signed state must round-trip through Google and the cookie.
  const verified = verifyOAuthState(
    "google",
    url.searchParams.get("state"),
    readCookie(request.headers.get("cookie"), STATE_COOKIE.google),
  );
  if (!verified?.userId) return done("error=state_mismatch");
  // State valid but no code means the rep declined consent.
  const code = url.searchParams.get("code");
  if (!code) return done("error=denied");

  const db = getDb();
  const org = await findOrg(db);
  if (!org) return done("error=org_missing");
  const [rep] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, verified.userId), eq(users.orgId, org.id)))
    .limit(1);
  if (!rep) return done("error=rep_missing");

  const result = await connectGoogle(db, { orgId: org.id, userId: rep.id }, code);
  if (!result.ok) return done(`error=${result.error}`);
  return done("connected=google");
}

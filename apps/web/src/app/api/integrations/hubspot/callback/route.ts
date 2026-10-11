import { NextResponse } from "next/server";
import { adminSession } from "@/lib/auth";
import { connectHubspot } from "@/lib/crm";
import { getDb } from "@/lib/db";
import { appBaseUrl, findOrg } from "@/lib/integrations";
import { STATE_COOKIE, readCookie, verifyOAuthState } from "@/lib/oauth-state";

export const dynamic = "force-dynamic";

/** HubSpot redirects here with `code` + `state`; verify, exchange, store. */
export async function GET(request: Request) {
  const base = appBaseUrl();
  const url = new URL(request.url);
  const done = (query: string) => {
    const response = NextResponse.redirect(`${base}/integrations?${query}`);
    response.cookies.delete(STATE_COOKIE.hubspot);
    return response;
  };

  // Org-wide connection: only the admin may complete it.
  if (!(await adminSession())) return NextResponse.redirect(`${base}/login`);
  // CSRF guard: the signed state must round-trip through HubSpot and the cookie.
  const verified = verifyOAuthState(
    "hubspot",
    url.searchParams.get("state"),
    readCookie(request.headers.get("cookie"), STATE_COOKIE.hubspot),
  );
  if (!verified || verified.userId !== null) return done("error=state_mismatch");
  // State valid but no code means the admin declined consent.
  const code = url.searchParams.get("code");
  if (!code) return done("error=denied");

  const db = getDb();
  const org = await findOrg(db);
  if (!org) return done("error=org_missing");
  const result = await connectHubspot(db, org.id, code);
  if (!result.ok) return done(`error=${result.error}`);
  return done("connected=hubspot");
}

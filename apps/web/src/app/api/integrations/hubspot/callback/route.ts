import { NextResponse } from "next/server";
import { OAUTH_STATE_COOKIE_HUBSPOT, findOrg } from "@/lib/integrations";
import { connectHubspot } from "@/lib/crm";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

function readCookie(cookieHeader: string | null, name: string): string | undefined {
  for (const cookie of cookieHeader?.split(";") ?? []) {
    const [key, ...rest] = cookie.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

/** HubSpot redirects here with `code` + `state`; verify, exchange, store. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const baseUrl = url.origin;
  const fail = (error: string) =>
    NextResponse.redirect(`${baseUrl}/integrations?error=${error}`);

  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");

  // CSRF guard: the state must round-trip through HubSpot and the cookie.
  const expectedState = readCookie(
    request.headers.get("cookie"),
    OAUTH_STATE_COOKIE_HUBSPOT,
  );
  if (!state || !expectedState || state !== expectedState) return fail("state_mismatch");
  // State valid but no code means the admin declined consent.
  if (!code) return fail("denied");

  const org = await findOrg(getDb());
  if (!org) return fail("org_missing");

  const result = await connectHubspot(getDb(), org.id, code);
  if (!result.ok) return fail(result.error);

  const success = NextResponse.redirect(`${baseUrl}/integrations?connected=hubspot`);
  success.cookies.delete(OAUTH_STATE_COOKIE_HUBSPOT);
  return success;
}

/**
 * HubSpot OAuth 2.0 (authorization-code flow) using plain `fetch` — no SDK
 * dependency, mirroring `packages/calendar-google`. Self-hosters create their
 * own HubSpot app (see README); the public app credentials never ship.
 *
 * All network calls take a timeout (default ~2s, per the routing brief) and
 * raise `HubspotAuthError` instead of hanging.
 */

export type HubspotOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type HubspotTokenSet = {
  accessToken: string;
  /** Absent on refresh responses — carry the stored one forward. */
  refreshToken?: string;
  expiresAt: Date;
  /** Granted scopes, space-separated, as returned by HubSpot. */
  scope?: string;
};

export const DEFAULT_TIMEOUT_MS = 2_000;

export const HUBSPOT_AUTH_ENDPOINT = "https://app.hubspot.com/oauth/authorize";
export const HUBSPOT_TOKEN_ENDPOINT = "https://api.hubapi.com/oauth/v1/token";

/** Contact read/write for lookups + upserts, owners read for routing. */
export const HUBSPOT_SCOPES = [
  "crm.objects.contacts.read",
  "crm.objects.contacts.write",
  "crm.objects.owners.read",
] as const;

export class HubspotAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HubspotAuthError";
  }
}

export function authorizationUrl(config: HubspotOAuthConfig, state: string): string {
  const url = new URL(HUBSPOT_AUTH_ENDPOINT);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", HUBSPOT_SCOPES.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function tokenRequest(
  body: URLSearchParams,
  timeoutMs: number,
): Promise<HubspotTokenSet> {
  let response: Response;
  try {
    response = await fetch(HUBSPOT_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    throw new HubspotAuthError(
      `HubSpot token endpoint unreachable: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  const payload = (await response.json().catch(() => null)) as TokenResponse | null;
  if (!response.ok || !payload?.access_token) {
    throw new HubspotAuthError(
      payload?.error_description ??
        payload?.error ??
        `HubSpot token endpoint returned HTTP ${response.status}.`,
    );
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: new Date(Date.now() + (payload.expires_in ?? 1800) * 1000),
    scope: payload.scope,
  };
}

/** Exchange an authorization code from the callback for a token set. */
export function exchangeCode(
  config: HubspotOAuthConfig,
  code: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<HubspotTokenSet> {
  return tokenRequest(
    new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
    timeoutMs,
  );
}

/**
 * Refresh an access token. HubSpot omits `refresh_token` in the response (the
 * stored one stays valid), so callers must carry it forward themselves.
 */
export function refreshAccessToken(
  config: HubspotOAuthConfig,
  refreshToken: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<HubspotTokenSet> {
  return tokenRequest(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
    }),
    timeoutMs,
  );
}

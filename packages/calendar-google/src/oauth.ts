/**
 * Google Calendar OAuth 2.0 (authorization-code flow) using plain `fetch` —
 * no SDK dependency. Self-hosters supply their own OAuth client; Google
 * requires app verification for calendar scopes on public apps (see README).
 *
 * All network calls take a timeout (default ~2s, per the routing brief) and
 * raise `GoogleAuthError` instead of hanging.
 */

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type GoogleTokenSet = {
  accessToken: string;
  /** Absent on refresh responses — carry the stored one forward. */
  refreshToken?: string;
  expiresAt: Date;
  /** Granted scopes, space-separated, as returned by Google. */
  scope?: string;
};

export const DEFAULT_TIMEOUT_MS = 2_000;

export const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** free/busy read for availability; events write for creating bookings. */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.events",
] as const;

export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

export function authorizationUrl(config: GoogleOAuthConfig, state: string): string {
  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  // Offline + consent guarantee a refresh token is issued on every connect.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
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
): Promise<GoogleTokenSet> {
  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    throw new GoogleAuthError(
      `Google token endpoint unreachable: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  const payload = (await response.json().catch(() => null)) as TokenResponse | null;
  if (!response.ok || !payload?.access_token) {
    throw new GoogleAuthError(
      payload?.error_description ??
        payload?.error ??
        `Google token endpoint returned HTTP ${response.status}.`,
    );
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: new Date(Date.now() + (payload.expires_in ?? 3600) * 1000),
    scope: payload.scope,
  };
}

/** Exchange an authorization code from the callback for a token set. */
export function exchangeCode(
  config: GoogleOAuthConfig,
  code: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<GoogleTokenSet> {
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
 * Refresh an access token. Google omits `refresh_token` in the response (the
 * stored one stays valid), so callers must carry it forward themselves.
 */
export function refreshAccessToken(
  config: GoogleOAuthConfig,
  refreshToken: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<GoogleTokenSet> {
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

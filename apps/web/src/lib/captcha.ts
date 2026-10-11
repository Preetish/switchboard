/**
 * Optional bot check for the public form: Cloudflare Turnstile. Off unless
 * `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are set; the honeypot,
 * disposable-email check, and rate limits apply either way.
 */

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function turnstileSiteKey(): string | null {
  return process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY
    ? process.env.TURNSTILE_SITE_KEY
    : null;
}

/** True when the check is off, or the token verifies with Cloudflare. */
export async function verifyTurnstile(token: unknown, remoteIp: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || !process.env.TURNSTILE_SITE_KEY) return true;
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp !== "unknown") body.set("remoteip", remoteIp);
    const response = await fetch(VERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5_000),
    });
    const result = (await response.json().catch(() => null)) as { success?: boolean } | null;
    return result?.success === true;
  } catch (cause) {
    // Fail closed: when the check is configured, an unverifiable submission
    // is not accepted. The lead sees a retry message.
    console.error(
      `Turnstile verification failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    return false;
  }
}

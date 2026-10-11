/**
 * Startup configuration check (plain ESM so server.mjs can run it before
 * Next.js loads). Every setting is an environment variable;
 * this collects the mistakes that would otherwise surface later as a 500,
 * a silently disabled feature, or an instance anyone can sign into.
 *
 * In production (`NODE_ENV=production`) errors stop the server from
 * starting; in development they are printed as warnings.
 */

/** Values published in this repository's history or docs — never valid secrets. */
const PUBLISHED_SECRETS = new Set([
  "dev-only-demo-secret-change-me",
  "changeme",
  "change-me",
  "secret",
]);
const PUBLISHED_PASSWORDS = new Set(["admin1234", "admin", "password", "changeme"]);

const MIN_PASSWORD_LENGTH = 12;
const MIN_SECRET_LENGTH = 32;

function pair(env, a, b, errors) {
  const hasA = Boolean(env[a]);
  const hasB = Boolean(env[b]);
  if (hasA !== hasB) errors.push(`Set both ${a} and ${b}, or neither.`);
  return hasA && hasB;
}

/** @returns {{ errors: string[], warnings: string[] }} */
export function checkConfig(env = process.env) {
  const errors = [];
  const warnings = [];

  if (!env.DATABASE_URL) errors.push("DATABASE_URL is not set.");

  const secret = env.AUTH_SECRET ?? "";
  if (!secret) {
    errors.push("AUTH_SECRET is not set. Generate one with `openssl rand -hex 32`.");
  } else if (PUBLISHED_SECRETS.has(secret) || secret.length < MIN_SECRET_LENGTH) {
    errors.push(
      `AUTH_SECRET is a published or short value; anyone could forge an admin session. Use at least ${MIN_SECRET_LENGTH} random characters (\`openssl rand -hex 32\`).`,
    );
  }

  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    errors.push("ADMIN_EMAIL and ADMIN_PASSWORD must both be set.");
  } else if (
    PUBLISHED_PASSWORDS.has(env.ADMIN_PASSWORD) ||
    env.ADMIN_PASSWORD.length < MIN_PASSWORD_LENGTH
  ) {
    errors.push(
      `ADMIN_PASSWORD is a published default or shorter than ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }

  const key = env.TOKEN_ENCRYPTION_KEY;
  if (key && !/^[0-9a-f]{64}$/i.test(key)) {
    errors.push("TOKEN_ENCRYPTION_KEY must be 64 hex characters (`openssl rand -hex 32`).");
  }
  const google = pair(env, "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", errors);
  const hubspot = pair(env, "HUBSPOT_CLIENT_ID", "HUBSPOT_CLIENT_SECRET", errors);
  if ((google || hubspot) && !key) {
    errors.push(
      "TOKEN_ENCRYPTION_KEY is required when Google or HubSpot is configured (OAuth tokens are encrypted at rest).",
    );
  }

  const base = env.APP_BASE_URL;
  if (base) {
    let url = null;
    try {
      url = new URL(base);
    } catch {
      errors.push(`APP_BASE_URL is not a URL: ${base}`);
    }
    if (url && url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
      warnings.push(
        "APP_BASE_URL is not https. Serve Switchboard over HTTPS before real leads use it.",
      );
    }
  } else if (google || hubspot) {
    warnings.push(
      "APP_BASE_URL is not set; OAuth redirect URIs use http://localhost:3000.",
    );
  }

  if (env.SMTP_URL) {
    try {
      new URL(env.SMTP_URL);
    } catch {
      errors.push("SMTP_URL is not a URL (expected smtps://user:pass@host:465).");
    }
  }

  if (env.SPEED_TO_LEAD_MINUTES !== undefined && env.SPEED_TO_LEAD_MINUTES !== "") {
    const minutes = Number(env.SPEED_TO_LEAD_MINUTES);
    if (!Number.isInteger(minutes) || minutes < 1) {
      errors.push("SPEED_TO_LEAD_MINUTES must be a whole number of minutes (1 or more).");
    }
  }

  if (env.TRUSTED_PROXY_HOPS !== undefined && env.TRUSTED_PROXY_HOPS !== "") {
    const hops = Number(env.TRUSTED_PROXY_HOPS);
    if (!Number.isInteger(hops) || hops < 0 || hops > 10) {
      errors.push("TRUSTED_PROXY_HOPS must be a whole number from 0 to 10.");
    }
  }

  pair(env, "TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY", errors);

  return { errors, warnings };
}

/** Print the report; in production, refuse to start on errors. */
export function enforceConfig(env = process.env) {
  const { errors, warnings } = checkConfig(env);
  for (const warning of warnings) console.warn(`[switchboard] config: ${warning}`);
  if (errors.length === 0) return;
  const list = errors.map((error) => `  - ${error}`).join("\n");
  if (env.NODE_ENV === "production") {
    throw new Error(
      `Switchboard will not start until its configuration is fixed:\n${list}\nSee .env.example and docs/self-hosting.md.`,
    );
  }
  console.warn(`[switchboard] config problems (fatal in production):\n${list}`);
}

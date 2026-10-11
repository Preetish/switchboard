import { secretsMatch } from "./crypto";

/**
 * The single admin account for self-hosted single-org mode: credentials come
 * from the environment (`ADMIN_EMAIL` + `ADMIN_PASSWORD`), never from the
 * database, so there is no seed secret and nothing to rotate in the UI.
 * Kept separate from `lib/auth.ts` so the check is unit-testable without
 * loading the NextAuth runtime.
 */

export function adminConfigured(): boolean {
  // AUTH_SECRET signs the session cookie — without it sign-in would 500,
  // so the login page treats it as part of the configuration.
  return Boolean(
    process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD && process.env.AUTH_SECRET,
  );
}

export function adminEmail(): string | null {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  return email || null;
}

/**
 * Verify submitted login credentials against the configured admin. Returns
 * the session user on success, null on any mismatch (missing config, wrong
 * email, wrong password). Email comparison is case-insensitive; both
 * comparisons are timing-safe.
 */
export function verifyAdminCredentials(
  email: unknown,
  password: unknown,
): { id: string; email: string; name: string } | null {
  const expectedEmail = adminEmail();
  const expectedPassword = process.env.ADMIN_PASSWORD;
  if (!expectedEmail || !expectedPassword) return null;
  if (typeof email !== "string" || typeof password !== "string") return null;
  const submittedEmail = email.trim().toLowerCase();
  const emailOk = secretsMatch(submittedEmail, expectedEmail);
  const passwordOk = secretsMatch(password, expectedPassword);
  if (!emailOk || !passwordOk) return null;
  return { id: "admin", email: expectedEmail, name: "Admin" };
}

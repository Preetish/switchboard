import { domainFromEmail } from "../domain-from-email.js";

/**
 * Known disposable / throwaway email providers, rejected on submission as
 * part of abuse protection. The list is intentionally small and static —
 * it only needs to catch the common services bots rotate through, not be
 * exhaustive (new providers are best handled by the rate limiter anyway).
 */
export const DISPOSABLE_EMAIL_DOMAINS: readonly string[] = [
  "10minutemail.com",
  "20minutemail.com",
  "33mail.com",
  "anonbox.net",
  "burnermail.io",
  "dispostable.com",
  "fakeinbox.com",
  "getairmail.com",
  "getnada.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "harakirimail.com",
  "inboxbear.com",
  "mail-temporaire.fr",
  "mail7.io",
  "mailcatch.com",
  "maildrop.cc",
  "mailinator.com",
  "mailnesia.com",
  "mailsac.com",
  "moakt.com",
  "mohmal.com",
  "mytemp.email",
  "nowmymail.com",
  "sharklasers.com",
  "spam4.me",
  "temp-mail.io",
  "temp-mail.org",
  "tempail.com",
  "tempinbox.com",
  "tempm.com",
  "tempmail.dev",
  "tempmail.email",
  "tempmail.net",
  "tempmail.plus",
  "tempmailo.com",
  "tempr.email",
  "throwawaymail.com",
  "tmail.ws",
  "trashmail.com",
  "trashmail.de",
  "trbvm.com",
  "trbvn.com",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
  "zetmail.com",
];

const disposableSet = new Set(DISPOSABLE_EMAIL_DOMAINS);

/**
 * True for known disposable email providers. Accepts a full email address or
 * a bare domain, so callers can check either the raw field value or a
 * pre-extracted domain.
 */
export function isDisposableEmail(emailOrDomain: unknown): boolean {
  if (typeof emailOrDomain !== "string") return false;
  const trimmed = emailOrDomain.trim();
  if (!trimmed) return false;
  const domain = trimmed.includes("@") ? domainFromEmail(trimmed) : trimmed.toLowerCase();
  return domain !== null && disposableSet.has(domain);
}

import { domainFromEmail } from "../domain-from-email.js";

/**
 * Free-email providers for the `freeEmail` / `workEmail` conditions. The list
 * is intentionally small and generic; rules can always match specific
 * providers by value with `form.email_domain: { in: [...] }`.
 */
export const FREE_EMAIL_DOMAINS: readonly string[] = [
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "mail.com",
  "yandex.com",
  "zoho.com",
];

const freeSet = new Set(FREE_EMAIL_DOMAINS);

/**
 * True for known free-mail providers. Accepts a full email address or a bare
 * domain, so rules can target either `form.email` or `form.email_domain`.
 */
export function isFreeEmail(emailOrDomain: unknown): boolean {
  if (typeof emailOrDomain !== "string") return false;
  const trimmed = emailOrDomain.trim();
  if (!trimmed) return false;
  const domain = trimmed.includes("@") ? domainFromEmail(trimmed) : trimmed.toLowerCase();
  return domain !== null && freeSet.has(domain);
}

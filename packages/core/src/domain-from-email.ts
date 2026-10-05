/**
 * Extract the registrable email domain for rule conditions like
 * `form.email_domain: { in: [gmail.com] }`.
 *
 * Returns the domain in lowercase without any leading `@`, or `null` when the
 * input is not a plausible email. Free-email providers stay intact on purpose:
 * rule sets match them by value (e.g. `in: [gmail.com, outlook.com]`).
 */
export function domainFromEmail(email: string | null | undefined): string | null {
  if (typeof email !== "string") return null;
  const trimmed = email.trim();
  // Fast reject: split at the last @ (handles quoted local parts containing @).
  const atIndex = trimmed.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === trimmed.length - 1) return null;
  const domain = trimmed.slice(atIndex + 1).toLowerCase();
  // Reject values with spaces, empty labels, or no dot-ish separator.
  if (!domain || /\s/.test(domain)) return null;
  if (!domain.includes(".")) return null;
  const labels = domain.split(".");
  if (labels.some((label) => label.length === 0)) return null;
  return domain;
}

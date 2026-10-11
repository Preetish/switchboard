/**
 * Lead-supplied names end up in emails and alerts sent from the org's own
 * accounts. To keep the form from being used to send arbitrary text (links,
 * "your account is locked" lures) to someone else's inbox, a name is only
 * used when it looks like a name: letters, spaces, and common punctuation,
 * at most 60 characters. Anything else is dropped and the message falls back
 * to a neutral greeting.
 */
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]{0,59}$/u;

export function safeDisplayName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  return NAME_RE.test(name) ? name : null;
}

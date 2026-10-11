import { domainFromEmail } from "../domain-from-email.js";

/**
 * Known disposable / throwaway email providers, rejected on submission as
 * part of abuse protection. Static and deliberately conservative: it covers
 * the widely used throwaway services and their mirror domains, not every
 * provider (new ones are best handled by the rate limits and the optional
 * Turnstile check). Privacy relays that forward to a real inbox
 * (SimpleLogin, Firefox Relay, 33mail, Burner Mail) are intentionally not
 * listed — those leads are reachable.
 */
export const DISPOSABLE_EMAIL_DOMAINS: readonly string[] = [
  "10minemail.com",
  "10minutemail.co.uk",
  "10minutemail.com",
  "10minutemail.net",
  "123-m.com",
  "1secmail.com",
  "1secmail.net",
  "1secmail.org",
  "20minutemail.com",
  "20minutemail.it",
  "anonbox.net",
  "byom.de",
  "cool.fr.nf",
  "courriel.fr.nf",
  "discard.email",
  "discardmail.com",
  "discardmail.de",
  "dispostable.com",
  "dropmail.me",
  "einrot.com",
  "email-fake.com",
  "emailfake.com",
  "emailondeck.com",
  "emlhub.com",
  "emlpro.com",
  "emltmp.com",
  "fake-mail.net",
  "fakeinbox.com",
  "fakemail.net",
  "fakemailgenerator.com",
  "getairmail.com",
  "getnada.com",
  "grr.la",
  "guerrillamail.biz",
  "guerrillamail.com",
  "guerrillamail.de",
  "guerrillamail.info",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "harakirimail.com",
  "inboxbear.com",
  "inboxkitten.com",
  "incognitomail.org",
  "jetable.fr.nf",
  "jetable.org",
  "linshiyouxiang.net",
  "mail-temporaire.fr",
  "mail.gw",
  "mail.tm",
  "mail7.io",
  "mailcatch.com",
  "maildrop.cc",
  "mailinater.com",
  "mailinator.com",
  "mailinator.net",
  "mailinator2.com",
  "mailnesia.com",
  "mailnull.com",
  "mailpoof.com",
  "mailsac.com",
  "mega.zik.dj",
  "mintemail.com",
  "moakt.com",
  "mohmal.com",
  "moncourrier.fr.nf",
  "monemail.fr.nf",
  "monmail.fr.nf",
  "mt2015.com",
  "mytemp.email",
  "mytrashmail.com",
  "nada.email",
  "nomail.xl.cx",
  "nospam.ze.tc",
  "nowmymail.com",
  "pokemail.net",
  "sharklasers.com",
  "spam4.me",
  "spambox.us",
  "spamex.com",
  "spamfree24.org",
  "spamgourmet.com",
  "spamherelots.com",
  "spaml.de",
  "speed.1s.fr",
  "temp-mail.io",
  "temp-mail.org",
  "tempail.com",
  "tempinbox.com",
  "tempm.com",
  "tempmail.com",
  "tempmail.dev",
  "tempmail.email",
  "tempmail.net",
  "tempmail.plus",
  "tempmailo.com",
  "temporary-mail.net",
  "tempr.email",
  "throwawaymail.com",
  "tmail.ws",
  "tmails.net",
  "tmpmail.net",
  "tmpmail.org",
  "trash-mail.com",
  "trashmail.com",
  "trashmail.de",
  "trashmail.io",
  "trashmail.net",
  "trbvm.com",
  "trbvn.com",
  "wegwerfmail.de",
  "wegwerfmail.net",
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

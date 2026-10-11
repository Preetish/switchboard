/**
 * Marketing attribution for a lead: campaign parameters, ad click IDs, and
 * where the visit came from.
 *
 * Shape (stored on the submission, readable by rules as `attribution.*`):
 *
 *   {
 *     utm_source, utm_medium, …, gclid, …,   // last touch: the visit that converted
 *     referrer, landing_page, captured_at,
 *     page_url,                              // the page the form was on
 *     first: { …same touch fields },         // first touch
 *     cookies: { ga, fbp, fbc, gcl_aw, hubspotutk }  // only with consent
 *   }
 *
 * Browser-safe (no dependencies): the hosted form imports it, and the
 * server runs `sanitizeAttribution` on whatever the browser sends.
 */

export const CAMPAIGN_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
] as const;

/** Ad-platform click IDs: Google (gclid, and gbraid/wbraid for iOS), Meta, Microsoft, LinkedIn, TikTok, X. */
export const CLICK_ID_PARAMS = [
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "msclkid",
  "li_fat_id",
  "ttclid",
  "twclid",
] as const;

/** Query parameters captured from the landing URL. */
export const URL_PARAMS = [...CAMPAIGN_PARAMS, ...CLICK_ID_PARAMS] as const;

const URL_FIELDS = ["referrer", "landing_page"] as const;
export const TOUCH_FIELDS = [...URL_PARAMS, ...URL_FIELDS, "captured_at"] as const;

/**
 * First-party cookie IDs the embed reads on the host page, only after the
 * site signals consent: Google Analytics client id (`_ga`), Meta browser and
 * click ids (`_fbp`, `_fbc`), Google Ads click (`_gcl_aw`), HubSpot visitor
 * token (`hubspotutk`).
 */
export const COOKIE_IDS = ["ga", "fbp", "fbc", "gcl_aw", "hubspotutk"] as const;

export type TouchField = (typeof TOUCH_FIELDS)[number];
export type CookieId = (typeof COOKIE_IDS)[number];
export type Touch = Partial<Record<TouchField, string>>;
export type Attribution = Touch & {
  page_url?: string;
  first?: Touch;
  cookies?: Partial<Record<CookieId, string>>;
};

/** Every path a rule may read under `attribution.` (for config validation). */
export const ATTRIBUTION_RULE_PATHS: readonly string[] = [
  ...TOUCH_FIELDS.map((field) => `attribution.${field}`),
  "attribution.page_url",
  ...TOUCH_FIELDS.map((field) => `attribution.first.${field}`),
];

const MAX_VALUE_LENGTH = 500;
const MAX_URL_LENGTH = 2000;

/**
 * Keep only the origin and path of a URL. Query strings can carry anything
 * (including a visitor's email), and the campaign parameters are captured
 * separately, so they aren't needed here.
 */
export function stripUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return `${url.origin}${url.pathname}`.slice(0, MAX_URL_LENGTH);
  } catch {
    return undefined;
  }
}

function cleanValue(field: string, value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (field === "referrer" || field === "landing_page" || field === "page_url") {
    return stripUrl(trimmed);
  }
  if (field === "captured_at") {
    const time = Date.parse(trimmed);
    return Number.isNaN(time) ? undefined : new Date(time).toISOString();
  }
  // Printable text only: no control characters in CRM fields or CSVs.
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return undefined;
  return trimmed.slice(0, MAX_VALUE_LENGTH);
}

function cleanTouch(raw: unknown): Touch | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const source = raw as Record<string, unknown>;
  const touch: Touch = {};
  for (const field of TOUCH_FIELDS) {
    const value = cleanValue(field, source[field]);
    if (value !== undefined) touch[field] = value;
  }
  return Object.keys(touch).length > 0 ? touch : undefined;
}

/**
 * Validate attribution sent by a browser: allowlisted keys only, strings
 * only, bounded lengths, URLs reduced to origin + path. Anything else is
 * dropped silently — attribution is best-effort and never blocks a lead.
 * Returns null when nothing usable remains.
 */
export function sanitizeAttribution(raw: unknown): Attribution | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const result: Attribution = { ...cleanTouch(source) };
  const pageUrl = cleanValue("page_url", source.page_url);
  if (pageUrl) result.page_url = pageUrl;
  const first = cleanTouch(source.first);
  if (first) result.first = first;
  if (source.cookies && typeof source.cookies === "object" && !Array.isArray(source.cookies)) {
    const cookies: Partial<Record<CookieId, string>> = {};
    for (const id of COOKIE_IDS) {
      const value = cleanValue(id, (source.cookies as Record<string, unknown>)[id]);
      if (value !== undefined) cookies[id] = value;
    }
    if (Object.keys(cookies).length > 0) result.cookies = cookies;
  }
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * The touch described by a page URL and its referrer: campaign parameters
 * and click IDs from the query string, plus where the visitor came from.
 * Returns null for a visit with neither (direct traffic, or a click within
 * the same site), so it doesn't overwrite an earlier real touch.
 */
export function touchFromUrl(
  pageUrl: string,
  referrer: string,
  now: Date = new Date(),
): Touch | null {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return null;
  }
  const touch: Touch = {};
  for (const param of URL_PARAMS) {
    const value = url.searchParams.get(param);
    if (value) touch[param] = value.slice(0, MAX_VALUE_LENGTH);
  }
  let externalReferrer: string | undefined;
  try {
    if (referrer && new URL(referrer).hostname !== url.hostname) externalReferrer = referrer;
  } catch {
    // An unparseable referrer is no referrer.
  }
  if (Object.keys(touch).length === 0 && !externalReferrer) return null;
  if (externalReferrer) touch.referrer = stripUrl(externalReferrer);
  touch.landing_page = stripUrl(pageUrl);
  touch.captured_at = now.toISOString();
  return touch;
}

/** The first click ID present (for one "click_id" column in exports). */
export function clickIdOf(attribution: Touch | null | undefined): string | null {
  if (!attribution) return null;
  for (const param of CLICK_ID_PARAMS) {
    const value = attribution[param];
    if (value) return `${param}:${value}`;
  }
  return null;
}

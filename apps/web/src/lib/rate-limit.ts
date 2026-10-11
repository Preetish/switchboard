import { CLIENT_IP_HEADER } from "../../client-ip.mjs";

/**
 * In-memory sliding-window rate limiting for the public, lead-facing routes
 * and the admin login. Chosen over Postgres-backed counters to keep every
 * submit cheap (one `docker compose up` service, no Redis): the map holds at
 * most MAX_BUCKETS identities and evicts the least recently used one in O(1)
 * when full, so a flood of unique addresses can't grow memory or CPU.
 * Limits are per instance; a multi-instance deployment gets per-instance
 * budgets (documented limitation for v0.1 self-hosting).
 */

export type RateLimitRule = { limit: number; windowMs: number };

/** Public lead-facing surfaces and the admin login, keyed by route purpose. */
export const RATE_LIMITS = {
  submit: { limit: 30, windowMs: 5 * 60_000 },
  delete: { limit: 10, windowMs: 5 * 60_000 },
  booking: { limit: 20, windowMs: 5 * 60_000 },
  availability: { limit: 60, windowMs: 5 * 60_000 },
  login: { limit: 10, windowMs: 5 * 60_000 },
  /**
   * Ceiling on login attempts across every address. There is one admin
   * account, so attempts spread over many addresses are still capped.
   */
  loginGlobal: { limit: 100, windowMs: 15 * 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

const buckets = new Map<string, number[]>();

/** Most identities tracked at once; the least recently used is evicted. */
const MAX_BUCKETS = 10_000;

/**
 * The caller's address for rate-limit keying, as resolved by server.mjs from
 * the socket and `TRUSTED_PROXY_HOPS` — never read from `X-Forwarded-For`
 * here, because clients can set that header to anything.
 */
export function clientIp(request: Request): string {
  return request.headers.get(CLIENT_IP_HEADER)?.trim() || "unknown";
}

/**
 * Consume one slot for `name` from `identity` (usually the client address).
 * Returns whether the request is allowed and, when it is not, how long
 * until the window frees up (for the `Retry-After` header).
 */
export function checkRateLimit(
  name: RateLimitName,
  identity: string,
  now: number = Date.now(),
): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  const key = `${name}:${identity}`;
  const rule = RATE_LIMITS[name];
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < rule.windowMs);
  // Re-insert so Map order tracks recency (oldest first) for eviction.
  buckets.delete(key);
  if (hits.length >= rule.limit) {
    buckets.set(key, hits);
    const oldest = hits[0]!;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + rule.windowMs - now) / 1000)),
    };
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > MAX_BUCKETS) {
    const lru = buckets.keys().next().value;
    if (lru !== undefined) buckets.delete(lru);
  }
  return { allowed: true };
}

/** A 429 JSON response with `Retry-After`, shared by the public routes. */
export function tooManyRequests(retryAfterSeconds: number, body: unknown): Response {
  return Response.json(body, {
    status: 429,
    headers: { "Retry-After": String(retryAfterSeconds) },
  });
}

/** Test-only: drop all buckets so tests start from a clean slate. */
export function resetRateLimits(): void {
  buckets.clear();
}

/** Test-only: number of tracked identities. */
export function trackedIdentities(): number {
  return buckets.size;
}

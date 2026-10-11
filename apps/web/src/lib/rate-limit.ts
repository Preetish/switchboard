/**
 * In-memory sliding-window rate limiting for the public, lead-facing routes.
 * Chosen over Postgres-backed counters to keep every submit cheap (one
 * `docker compose up` service, no Redis — docs/decisions.md): the map is
 * pruned on each check and swept when it grows, so memory stays bounded.
 * Limits are per instance; a multi-instance deployment gets per-instance
 * budgets (documented limitation for v0.1 self-hosting).
 */

export type RateLimitRule = { limit: number; windowMs: number };

/** Public lead-facing surfaces, keyed by route purpose. */
export const RATE_LIMITS = {
  submit: { limit: 30, windowMs: 5 * 60_000 },
  delete: { limit: 10, windowMs: 5 * 60_000 },
  booking: { limit: 20, windowMs: 5 * 60_000 },
  availability: { limit: 60, windowMs: 5 * 60_000 },
  login: { limit: 10, windowMs: 5 * 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

const buckets = new Map<string, number[]>();

/** Largest window across the rules; buckets older than this are garbage. */
const MAX_WINDOW_MS = Math.max(...Object.values(RATE_LIMITS).map((r) => r.windowMs));
/** Sweep threshold so a flood of unique IPs cannot grow the map unbounded. */
const MAX_BUCKETS = 10_000;

/**
 * The caller's IP for rate-limit keying: first hop of `x-forwarded-for`
 * (set by the reverse proxy a self-hoster puts in front), then
 * `x-real-ip`, else "unknown" (direct local access).
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Consume one slot for `name` from `identity` (usually the client IP).
 * Returns whether the request is allowed and, when it is not, how long
 * until the window frees up (for the `Retry-After` header).
 */
export function checkRateLimit(
  name: RateLimitName,
  identity: string,
  now: number = Date.now(),
): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  if (buckets.size >= MAX_BUCKETS) sweep(now);
  const key = `${name}:${identity}`;
  const rule = RATE_LIMITS[name];
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < rule.windowMs);
  if (hits.length >= rule.limit) {
    buckets.set(key, hits);
    const oldest = Math.min(...hits);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + rule.windowMs - now) / 1000)),
    };
  }
  hits.push(now);
  buckets.set(key, hits);
  return { allowed: true };
}

function sweep(now: number): void {
  for (const [key, hits] of buckets) {
    const alive = hits.filter((t) => now - t < MAX_WINDOW_MS);
    if (alive.length === 0) buckets.delete(key);
    else buckets.set(key, alive);
  }
}

/** Test-only: drop all buckets so tests start from a clean slate. */
export function resetRateLimits(): void {
  buckets.clear();
}

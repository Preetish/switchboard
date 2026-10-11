/**
 * Resolve the real client address for rate limiting.
 *
 * `X-Forwarded-For` is client-controlled unless a proxy you run rewrites it,
 * so it is only trusted for as many hops as you configure
 * (`TRUSTED_PROXY_HOPS`). Each trusted proxy appends the address it received
 * the request from, so with N trusted proxies the client is the Nth entry
 * from the right; anything further left was supplied by the client.
 *
 * Used by server.mjs (which knows the socket address) and unit-tested
 * directly.
 */

/** Header the custom server sets after stripping any incoming copy. */
export const CLIENT_IP_HEADER = "x-switchboard-client-ip";

export function trustedProxyHops(raw = process.env.TRUSTED_PROXY_HOPS) {
  const hops = Number(raw ?? 0);
  return Number.isInteger(hops) && hops >= 0 && hops <= 10 ? hops : 0;
}

export function resolveClientIp(socketAddress, forwardedFor, hops) {
  const peer = normalize(socketAddress) ?? "unknown";
  if (hops === 0) return peer;
  const chain = String(forwardedFor ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  // Fewer entries than trusted hops means the header was not set by our
  // proxies (misconfiguration); the socket peer is the safest key.
  return normalize(chain[chain.length - hops]) ?? peer;
}

/** Strip the IPv4-mapped IPv6 prefix so 1.2.3.4 and ::ffff:1.2.3.4 share a bucket. */
function normalize(address) {
  if (!address) return null;
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

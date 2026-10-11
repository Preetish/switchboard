import { describe, expect, it } from "vitest";
import { resolveClientIp, trustedProxyHops } from "../client-ip.mjs";

describe("resolveClientIp", () => {
  it("ignores X-Forwarded-For entirely when no proxy is trusted", () => {
    expect(resolveClientIp("203.0.113.9", "1.1.1.1", 0)).toBe("203.0.113.9");
  });

  it("takes the address the trusted proxy appended, not the client's forgery", () => {
    // Client sent "X-Forwarded-For: 6.6.6.6"; Caddy appended the real address.
    expect(resolveClientIp("10.0.0.2", "6.6.6.6, 198.51.100.7", 1)).toBe("198.51.100.7");
  });

  it("walks one entry further left per extra trusted hop", () => {
    // Cloudflare -> nginx -> app: nginx appended Cloudflare's edge address.
    expect(resolveClientIp("10.0.0.2", "6.6.6.6, 198.51.100.7, 172.70.1.1", 2)).toBe(
      "198.51.100.7",
    );
  });

  it("falls back to the socket peer when the chain is shorter than the hops", () => {
    expect(resolveClientIp("10.0.0.2", undefined, 1)).toBe("10.0.0.2");
    expect(resolveClientIp("10.0.0.2", "", 2)).toBe("10.0.0.2");
  });

  it("normalizes IPv4-mapped IPv6 addresses", () => {
    expect(resolveClientIp("::ffff:203.0.113.9", undefined, 0)).toBe("203.0.113.9");
  });

  it("never returns an empty key", () => {
    expect(resolveClientIp(undefined, undefined, 0)).toBe("unknown");
  });
});

describe("trustedProxyHops", () => {
  it("defaults to 0 and rejects nonsense", () => {
    expect(trustedProxyHops(undefined)).toBe(0);
    expect(trustedProxyHops("2")).toBe(2);
    expect(trustedProxyHops("-1")).toBe(0);
    expect(trustedProxyHops("abc")).toBe(0);
  });
});

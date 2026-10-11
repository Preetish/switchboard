import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, clientIp, resetRateLimits } from "@/lib/rate-limit";

const T0 = 1_700_000_000_000;

describe("checkRateLimit", () => {
  beforeEach(() => {
    resetRateLimits();
  });

  afterEach(() => {
    resetRateLimits();
  });

  it("allows requests up to the limit, then blocks", () => {
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit("delete", "1.2.3.4", T0)).toEqual({ allowed: true });
    }
    const blocked = checkRateLimit("delete", "1.2.3.4", T0 + 1);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    }
  });

  it("keeps identities isolated", () => {
    for (let i = 0; i < 10; i++) checkRateLimit("delete", "1.2.3.4", T0);
    expect(checkRateLimit("delete", "1.2.3.4", T0)).toEqual({
      allowed: false,
      retryAfterSeconds: 300,
    });
    expect(checkRateLimit("delete", "5.6.7.8", T0)).toEqual({ allowed: true });
  });

  it("keeps purposes isolated", () => {
    for (let i = 0; i < 30; i++) checkRateLimit("submit", "1.2.3.4", T0);
    expect(checkRateLimit("submit", "1.2.3.4", T0)).toEqual({
      allowed: false,
      retryAfterSeconds: 300,
    });
    expect(checkRateLimit("booking", "1.2.3.4", T0)).toEqual({ allowed: true });
  });

  it("reports the time until the oldest hit leaves the window", () => {
    for (let i = 0; i < 10; i++) checkRateLimit("delete", "1.2.3.4", T0);
    const blocked = checkRateLimit("delete", "1.2.3.4", T0 + 2_500);
    // Oldest hit leaves the window at T0+300s; ceil of 297.5s remaining.
    expect(blocked).toEqual({ allowed: false, retryAfterSeconds: 298 });
  });

  it("frees the window once hits age out", () => {
    for (let i = 0; i < 10; i++) checkRateLimit("delete", "1.2.3.4", T0);
    expect(checkRateLimit("delete", "1.2.3.4", T0 + 1)).toEqual({
      allowed: false,
      // ceil(299.999) — the full window minus 1ms, rounded up.
      retryAfterSeconds: 300,
    });
    // All ten hits are now older than the 5-minute window.
    const again = checkRateLimit("delete", "1.2.3.4", T0 + 5 * 60_000 + 1);
    expect(again).toEqual({ allowed: true });
  });

  it("only counts hits inside the window", () => {
    // Three old hits age out; seven recent ones keep the bucket under the limit.
    for (let i = 0; i < 3; i++) checkRateLimit("delete", "1.2.3.4", T0 + i * 1000);
    for (let i = 0; i < 7; i++) checkRateLimit("delete", "1.2.3.4", T0 + 5 * 60_000);
    expect(checkRateLimit("delete", "1.2.3.4", T0 + 5 * 60_000)).toEqual({
      allowed: true,
    });
  });
});

describe("clientIp", () => {
  const request = (headers: Record<string, string>) =>
    new Request("https://sb.example/api", { headers });

  it("prefers the first x-forwarded-for hop", () => {
    expect(clientIp(request({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe(
      "203.0.113.7",
    );
  });

  it("falls back to x-real-ip, then unknown", () => {
    expect(clientIp(request({ "x-real-ip": "198.51.100.9" }))).toBe("198.51.100.9");
    expect(clientIp(request({}))).toBe("unknown");
  });
});

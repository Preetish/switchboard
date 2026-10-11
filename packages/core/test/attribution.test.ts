import { describe, expect, it } from "vitest";
import {
  ATTRIBUTION_RULE_PATHS,
  buildRuleInputs,
  clickIdOf,
  evaluate,
  sanitizeAttribution,
  touchFromUrl,
  validateRuleSet,
} from "../src/index.js";

const NOW = new Date("2026-10-11T12:00:00Z");

describe("touchFromUrl", () => {
  it("captures campaign params and click IDs, and keeps the landing page without its query", () => {
    const touch = touchFromUrl(
      "https://acme.com/pricing?utm_source=google&utm_medium=cpc&utm_campaign=spring&gclid=Cj0abc&email=leak@x.com",
      "https://www.google.com/",
      NOW,
    );
    expect(touch).toEqual({
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "spring",
      gclid: "Cj0abc",
      referrer: "https://www.google.com/",
      landing_page: "https://acme.com/pricing",
      captured_at: NOW.toISOString(),
    });
  });

  it("captures Google's iOS click IDs and other platforms' IDs", () => {
    const touch = touchFromUrl(
      "https://acme.com/?gbraid=g1&wbraid=w1&fbclid=f1&msclkid=m1&li_fat_id=l1&ttclid=t1",
      "",
      NOW,
    );
    expect(touch).toMatchObject({ gbraid: "g1", wbraid: "w1", fbclid: "f1", msclkid: "m1", li_fat_id: "l1", ttclid: "t1" });
  });

  it("records an external referrer with no parameters as a touch (organic, referral)", () => {
    expect(touchFromUrl("https://acme.com/blog/post", "https://news.ycombinator.com/", NOW)).toEqual({
      referrer: "https://news.ycombinator.com/",
      landing_page: "https://acme.com/blog/post",
      captured_at: NOW.toISOString(),
    });
  });

  it("ignores direct visits and clicks within the same site", () => {
    expect(touchFromUrl("https://acme.com/demo", "", NOW)).toBeNull();
    expect(touchFromUrl("https://acme.com/demo", "https://acme.com/pricing", NOW)).toBeNull();
  });
});

describe("sanitizeAttribution", () => {
  it("keeps allowlisted fields and drops everything else", () => {
    const clean = sanitizeAttribution({
      utm_source: " linkedin ",
      gclid: "abc",
      evil: "<script>",
      page_url: "https://acme.com/demo?token=secret",
      first: { utm_source: "google", captured_at: "2026-09-01T10:00:00Z", junk: 1 },
      cookies: { ga: "GA1.2.111.222", session: "steal-me" },
    });
    expect(clean).toEqual({
      utm_source: "linkedin",
      gclid: "abc",
      page_url: "https://acme.com/demo",
      first: { utm_source: "google", captured_at: "2026-09-01T10:00:00.000Z" },
      cookies: { ga: "GA1.2.111.222" },
    });
  });

  it("rejects non-strings, control characters, non-http URLs, and bad dates", () => {
    expect(
      sanitizeAttribution({
        utm_source: 42,
        utm_medium: "cpc\r\n=cmd",
        referrer: "javascript:alert(1)",
        captured_at: "yesterday",
      }),
    ).toBeNull();
  });

  it("caps value lengths", () => {
    const clean = sanitizeAttribution({ utm_campaign: "x".repeat(5000) });
    expect(clean?.utm_campaign).toHaveLength(500);
  });

  it("returns null for nothing usable", () => {
    expect(sanitizeAttribution(null)).toBeNull();
    expect(sanitizeAttribution(["utm_source"])).toBeNull();
    expect(sanitizeAttribution({})).toBeNull();
  });
});

describe("clickIdOf", () => {
  it("names the first click ID present", () => {
    expect(clickIdOf({ fbclid: "f", gclid: "g" })).toBe("gclid:g");
    expect(clickIdOf({ utm_source: "x" })).toBeNull();
  });
});

describe("rules on attribution", () => {
  it("routes paid search differently from everything else", () => {
    const result = validateRuleSet({
      rules: [
        {
          name: "Paid search",
          when: { "attribution.utm_medium": { in: ["cpc", "ppc"] } },
          route: { team: "fast", strategy: "round_robin" },
        },
        {
          name: "Came from a LinkedIn ad first",
          when: { "attribution.first.utm_source": "linkedin" },
          route: { team: "abm", strategy: "round_robin" },
        },
      ],
      fallback: { team: "default", strategy: "round_robin" },
    });
    if (!result.ok) throw new Error(result.errors.join("\n"));
    const route = (attribution: Parameters<typeof buildRuleInputs>[3]) =>
      evaluate(result.ruleSet, buildRuleInputs([], {}, null, attribution)).matchedRule;
    expect(route({ utm_medium: "CPC" })).toBe("Paid search");
    expect(route({ utm_medium: "email", first: { utm_source: "linkedin" } })).toBe(
      "Came from a LinkedIn ad first",
    );
    expect(route(null)).toBeNull();
  });

  it("publishes the readable paths for config validation", () => {
    expect(ATTRIBUTION_RULE_PATHS).toContain("attribution.gclid");
    expect(ATTRIBUTION_RULE_PATHS).toContain("attribution.first.utm_campaign");
    expect(ATTRIBUTION_RULE_PATHS).not.toContain("attribution.cookies.ga");
  });
});

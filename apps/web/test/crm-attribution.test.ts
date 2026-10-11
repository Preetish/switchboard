import { describe, expect, it } from "vitest";
import { attributionToHubspotProperties } from "@/lib/crm";

describe("attributionToHubspotProperties", () => {
  const attribution = {
    utm_source: "google",
    gclid: "Cj0abc",
    first: { utm_campaign: "spring" },
    cookies: { ga: "GA1.2.1.2" },
  };

  it("maps last-touch, first-touch, and cookie fields to the configured properties", () => {
    expect(
      attributionToHubspotProperties(attribution, {
        utm_source: "utm_source",
        gclid: "hs_google_click_id",
        "first.utm_campaign": "first_utm_campaign",
        "cookies.ga": "ga_client_id",
        utm_medium: "utm_medium",
      }),
    ).toEqual({
      utm_source: "google",
      hs_google_click_id: "Cj0abc",
      first_utm_campaign: "spring",
      ga_client_id: "GA1.2.1.2",
    });
  });

  it("writes nothing without attribution or without a mapping", () => {
    expect(attributionToHubspotProperties(null, { utm_source: "utm_source" })).toEqual({});
    expect(attributionToHubspotProperties(attribution, {})).toEqual({});
  });
});

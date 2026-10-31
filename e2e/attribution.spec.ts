import { expect, test } from "@playwright/test";

/**
 * Attribution through the real embed: a visitor lands on a (fake) host site
 * from a Google ad, clicks through to the demo page, and books inside the
 * embedded form. The submission must carry the ad's parameters, and the
 * host page's dataLayer must see the conversions.
 */

// *.localhost is loopback, so Chrome allows it to load the local app
// (a public-looking host would be blocked by Private Network Access); it is
// still a different origin from the app, like a real customer site.
const HOST = "http://acme.localhost";

test("the embed passes landing-page attribution through and reports conversions", async ({
  page,
  baseURL,
}) => {
  const hostPage = (body: string) => `<!doctype html><html><head><title>Host</title></head><body>${body}</body></html>`;
  await page.route(`${HOST}/**`, (route) => {
    const url = new URL(route.request().url());
    const html =
      url.pathname === "/demo"
        ? hostPage(`<h1>Book a demo</h1>
            <div data-switchboard-form="book-a-demo"></div>
            <script src="${baseURL}/embed.js" data-switchboard-consent="granted"></script>`)
        : hostPage(`<a href="/demo">Talk to sales</a>
            <script src="${baseURL}/embed.js" data-switchboard-consent="granted"></script>`);
    return route.fulfill({ contentType: "text/html", body: html });
  });

  // Landing page from an ad, then an internal click to the demo page.
  await page.goto(`${HOST}/pricing?utm_source=google&utm_medium=cpc&utm_campaign=spring&gclid=Cj0e2e`, {
    referer: "https://www.google.com/",
  });
  await page.getByRole("link", { name: "Talk to sales" }).click();
  await page.waitForURL(`${HOST}/demo`);

  const form = page.frameLocator("iframe[title='Book a meeting']");
  await form.getByLabel("Full name").fill("Priya Shah");
  await form.getByLabel("Work email").fill(`priya-${Date.now()}@globex.test`);
  await form.getByLabel("Company size").fill("1200");
  await form.getByLabel("Country").click();
  await form.getByRole("option", { name: "US", exact: true }).click();
  await form.getByLabel(/I agree/).check();

  const submitted = page.waitForRequest((request) => request.url().includes("/submit"));
  await form.getByRole("button", { name: "Find a time" }).click();
  const payload = (await submitted).postDataJSON() as { attribution: Record<string, unknown> };
  expect(payload.attribution).toMatchObject({
    utm_source: "google",
    utm_medium: "cpc",
    utm_campaign: "spring",
    gclid: "Cj0e2e",
    landing_page: `${HOST}/pricing`,
    page_url: `${HOST}/demo`,
    first: { utm_source: "google", gclid: "Cj0e2e" },
  });

  const slots = form.getByRole("group", { name: "Choose a time" }).getByRole("button");
  await slots.first().click();
  await form.getByRole("button", { name: /^Book / }).click();
  await expect(form.getByText("Booked")).toBeVisible();

  await expect
    .poll(() => page.evaluate(() => (window as unknown as { dataLayer?: { event: string }[] }).dataLayer?.map((e) => e.event)))
    .toEqual(["switchboard_submitted", "switchboard_booked"]);
  const events = await page.evaluate(
    () => (window as unknown as { dataLayer: Record<string, unknown>[] }).dataLayer,
  );
  expect(events[1]).toEqual({
    event: "switchboard_booked",
    switchboard_form: "book-a-demo",
    switchboard_outcome: "route_team",
  });
});

test("a direct link to the hosted form keeps its UTMs", async ({ page }) => {
  await page.goto("/f/book-a-demo?utm_source=newsletter&utm_medium=email&utm_campaign=october");
  await page.getByLabel("Full name").fill("Sam Lee");
  await page.getByLabel("Work email").fill(`sam-${Date.now()}@initech.test`);
  await page.getByLabel("Company size").fill("40");
  await page.getByLabel("Country").click();
  await page.getByRole("option", { name: "US", exact: true }).click();
  await page.getByLabel(/I agree/).check();
  const submitted = page.waitForRequest((request) => request.url().includes("/submit"));
  await page.getByRole("button", { name: "Find a time" }).click();
  const payload = (await submitted).postDataJSON() as { attribution: Record<string, unknown> };
  expect(payload.attribution).toMatchObject({
    utm_source: "newsletter",
    utm_medium: "email",
    utm_campaign: "october",
  });
});

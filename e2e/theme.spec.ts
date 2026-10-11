import { expect, test } from "@playwright/test";

/** Matching a customer's site: embed-snippet overrides and the admin preview. */

test("embed snippet settings restyle the form to match the host page", async ({ page, baseURL }) => {
  await page.route("http://acme.localhost/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><body style="background:#101820">
        <div data-switchboard-form="book-a-demo" data-switchboard-accent="#F5A623"
             data-switchboard-scheme="dark" data-switchboard-layout="plain"
             data-switchboard-radius="2" data-switchboard-background="nope"></div>
        <script src="${baseURL}/embed.js" data-switchboard-consent="granted"></script></body>`,
    }),
  );
  await page.goto("http://acme.localhost/demo");
  const button = page.frameLocator("iframe").getByRole("button", { name: "Find a time" });
  await expect(button).toBeVisible();
  const style = await button.evaluate((el) => {
    const cs = getComputedStyle(el);
    const card = getComputedStyle(el.closest("section")!);
    return {
      background: cs.backgroundColor,
      color: cs.color,
      radius: cs.borderTopLeftRadius,
      cardBorder: card.borderTopColor,
      scheme: getComputedStyle(document.querySelector("main")!).colorScheme,
    };
  });
  expect(style).toEqual({
    background: "rgb(245, 166, 35)",
    color: "rgb(22, 19, 14)", // dark text: white wouldn't be readable on amber
    radius: "2px",
    cardBorder: "rgba(0, 0, 0, 0)", // plain layout: no panel
    scheme: "dark",
  });
});

test("the admin preview shows the form but can't submit", async ({ page }) => {
  await page.goto("/f/book-a-demo?embed=1&preview=1");
  await expect(page.getByText("Preview: submitting is turned off here.")).toBeVisible();
  let submitted = false;
  page.on("request", (request) => {
    if (request.url().includes("/submit")) submitted = true;
  });
  await page.getByRole("button", { name: "Find a time" }).click();
  await page.waitForTimeout(500);
  expect(submitted).toBe(false);
});

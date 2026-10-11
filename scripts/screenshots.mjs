/**
 * Regenerate the README screenshots from a running instance with the demo
 * loaded (`npm run demo:load`, then `npm run build && npm start -w @switchboard/web`).
 *
 *   BASE_URL=http://localhost:3000 ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/screenshots.mjs
 */
import { chromium } from "@playwright/test";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const out = new URL("../docs/images/", import.meta.url).pathname;
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 760, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: "light",
  timezoneId: "America/New_York",
  extraHTTPHeaders: { "x-forwarded-for": "203.0.113.50" },
});
const page = await context.newPage();
const shot = (name, locator) =>
  (locator ?? page.locator("main section").first()).screenshot({ path: `${out}${name}.png` });

await page.goto(`${base}/f/book-a-demo`);
await page.getByLabel("Full name").fill("Priya Shah");
await page.getByLabel("Work email").fill("priya@globex.example");
await page.getByLabel("Company size").fill("1200");
await page.getByLabel("Country").selectOption("US");
await page.getByLabel(/I agree/).check();
await shot("1-form");
await page.getByRole("button", { name: "Find a time" }).click();
const slots = page.getByRole("group", { name: "Choose a time" }).getByRole("button");
await slots.nth(2).click();
await shot("2-pick-a-time");
await page.getByRole("button", { name: /^Book / }).click();
await page.getByText("Booked").waitFor();
await shot("3-booked");

if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  await page.setViewportSize({ width: 1180, height: 760 });
  await page.goto(`${base}/login`);
  await page.getByLabel("Email").fill(process.env.ADMIN_EMAIL);
  await page.getByLabel("Password").fill(process.env.ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/routing-log/);
  await page.screenshot({ path: `${out}4-routing-log.png` });
  await page.goto(`${base}/setup`);
  await page.screenshot({ path: `${out}5-setup.png`, fullPage: false });
}
await browser.close();
console.log(`Screenshots written to ${out}`);

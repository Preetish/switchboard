import { expect, test, type Page } from "@playwright/test";

/**
 * The headline flow on the demo form (examples/switchboard.demo.yaml):
 * a team-sized lead is routed to a rep and books on the same page; a
 * one-person company is sent to self-serve with an explanation.
 */

let counter = 0;
/** A distinct address per lead, and a distinct client address for rate limits. */
async function fillForm(page: Page, email: string, size: string) {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${++counter % 250}` });
  await page.goto("/f/book-a-demo");
  await expect(page.getByRole("heading", { name: "Book a demo" })).toBeVisible();
  await page.getByLabel("Full name").fill("Priya Shah");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Company size").fill(size);
  await page.getByLabel("Country").selectOption("US");
  await page.getByLabel(/I agree/).check();
  await page.getByRole("button", { name: "Find a time" }).click();
}

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test("a qualified lead picks a time and books it on the same page", async ({ page }) => {
  await fillForm(page, `priya-${unique()}@globex.test`, "1200");

  await expect(page.getByRole("heading", { name: /Pick a time with/ })).toBeVisible();
  const slots = page.getByRole("group", { name: "Choose a time" }).getByRole("button");
  await expect(slots.first()).toBeVisible();
  const time = (await slots.first().innerText()).trim();
  await slots.first().click();

  const book = page.getByRole("button", { name: new RegExp(`^Book .* at ${time}$`) });
  await expect(book).toBeEnabled();
  await book.click();

  await expect(page.getByText("Booked")).toBeVisible();
  await expect(page.getByRole("heading", { name: /You're meeting/ })).toBeVisible();
  await expect(page.getByText(new RegExp(`${time} to`))).toBeVisible();
});

test("a one-person company is sent to self-serve with an explanation", async ({ page }) => {
  await fillForm(page, `sam-${unique()}@globex.test`, "1");
  await expect(page.getByRole("heading", { name: "You can get started right away" })).toBeVisible();
  await expect(page.getByText(/team of one/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Get started" })).toHaveAttribute(
    "href",
    "https://example.com/signup",
  );
});

test("missing answers are explained next to their fields", async ({ page }) => {
  await page.goto("/f/book-a-demo");
  await page.getByRole("button", { name: "Find a time" }).click();
  await expect(page.getByText("Full name is required.")).toBeVisible();
  await expect(page.getByText("Please tick the box to continue.")).toBeVisible();
});

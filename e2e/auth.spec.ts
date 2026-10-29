import { expect, test } from "@playwright/test";

/**
 * The admin sign-in form, end to end in a browser. This guards a real bug:
 * when the server was started with a bind-all hostname (0.0.0.0, the
 * server.mjs default), Auth.js built its internal sign-in URL from that
 * address and the form's POST never answered — the page hung forever.
 * Exercising the actual form (not the auth API directly) is what catches it.
 *
 * Needs ADMIN_EMAIL / ADMIN_PASSWORD in the environment, like CI sets.
 */
test("the admin can sign in through the login form", async ({ page }) => {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  test.skip(!email || !password, "ADMIN_EMAIL / ADMIN_PASSWORD are not set");

  await page.goto("/login");
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/routing-log/);
  await expect(page.getByRole("heading", { name: "Routing log" })).toBeVisible();
});

import { expect, test } from "@playwright/test";

/**
 * The demo form's Country field (examples/switchboard.demo.yaml, fifteen
 * options) uses the custom dropdown: a long list, so a search box rather
 * than type-ahead.
 */
test("the Country dropdown searches and selects from the keyboard", async ({ page }) => {
  await page.goto("/f/book-a-demo");
  const country = page.getByRole("combobox", { name: "Country" });
  await country.focus();

  await page.keyboard.press("ArrowDown");
  await expect(country).toHaveAttribute("aria-expanded", "true");
  const listbox = page.getByRole("listbox", { name: "Country" });
  await expect(listbox).toBeVisible();
  const search = page.getByPlaceholder("Search…");
  await expect(search).toBeFocused();
  await expect(page.getByRole("option")).toHaveCount(15);

  // The search box narrows the list; Enter chooses the active match.
  await page.keyboard.type("united k");
  await expect(page.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(listbox).toBeHidden();
  await expect(country).toBeFocused();
  await expect(country).toHaveText("United Kingdom");

  // Home and End move through the unfiltered list; Escape closes without
  // changing the choice, and outside clicks close too.
  await page.keyboard.press("ArrowDown");
  await expect(search).toBeFocused();
  const activeId = () => country.getAttribute("aria-activedescendant");
  await page.keyboard.press("End");
  await expect(page.locator(`[id="${await activeId()}"]`)).toHaveText("Other");
  await page.keyboard.press("Home");
  await expect(page.locator(`[id="${await activeId()}"]`)).toHaveText("United States");
  await expect(
    page.getByRole("option", { name: "United Kingdom", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(listbox).toBeHidden();
  await expect(country).toBeFocused();
  await expect(country).toHaveText("United Kingdom");

  await country.click();
  await expect(listbox).toBeVisible();
  await page.getByRole("heading", { name: "Book a demo" }).click();
  await expect(listbox).toBeHidden();
});

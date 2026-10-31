import { expect, test } from "@playwright/test";

/**
 * The demo form's Country field (examples/switchboard.demo.yaml, seven
 * options) uses the custom dropdown: a short list, so keyboard type-ahead
 * rather than a search box.
 */
test("the Country dropdown works from the keyboard", async ({ page }) => {
  await page.goto("/f/book-a-demo");
  const country = page.getByRole("combobox", { name: "Country" });
  await country.focus();

  await page.keyboard.press("ArrowDown");
  await expect(country).toHaveAttribute("aria-expanded", "true");
  const listbox = page.getByRole("listbox", { name: "Country" });
  await expect(listbox).toBeVisible();
  await expect(page.getByPlaceholder("Search…")).toHaveCount(0);

  // Type-ahead: "c" lands on CA, a second "c" cycles to CH.
  await page.keyboard.press("c");
  await expect(country).toHaveAttribute("aria-activedescendant", /.+/);
  const activeId = () => country.getAttribute("aria-activedescendant");
  await expect(page.locator(`[id="${await activeId()}"]`)).toHaveText("CA");
  await page.keyboard.press("c");
  await expect(page.locator(`[id="${await activeId()}"]`)).toHaveText("CH");

  await page.keyboard.press("End");
  await expect(page.locator(`[id="${await activeId()}"]`)).toHaveText("Other");
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(listbox).toBeHidden();
  await expect(country).toBeFocused();
  await expect(country).toHaveText("US");

  // Escape closes without changing the choice; outside clicks close too.
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option", { name: "US", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(listbox).toBeHidden();
  await expect(country).toBeFocused();
  await expect(country).toHaveText("US");

  await country.click();
  await expect(listbox).toBeVisible();
  await page.getByRole("heading", { name: "Book a demo" }).click();
  await expect(listbox).toBeHidden();
});

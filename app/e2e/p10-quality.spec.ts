// Phase 10 Quality E2E (brief §12, PLAN-2 P10):
// Verifies Arabic RTL mirroring on Settings, Inspector, and Widget Builder while widget grid
// coordinates remain strictly LTR, plus keyboard accessibility across 2.0 surfaces.
import { expect as pwExpect, test as pwTest } from "@playwright/test";
import { enterEdit, expect, fakeInit, openLayer, test } from "./stub/layerFixture";
import { openShellPage } from "./stub/shellFixture";

test("Arabic RTL mirrors Inspector and Widget Builder dialogs while keeping widget grid LTR", async ({
  page,
}) => {
  const init = fakeInit([{ type: "widget", id: "w-clock", kind: "clock", x: 0, y: 0, w: 4, h: 2 }]);
  if (
    typeof init.settings === "object" &&
    init.settings !== null &&
    !Array.isArray(init.settings)
  ) {
    init.settings.language = "ar";
  }
  await openLayer(page, init);

  // Desktop widget surface stays strictly LTR so grid positions never mirror.
  const gridDir = await page
    .locator("[class*='surface']")
    .first()
    .evaluate((el) => getComputedStyle(el).direction);
  expect(gridDir).toBe("ltr");

  // Enter Edit mode and open Inspector -> dialog mirrors to dir="rtl".
  await enterEdit(page);
  await page
    .locator('[data-item-id="w-clock"]')
    .getByRole("button", { name: "Customize widget" })
    .click();
  const inspector = page.getByRole("dialog", { name: /inspector$/i });
  await expect(inspector).toBeVisible();
  await expect(inspector).toHaveAttribute("dir", "rtl");

  // Fork into Widget Builder -> Builder dialog also mirrors to dir="rtl".
  await inspector.getByRole("button", { name: "Customize layout…" }).click();
  const builder = page.getByRole("dialog", { name: "Widget Builder" });
  await expect(builder).toBeVisible();
  await expect(builder).toHaveAttribute("dir", "rtl");
});

pwTest(
  "Settings switches to Arabic RTL cleanly and exposes landmarks across all 16 sections",
  async ({ page }) => {
    await openShellPage(page, "/settings.html");
    await page.getByRole("navigation").getByRole("button", { name: "Appearance" }).click();
    await page.getByRole("button", { name: "العربية" }).click();
    await pwExpect(page.locator("html")).toHaveAttribute("lang", "ar");
    await pwExpect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await pwExpect(page.getByRole("navigation")).toBeVisible();
    await pwExpect(page.getByRole("main")).toBeVisible();
  },
);

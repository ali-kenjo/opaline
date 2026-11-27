// Phase 5 Round 2 E2E (5.1, 5.5, 5.8): Live floating/dockable Inspector (5 tabs, style chips,
// scope switcher, copy/paste style, eyedropper, conditional styles, JSON editor, CSS selector,
// unified undo/redo of style edits) and Widget Gallery (2.0 categories, source switcher, size
// swipe arrows & pills).
import { enterEdit, expect, openLayer, test } from "./stub/layerFixture";

test("Inspector: opens without covering widget, applies style chips, undoes style changes", async ({
  page,
}) => {
  await openLayer(page);
  await enterEdit(page);

  await page
    .locator('[data-item-id="w-cpu"]')
    .getByRole("button", { name: "Customize widget" })
    .click();
  const dialog = page.getByRole("dialog", { name: /inspector$/ });
  await expect(dialog).toBeVisible();

  // Floating inspector does not overlap the inspected widget.
  const widgetBox = await page.locator('[data-item-id="w-cpu"]').boundingBox();
  const panelBox = await dialog.boundingBox();
  if (!widgetBox || !panelBox) throw new Error("missing bounding boxes");
  const overlapsHoriz =
    panelBox.x < widgetBox.x + widgetBox.width && panelBox.x + panelBox.width > widgetBox.x;
  const overlapsVert =
    panelBox.y < widgetBox.y + widgetBox.height && panelBox.y + panelBox.height > widgetBox.y;
  expect(overlapsHoriz && overlapsVert).toBe(false);

  // Apply one-click "Solid" style chip -> saved to widget style.
  await dialog.getByRole("button", { name: "Solid" }).click();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const s = window.__fake?.settings() as {
          widgets?: Record<string, { style?: { surface?: string } }>;
        } | null;
        return s?.widgets?.["w-cpu"]?.style?.surface;
      }),
    )
    .toBe("opaque");

  // Copy style, open Eyedropper and pick first swatch, then verify tabs (Content, Data, Behavior, Advanced).
  await dialog.getByRole("button", { name: "Copy style" }).click();
  await dialog.getByRole("button", { name: "Eyedropper" }).click();
  await dialog.locator('[aria-label="Sampled colors"] button').first().click();

  await dialog.getByRole("tab", { name: "Content" }).click();
  await expect(dialog.getByRole("heading", { name: "Shown information" })).toBeVisible();

  await dialog.getByRole("tab", { name: "Data" }).click();
  await expect(dialog.getByText("cpu.load", { exact: true })).toBeVisible();

  await dialog.getByRole("tab", { name: "Behavior" }).click();
  await dialog.getByRole("textbox", { name: "Condition expression" }).fill("cpu.temp >= 85");
  await dialog.getByRole("button", { name: "Add rule" }).click();
  await expect(dialog.getByText("cpu.temp >= 85")).toBeVisible();

  await dialog.getByRole("tab", { name: "Advanced" }).click();
  await expect(dialog.getByText('[data-kind="cpu"]')).toBeVisible();

  // Close inspector via Escape, then Undo reverts style edits inside the unified Edit history.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const s = window.__fake?.settings() as {
          widgets?: Record<string, { style?: { surface?: string } }>;
        } | null;
        return s?.widgets?.["w-cpu"]?.style?.surface;
      }),
    )
    .toBeUndefined();
});

test("Widget Gallery: 2.0 categories, source switcher, and size swipe arrows", async ({ page }) => {
  await openLayer(page);
  await enterEdit(page);
  await page.getByRole("toolbar").getByRole("button", { name: "Add widget" }).click();
  const sheet = page.getByRole("dialog", { name: "Add widget" });
  await expect(sheet).toBeVisible();

  // 2.0 category tabs present.
  await sheet.getByRole("tab", { name: "Weather & Ambient" }).click();
  await expect(sheet.getByRole("button", { name: /^Add Weather/ })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^Add Clock/ })).toHaveCount(0);

  // Swipe to next size on Weather updates the preview's size label.
  const beforeLabel = await sheet
    .getByRole("button", { name: /^Add Weather \(/ })
    .getAttribute("aria-label");
  await sheet.getByRole("button", { name: "Next size for Weather" }).click();
  const afterLabel = await sheet
    .getByRole("button", { name: /^Add Weather \(/ })
    .getAttribute("aria-label");
  expect(afterLabel).not.toBe(beforeLabel);

  // Source switcher ("Your widgets" & "From themes & plugins").
  await sheet.getByRole("button", { name: "Your widgets" }).click();
  await expect(sheet).toContainText("Widget Builder");
  await sheet.getByRole("button", { name: "Built-in" }).click();
  await sheet.getByRole("tab", { name: "All" }).click();
  await expect(sheet.getByRole("button", { name: /^Add Clock/ })).toBeVisible();
});

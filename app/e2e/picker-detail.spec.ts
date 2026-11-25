// The Widget Picker and detail views on the real layer page with a fake core (e2e/stub).
import {
  commandNames,
  enterEdit,
  expect,
  fakeInit,
  openLayer,
  storedItems,
  test,
} from "./stub/layerFixture";

test("picker: search, categories, click to add", async ({ page }) => {
  await openLayer(page);
  await enterEdit(page);
  await page.getByRole("toolbar").getByRole("button", { name: "Add widget" }).click();
  const sheet = page.getByRole("dialog", { name: "Add widget" });
  await expect(sheet).toBeVisible();

  await sheet.getByRole("searchbox").fill("memo");
  await expect(sheet.getByRole("button", { name: /^Add Memory/ })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^Add Clock/ })).toHaveCount(0);
  await sheet.getByRole("searchbox").fill("");

  const tabs = sheet.getByRole("tab");
  expect(await tabs.count()).toBeGreaterThan(2);
  await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await tabs.first().click();

  await sheet.getByRole("button", { name: /^Add Memory/ }).click();
  await expect(sheet).toBeHidden();
  await expect
    .poll(async () => (await storedItems(page)).filter((i) => i.kind === "memory").length)
    .toBe(1);
  // The new widget also got its settings entry.
  const kinds = await page.evaluate(() => {
    const s = window.__fake?.settings() as { widgets?: Record<string, { kind: string }> } | null;
    return Object.values(s?.widgets ?? {}).map((w) => w.kind);
  });
  expect(kinds).toContain("memory");
});

test("picker: unavailable widgets show their reason", async ({ page }) => {
  const init = fakeInit();
  init.values["docker.state"] = {
    kind: "map",
    v: { status: { kind: "text", v: "not-installed" } },
  };
  await openLayer(page, init);
  await enterEdit(page);
  await page.getByRole("toolbar").getByRole("button", { name: "Add widget" }).click();
  const sheet = page.getByRole("dialog", { name: "Add widget" });
  await sheet.getByRole("searchbox").fill("docker");
  await expect(sheet).toContainText("Docker or Podman isn't installed");
});

test("picker: drag a preview onto the grid", async ({ page }) => {
  await openLayer(page);
  await enterEdit(page);
  await page.getByRole("toolbar").getByRole("button", { name: "Add widget" }).click();
  const sheet = page.getByRole("dialog", { name: "Add widget" });
  await sheet.getByRole("searchbox").fill("memory");
  const preview = sheet.getByRole("button", { name: /^Add Memory/ });
  const box = await preview.boundingBox();
  if (!box) throw new Error("no preview");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 20, box.y - 20, { steps: 3 });
  // Drop it in the empty area to the right of the existing widgets.
  await page.mouse.move(900, 300, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => (await storedItems(page)).filter((i) => i.kind === "memory").length)
    .toBe(1);
});

test("picker closes with Escape", async ({ page }) => {
  await openLayer(page);
  await enterEdit(page);
  await page.getByRole("toolbar").getByRole("button", { name: "Add widget" }).click();
  await expect(page.getByRole("dialog", { name: "Add widget" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Add widget" })).toBeHidden();
});

test("presets replace the layout", async ({ page }) => {
  await openLayer(page);
  await enterEdit(page);
  await page.getByRole("toolbar").getByRole("button", { name: "Presets" }).click();
  await page.getByRole("menuitem").first().click();
  await expect.poll(async () => (await storedItems(page)).length).toBeGreaterThan(2);
});

test("detail view: opens on click, asks core for history, closes", async ({ page }) => {
  await openLayer(page);
  await page.locator('[data-item-id="w-cpu"]').click();
  const dialog = page.getByRole("dialog", { name: /details$/ });
  await expect(dialog).toBeVisible();
  await expect.poll(async () => await commandNames(page)).toContain("history");
  await dialog.getByRole("button", { name: "24 hours" }).click();
  await dialog.getByRole("button", { name: "Close detail view" }).click();
  await expect(dialog).toBeHidden();

  await page.locator('[data-item-id="w-cpu"]').click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("detail view: Customize opens the widget settings", async ({ page }) => {
  await openLayer(page);
  await page.locator('[data-item-id="w-cpu"]').click();
  await page
    .getByRole("dialog", { name: /details$/ })
    .getByRole("button", { name: "Customize" })
    .click();
  await expect(page.getByRole("dialog", { name: /details$/ })).toBeHidden();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("context menu: right-click offers edit, settings and remove", async ({ page }) => {
  await openLayer(page);
  await page.locator('[data-item-id="w-cpu"]').click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Widget actions" });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Remove" }).click();
  await expect.poll(async () => (await storedItems(page)).map((i) => i.id)).toEqual(["w-clock"]);
});

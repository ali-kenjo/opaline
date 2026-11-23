import { expect, test } from "@playwright/test";

// Widget Lab screenshot baselines (docs/PLAN.md 2.8) in WebKit, the engine of the Tauri
// webview. `?still` freezes the odometer and switches to reduced motion, so frames are
// deterministic. Grain and GPU rounding differ a little between machines, hence the tolerance.
const SNAPSHOT = { maxDiffPixelRatio: 0.03, threshold: 0.25 } as const;

const configs = [
  ["glass-dusk-dark", "wallpaper=dusk"],
  ["glass-snow-dark", "wallpaper=snow"],
  ["glass-forest-light", "wallpaper=forest&theme=light"],
  ["glass-dusk-opaque", "wallpaper=dusk&opaque"],
] as const;

test.use({ viewport: { width: 1180, height: 1100 } });

for (const [name, query] of configs) {
  test(`glass: ${name}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`/lab.html?still&${query}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await expect(page.getByRole("region", { name: "Glass" })).toHaveScreenshot(
      `${name}.png`,
      SNAPSHOT,
    );
    expect(errors).toEqual([]);
  });
}

test("components", async ({ page }) => {
  await page.goto("/lab.html?still&wallpaper=forest");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await expect(page.getByRole("region", { name: "Components" })).toHaveScreenshot(
    "components-dark.png",
    SNAPSHOT,
  );
});

test("an idle Lab requests no frames", async ({ page }) => {
  await page.goto("/lab.html?still&wallpaper=dusk");
  await page.waitForTimeout(800);
  const frames = () =>
    page.evaluate(
      () => (window as unknown as { __labScheduler: { frames: number } }).__labScheduler.frames,
    );
  const before = await frames();
  await page.waitForTimeout(1000);
  expect(await frames()).toBe(before);
});

test("the card states announce their reasons", async ({ page }) => {
  await page.goto("/lab.html?still");
  await expect(
    page.getByRole("status").filter({ hasText: "No battery on this device" }),
  ).toBeVisible();
  await expect(page.getByRole("menu", { name: "Widget" }).getByRole("menuitem")).toHaveCount(4);
  await expect(page.getByRole("switch", { name: "Example switch" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("widgets: every size and two custom styles", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/lab.html?still&wallpaper=dusk");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  await expect(page.getByTestId("widgets")).toHaveScreenshot("widgets-dusk-dark.png", SNAPSHOT);
  await expect(page.getByTestId("more-widgets")).toHaveScreenshot(
    "more-widgets-dusk-dark.png",
    SNAPSHOT,
  );
  expect(errors).toEqual([]);
});

test("the settings sheet edits content and style of one widget", async ({ page }) => {
  await page.goto("/lab.html?still&wallpaper=dusk");
  const card = page.getByRole("group", { name: "Prozessor" });
  await expect(card).toContainText("Temperatur");
  await card.hover();
  await card.getByRole("button", { name: "Prozessor settings" }).click();
  // The sheet is named after the widget's title, which this test renames.
  const sheet = page.getByRole("dialog", { name: /^(Prozessor|Chip) settings$/ });
  await expect(sheet).toBeVisible();

  // Content: hide a field; the card drops the row.
  await sheet.getByRole("switch", { name: "Show Temperature" }).click();
  await expect(card).not.toContainText("Temperatur");

  // Content: rename the title.
  const title = sheet.getByRole("textbox", { name: "Title", exact: true });
  await title.fill("Chip");
  await expect(page.getByRole("group", { name: "Chip" })).toBeVisible();

  // Style: this widget's background becomes solid; the row says where the value comes from.
  await sheet.getByRole("radio", { name: "Style" }).click();
  await sheet.getByRole("combobox", { name: "Background" }).selectOption({ label: "Solid" });
  await expect(sheet.getByText("This widget").first()).toBeVisible();
  await sheet.getByRole("button", { name: "Reset Background" }).click();
  // Reset means "inherit": the card is back on the default glass.
  await expect(sheet.getByRole("combobox", { name: "Background" })).toHaveValue("glass");

  // Style for all widgets: uppercase labels everywhere.
  await sheet.getByRole("radio", { name: "All widgets" }).click();
  await sheet.getByRole("switch", { name: "Uppercase labels" }).click();
  await expect(page.getByRole("group", { name: "Clock" }).first().getByText("Clock")).toHaveCSS(
    "text-transform",
    "uppercase",
  );

  await sheet.getByRole("button", { name: "Close settings" }).click();
  await expect(sheet).toBeHidden();
});

test("a source option lists live choices and switches the data", async ({ page }) => {
  await page.goto("/lab.html?still&wallpaper=dusk");
  const card = page.getByRole("group", { name: "GPU" });
  await card.hover();
  await card.getByRole("button", { name: "GPU settings" }).click();
  const sheet = page.getByRole("dialog", { name: "GPU settings" });
  const pick = sheet.getByRole("combobox", { name: "GPU", exact: true });
  await expect(pick.locator("option")).toHaveText([
    "Automatic (discrete first)",
    "UHD Graphics 630",
    "GeForce GTX 1660 Ti Mobile",
  ]);
  await pick.selectOption({ label: "UHD Graphics 630" });
  // The Lab has no data for the integrated GPU: the card shows dashes, not the other GPU's numbers.
  await expect(card).toContainText("—");
  await expect(card).not.toContainText("51");
});

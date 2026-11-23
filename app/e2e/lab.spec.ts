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

// Contrast measured from the screenshot (2.0 brief §3.4): every widget card on a dark and a light
// wallpaper keeps its text readable.
import { expect, test } from "@playwright/test";
import { findLowContrast } from "./stub/contrast";

test.use({ viewport: { width: 1180, height: 1400 } });

for (const [name, query] of [
  ["dusk", "wallpaper=dusk"],
  ["snow", "wallpaper=snow&theme=light"],
  ["dusk, Clear look", "wallpaper=dusk&look=clear"],
  ["snow, Clear look", "wallpaper=snow&theme=light&look=clear"],
] as const) {
  for (const stage of ["widgets", "more-widgets"] as const) {
    test(`text contrast: ${stage} on ${name}`, async ({ page }) => {
      await page.goto(`/lab.html?still&${query}`);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      const low = await findLowContrast(page, page.getByTestId(stage));
      expect(low, JSON.stringify(low, null, 2)).toEqual([]);
    });
  }
}

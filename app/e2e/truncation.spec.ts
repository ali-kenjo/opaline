// Zero truncation in the Widget Lab (2.0 brief §3.4): every widget at every size, in English and
// with the custom styles the Lab includes (German title, uppercase labels, large text).
import { expect, test } from "@playwright/test";
import { findTruncations } from "./stub/truncation";

test.use({ viewport: { width: 1180, height: 1400 } });

for (const [stage, look] of [
  ["widgets", "glass"],
  ["more-widgets", "glass"],
  ["widgets", "clear"],
  ["more-widgets", "clear"],
  ["blocks", "glass"],
] as const) {
  test(`no label or value is cut: ${stage}, ${look} look`, async ({ page }) => {
    await page.goto(`/lab.html?still&wallpaper=dusk&look=${look}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const cuts = await findTruncations(page.getByTestId(stage));
    expect(cuts, JSON.stringify(cuts, null, 2)).toEqual([]);
  });
}

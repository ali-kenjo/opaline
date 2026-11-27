// Phase 4 Round 5 (PLAN-2 4.15–4.16): verifies all ten built-in looks in WebKit for clean
// rendering, zero idle frames, zero label/value truncation, and readable text contrast.
import { expect, test } from "@playwright/test";
import { findLowContrast } from "./stub/contrast";
import { findTruncations } from "./stub/truncation";

test.use({ viewport: { width: 1200, height: 1000 } });

const ALL_LOOKS = [
  "opaline",
  "crystal",
  "bloom",
  "instrument",
  "air",
  "terminal",
  "neon",
  "paper",
  "mono",
  "classic",
] as const;

for (const id of ALL_LOOKS) {
  test(`look "${id}": renders cleanly, zero truncation, readable contrast, zero idle frames`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    const query =
      id === "paper"
        ? `only=looks&lookTheme=${id}&wallpaper=snow&theme=light&still`
        : `only=looks&lookTheme=${id}&wallpaper=dusk&still`;
    await page.goto(`/lab.html?${query}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(450);

    const stage = page.getByTestId("looks-stage");
    await expect(stage).toBeVisible();
    await expect(stage).toHaveAttribute("data-look-id", id);

    // Zero truncation on labels and values across the look's starter layout.
    const cuts = await findTruncations(stage);
    expect(cuts, JSON.stringify(cuts, null, 2)).toEqual([]);

    // Readable text contrast measured on the rendered WebKit pixels.
    const low = await findLowContrast(page, stage);
    expect(low, JSON.stringify(low, null, 2)).toEqual([]);

    // Zero idle frames while still.
    const frames = () =>
      page.evaluate(
        () => (window as unknown as { __labScheduler: { frames: number } }).__labScheduler.frames,
      );
    const before = await frames();
    await page.waitForTimeout(600);
    expect(await frames()).toBe(before);
    expect(errors).toEqual([]);
  });
}

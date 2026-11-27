// Phase 4 Round 5 (PLAN-2 4.15–4.16): verifies all ten built-in looks in WebKit for clean
// rendering, zero idle frames, zero label/value truncation, and readable text contrast.
import { readFileSync } from "node:fs";
import path from "node:path";
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

// Theme typography roles (style.roles) must reach the rendered widgets. They were written as CSS
// variables that no rule read, so every look's hero numbers fell back to the widget-wide font;
// custom visuals (weather, battery, memory, clock faces) drew their own big numbers outside it.
interface RoleSpec {
  fontWeight?: number;
  fontWidth?: number;
}
const heroRole = (id: string): RoleSpec | undefined => {
  const file = path.resolve(import.meta.dirname, `../../spec/themes/${id}/theme.json`);
  const theme = JSON.parse(readFileSync(file, "utf8")) as {
    style?: { roles?: { hero?: RoleSpec } };
  };
  return theme.style?.roles?.hero;
};

for (const id of ALL_LOOKS) {
  const hero = heroRole(id);
  if (!hero?.fontWeight) continue;
  test(`look "${id}": hero numbers use the theme's hero typography`, async ({ page }) => {
    await page.goto(`/lab.html?only=looks&lookTheme=${id}&wallpaper=dusk&still`);
    await page.evaluate(() => document.fonts.ready);
    const stage = page.getByTestId("looks-stage");
    await expect(stage).toHaveAttribute("data-look-id", id);
    // Composition heroes (data-role) and the big numbers custom visuals draw (data-hero).
    const heroes = stage.locator('[data-role="hero"], [data-hero]');
    await expect(heroes.first()).toBeVisible();
    const all = await heroes.evaluateAll((els) =>
      els.map((el) => {
        const s = getComputedStyle(el);
        return { text: el.textContent, weight: s.fontWeight, fvs: s.fontVariationSettings };
      }),
    );
    for (const css of all) {
      expect(css.weight, `${css.text} weight`).toBe(String(hero.fontWeight));
      if (hero.fontWidth !== undefined) {
        expect(css.fvs, `${css.text} width`).toContain(`"wdth" ${String(hero.fontWidth)}`);
      }
    }
  });
}

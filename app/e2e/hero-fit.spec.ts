import { expect, test } from "@playwright/test";
import { findTruncations } from "./stub/truncation";

// Hero numbers fit their box (DESIGN-2 §3.3): a number wider than the space its card leaves
// narrows the width axis, then shrinks, never below 0.6 × its size. Round 1 shows CPU, Memory and
// GPU at every size in the real Opaline type; the dual-GPU L card needs the fit (its iGPU "— %"
// used to run 20 px past its box, across the divider).
test.use({ viewport: { width: 1180, height: 1400 } });

test("hero numbers fit their box at every size", async ({ page }) => {
  await page.goto("/lab.html?only=round1&still");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  const monitors = page.getByTestId("round1-monitors");
  const heroes = await monitors.evaluate((root) =>
    [...root.querySelectorAll<HTMLElement>('[data-type="number"][data-role="hero"]')].map((b) => {
      const card = b.closest('[role="group"]')?.getAttribute("aria-label") ?? "?";
      const number = b.firstElementChild?.getBoundingClientRect().width ?? 0;
      return {
        card,
        text: b.textContent,
        number: Math.round(number),
        box: Math.round(b.getBoundingClientRect().width),
        fitted: b.hasAttribute("data-fitted"),
        size: parseFloat(getComputedStyle(b).fontSize),
      };
    }),
  );
  expect(heroes.length).toBeGreaterThanOrEqual(6);
  for (const h of heroes) expect(h.number, JSON.stringify(h)).toBeLessThanOrEqual(h.box + 1);
  // At least one needed fitting, and none went below 0.6 of the L size (60 px × 72/44 ≈ 98 px).
  const fitted = heroes.filter((h) => h.fitted);
  expect(fitted.length).toBeGreaterThan(0);
  for (const h of fitted)
    expect(h.size, JSON.stringify(h)).toBeGreaterThanOrEqual(0.6 * 40.9 - 0.5);
  expect(await findTruncations(monitors)).toEqual([]);
});

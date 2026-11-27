import { expect, test } from "@playwright/test";
import { findTruncations } from "./stub/truncation";

// The Memory widget's liquid pill in German (decimal commas): its caption stays inside the pill
// and never breaks after the "/" of "used / total" (a dangling "6,3 GB /" looked like a stray
// glyph in the narrow M pill, which also repeated the line right next to it).
test.use({ viewport: { width: 1180, height: 1400 }, locale: "de-DE" });

test("memory pill captions fit and keep used / total together, in German", async ({ page }) => {
  await page.goto("/lab.html?only=round1&still");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const monitors = page.getByTestId("round1-monitors");
  expect(await findTruncations(monitors)).toEqual([]);

  const pills = await monitors.evaluate((root) =>
    [...root.querySelectorAll<HTMLElement>('[data-block="hero-liquid"]')].map((pill) => {
      const box = pill.getBoundingClientRect();
      const card = pill.closest('[role="group"]')?.getAttribute("aria-label") ?? "?";
      const texts = [...pill.querySelectorAll<HTMLElement>("span")].filter(
        (s) => s.childElementCount === 0 && s.textContent.trim() !== "",
      );
      const outside = texts
        .filter((s) => {
          const r = s.getBoundingClientRect();
          return (
            r.left < box.left || r.right > box.right || r.top < box.top || r.bottom > box.bottom
          );
        })
        .map((s) => s.textContent);
      // A line that ends with "/": the slash's line box sits above the next character's.
      const dangling: string[] = [];
      for (const s of texts) {
        const node = s.firstChild;
        const t = node?.textContent ?? "";
        const slash = t.indexOf("/");
        if (!node || slash < 0 || slash + 2 > t.length) continue;
        const rectOf = (i: number) => {
          const r = document.createRange();
          r.setStart(node, i);
          r.setEnd(node, i + 1);
          return r.getBoundingClientRect();
        };
        const after = t.slice(slash + 1).search(/\S/) + slash + 1;
        if (rectOf(slash).top < rectOf(after).top - 2) dangling.push(t);
      }
      return { card, captions: texts.map((s) => s.textContent), outside, dangling };
    }),
  );
  expect(pills.length).toBeGreaterThanOrEqual(3);
  for (const p of pills) {
    expect(p.outside, `${p.card}: ${JSON.stringify(p.captions)}`).toEqual([]);
    expect(p.dangling, `${p.card}: ${JSON.stringify(p.captions)}`).toEqual([]);
    // German number formatting reached the pill.
    expect(p.captions.join(" ")).toMatch(/\d+ ?%/);
  }
});

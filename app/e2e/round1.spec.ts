import { expect, test } from "@playwright/test";

// Phase 4 Round 1 (4.1–4.4): Clock (all 11 faces + analog dials), CPU, Memory, and GPU
// rendered under the Opaline 2.0 theme in WebKit.
test.use({ viewport: { width: 1180, height: 1100 } });

test("Round 1 Opaline Clock faces and monitors render cleanly with zero idle frames", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/lab.html?only=round1&still");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);

  const clocks = page.getByTestId("round1-clocks");
  await expect(clocks).toBeVisible();
  // Word clock, terminal clock, day ring, big date all render their content.
  await expect(clocks).toContainText("ten past ten");
  await expect(clocks).toContainText("$ date");
  await expect(clocks).toContainText("% of day");
  await expect(clocks).toContainText("23");

  const monitors = page.getByTestId("round1-monitors");
  await expect(monitors).toBeVisible();
  // CPU thermal badge + load + top apps; Memory liquid fill + zram; GPU dual + engines + VRAM.
  await expect(monitors).toContainText("Processor load");
  await expect(monitors).toContainText("Blender");
  await expect(monitors).toContainText("zram");
  await expect(monitors).toContainText("UHD Graphics 630");
  await expect(monitors).toContainText("GeForce GTX 1660 Ti Mobile");

  // Idle frame budget: zero frames requested while still.
  const frames = () =>
    page.evaluate(
      () => (window as unknown as { __labScheduler: { frames: number } }).__labScheduler.frames,
    );
  const before = await frames();
  await page.waitForTimeout(800);
  expect(await frames()).toBe(before);
  expect(errors).toEqual([]);
});

test("Round 1 GPU shows Asleep · 0 W for a sleeping dGPU without hiding the awake iGPU", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/lab.html?only=round1&still&asleep");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);

  const monitors = page.getByTestId("round1-monitors");
  await expect(monitors).toContainText("Asleep · 0 W");
  await expect(monitors).toContainText("UHD Graphics 630");
  await expect(monitors).toContainText("650 MHz");
  expect(errors).toEqual([]);
});

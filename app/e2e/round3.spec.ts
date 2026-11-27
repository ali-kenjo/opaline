import { expect, test } from "@playwright/test";

// Phase 4 Round 3 (4.9–4.11): Processes, Now Playing (Card/Vinyl/Cassette + lyrics + controls),
// and Visualizer (Album-ring, Spectrogram, VU, LED, Particles, Oscilloscope, Stereo split)
// rendered under the Opaline 2.0 theme in WebKit.
test.use({ viewport: { width: 1260, height: 1300 } });

test("Round 3 Opaline widgets render cleanly with zero idle frames", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/lab.html?only=round3&still");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);

  const stage = page.getByTestId("round3-stage");
  await expect(stage).toBeVisible();

  // Processes: real cached app icon <img> + Disk I/O + search filter + End task
  await expect(stage).toContainText("Firefox");
  await expect(stage).toContainText("6.4 MB/s");
  await expect(stage).toContainText("firefox-bin");
  expect(await stage.locator("img").count()).toBeGreaterThanOrEqual(4);

  // Now Playing: Card + Vinyl + Cassette looks, synced .lrc lyric line, multi-player switcher
  await expect(stage.locator('[data-testid="now-playing"][data-look="card"]')).toBeVisible();
  await expect(stage.locator('[data-testid="now-playing"][data-look="vinyl"]')).toBeVisible();
  await expect(stage.locator('[data-testid="now-playing"][data-look="cassette"]')).toBeVisible();
  await expect(stage).toContainText("Looking at the stars");
  await expect(stage).toContainText("Midnight City");

  // Visualizer: all 7 new styles present as rendered canvases
  for (const look of [
    "album-ring",
    "spectrogram",
    "vu",
    "led",
    "particles",
    "oscilloscope",
    "stereo-split",
  ]) {
    const c = stage.locator(`canvas[data-look="${look}"]`);
    await expect(c).toBeVisible();
    const box = await c.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(40);
    expect(box?.height ?? 0).toBeGreaterThan(30);
  }

  // Idle frame budget: zero frames requested while still (vinyl, cassette, breathing mask, visualizers).
  const frames = () =>
    page.evaluate(
      () => (window as unknown as { __labScheduler: { frames: number } }).__labScheduler.frames,
    );
  const before = await frames();
  await page.waitForTimeout(800);
  expect(await frames()).toBe(before);
  expect(errors).toEqual([]);
});

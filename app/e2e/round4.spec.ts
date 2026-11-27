import { expect, test } from "@playwright/test";

// Phase 4 Round 4 (4.12–4.14): Weather (sky scene, hourly, 6-day bars, wind compass, AQI, sun arc),
// Calendar (mini month grid, countdown, current-time line, all-day chip), and Docker (Compose
// project grouping, CPU/RAM bars, port chips, Docker Desktop stopped card) under Opaline 2.0.
test.use({ viewport: { width: 1260, height: 1300 } });

test("Round 4 Opaline widgets render cleanly with zero idle frames", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/lab.html?only=round4&still");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);

  const stage = page.getByTestId("round4-stage");
  await expect(stage).toBeVisible();

  // Weather: sky scene, location, AQI, wind, Open-Meteo attribution
  await expect(stage.locator('[data-testid="weather-scene"]').first()).toBeVisible();
  await expect(stage).toContainText("Berlin");
  await expect(stage).toContainText("AQI 18");
  await expect(stage).toContainText("18 km/h");
  await expect(stage).toContainText("Open-Meteo");

  // Calendar: mini month grid, countdown, all-day chip, upcoming event
  await expect(stage.locator('[data-testid="calendar-view"]').first()).toBeVisible();
  await expect(stage).toContainText("In 35 min");
  await expect(stage).toContainText("Design review");
  await expect(stage).toContainText("All day");

  // Docker: Compose group `shop`, published port chip, and Docker Desktop stopped state
  await expect(stage).toContainText("shop");
  await expect(stage).toContainText("api-gateway");
  await expect(stage).toContainText("8080:80");
  await expect(stage).toContainText("Docker Desktop is stopped");
  await expect(stage).toContainText("Start Docker Desktop");

  // Idle frame budget: zero frames requested while still (including illustrated weather sky).
  const frames = () =>
    page.evaluate(
      () => (window as unknown as { __labScheduler: { frames: number } }).__labScheduler.frames,
    );
  const before = await frames();
  await page.waitForTimeout(800);
  expect(await frames()).toBe(before);
  expect(errors).toEqual([]);
});

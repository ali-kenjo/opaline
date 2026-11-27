import { expect, test } from "@playwright/test";

// Phase 4 Round 2 (4.5–4.8): Storage, Network, Battery & Power, and Fans
// rendered under the Opaline 2.0 theme in WebKit.
test.use({ viewport: { width: 1180, height: 1100 } });

test("Round 2 Opaline widgets render cleanly with zero idle frames", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/lab.html?only=round2&still");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);

  const stage = page.getByTestId("round2-stage");
  await expect(stage).toBeVisible();

  // Storage: drives + removable Eject button
  await expect(stage).toContainText("/media/lab/USB");
  await expect(stage).toContainText("Eject");

  // Network: Wi-Fi SSID + VPN badge + latency with jitter
  await expect(stage).toContainText("Lab Wi-Fi");
  await expect(stage).toContainText("VPN · wg-berlin");
  await expect(stage).toContainText("±1.2 ms");

  // Battery & Power: charge limit + power profile buttons + wireless mouse peripheral
  await expect(stage).toContainText("Limit 80%");
  await expect(stage).toContainText("Balanced");
  await expect(stage).toContainText("MX Master 3");

  // Fans: spinning RPM + per-fan gauges + CPU temp
  await expect(stage).toContainText("Fan 1");
  await expect(stage).toContainText("rpm");

  // Idle frame budget: zero frames requested while still (including fan spinner, liquid pill, net wave).
  const frames = () =>
    page.evaluate(
      () => (window as unknown as { __labScheduler: { frames: number } }).__labScheduler.frames,
    );
  const before = await frames();
  await page.waitForTimeout(800);
  expect(await frames()).toBe(before);
  expect(errors).toEqual([]);
});

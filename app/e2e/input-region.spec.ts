// Where the desktop layer takes clicks (ADR 0015): outside Peek and Edit only on interactive
// elements (a widget's buttons), so the desktop icons keep working everywhere else; in Edit
// mode on the whole window. A button click hands keyboard focus back.
import { expect, fakeInit, openLayer, test } from "./stub/layerFixture";

test("only interactive elements take clicks outside Edit mode", async ({ page }) => {
  const init = fakeInit([
    { id: "w-battery", type: "widget", kind: "battery", x: 0, y: 0, w: 4, h: 2 },
    { id: "w-cpu", type: "widget", kind: "cpu", x: 4, y: 0, w: 2, h: 2 },
  ]);
  const settings = init.settings as { widgets: Record<string, unknown> };
  settings.widgets["w-battery"] = { kind: "battery", content: { profileButtons: true } };
  await openLayer(page, init);
  const buttons = page.locator('[data-item-id="w-battery"] [data-interactive]');
  await expect(buttons).toHaveCount(3);

  const lastRegion = () =>
    page.evaluate(() => {
      const r = window.__fake?.regions ?? [];
      return r[r.length - 1] ?? null;
    });
  // The region is the three buttons, nothing else (the CPU card has no controls).
  await expect.poll(async () => (await lastRegion())?.length).toBe(3);
  const region = (await lastRegion()) ?? [];
  const boxes = await buttons.evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { x: Math.floor(r.left), y: Math.floor(r.top) };
    }),
  );
  expect(region.map((r) => ({ x: r.x, y: r.y }))).toEqual(boxes);

  // Edit mode: the whole window.
  await page.evaluate(() => {
    window.__fake?.emit({ kind: "edit", active: true });
  });
  await expect.poll(async () => (await lastRegion())?.[0]?.width).toBe(1536);
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await lastRegion())?.length).toBe(3);

  // A profile button sends its command, then gives keyboard focus back.
  await buttons.nth(2).click();
  await expect
    .poll(() => page.evaluate(() => window.__fake?.commands.map((c) => c.cmd) ?? []))
    .toEqual(expect.arrayContaining(["set-power-profile", "release-focus"]));
});

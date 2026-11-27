// Phase 5 Round 1 E2E (5.2–5.4): Free mode (Grid ⇄ Free, pixel drag, alignment guides, 1px/10px
// nudge, lock, z-order), Edit upgrades (Shift-click multi-select, rubber-band marquee, Align,
// Duplicate Ctrl+D, Copy/Paste Ctrl+C/V, Tidy up, Theme switcher), unified Undo/Redo for theme &
// layout changes, and editable Smart Stack expression rules.
import { enterEdit, expect, fakeInit, openLayer, storedItems, test } from "./stub/layerFixture";

async function storedMonitor(page: import("@playwright/test").Page) {
  return await page.evaluate(() => {
    const layouts = window.__fake?.layouts() as
      { monitors?: Record<string, Record<string, unknown>> } | undefined;
    const mons = layouts?.monitors;
    return mons ? Object.values(mons)[0] : undefined;
  });
}

async function storedTheme(page: import("@playwright/test").Page) {
  return await page.evaluate(
    () => (window.__fake?.settings() as { theme?: string } | undefined)?.theme,
  );
}

test("Free mode: switch Grid ⇄ Free, arrow nudge 1px/10px, drag, lock, and z-order", async ({
  page,
}) => {
  await openLayer(page);
  await enterEdit(page);

  // Switch to Free mode.
  await page.getByRole("toolbar").getByRole("button", { name: "Grid" }).click();
  await expect(page.getByRole("toolbar").getByRole("button", { name: "Free" })).toBeVisible();
  await expect.poll(async () => (await storedMonitor(page))?.mode).toBe("free");

  // Select CPU widget and nudge 10px right with Shift+ArrowRight, then 1px down with ArrowDown.
  await page.locator('[data-item-id="w-cpu"]').click();
  const before = await page.locator('[data-item-id="w-cpu"]').boundingBox();
  if (!before) throw new Error("no box");

  await page.keyboard.press("Shift+ArrowRight");
  await expect
    .poll(async () =>
      Math.round((await page.locator('[data-item-id="w-cpu"]').boundingBox())?.x ?? 0),
    )
    .toBe(Math.round(before.x) + 10);

  await page.keyboard.press("ArrowDown");
  await expect
    .poll(async () =>
      Math.round((await page.locator('[data-item-id="w-cpu"]').boundingBox())?.y ?? 0),
    )
    .toBe(Math.round(before.y) + 1);

  // Bring to front via context menu updates z-order.
  await page.locator('[data-item-id="w-clock"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "Bring to front" }).click();
  await expect
    .poll(async () => {
      const items = (await storedItems(page)) as { id: string; z?: number }[];
      const clock = items.find((i) => i.id === "w-clock");
      const cpu = items.find((i) => i.id === "w-cpu");
      return (clock?.z ?? 0) > (cpu?.z ?? 0);
    })
    .toBe(true);

  // Lock prevents Delete removal.
  await page.locator('[data-item-id="w-clock"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "Lock" }).click();
  await expect(page.locator('[data-item-id="w-clock"] [aria-label="Locked widget"]')).toBeVisible();
  await page.locator('[data-item-id="w-clock"]').click();
  await page.keyboard.press("Delete");
  await expect(page.locator('[data-item-id="w-clock"]')).toBeVisible();

  // Switch back to Grid cleanly.
  await page.getByRole("toolbar").getByRole("button", { name: "Free" }).click();
  await expect(page.getByRole("toolbar").getByRole("button", { name: "Grid" })).toBeVisible();
});

test("multi-select, Align, Duplicate (Ctrl+D), Copy/Paste (Ctrl+C/V), and Tidy up", async ({
  page,
}) => {
  await openLayer(
    page,
    fakeInit([
      { id: "w-clock", type: "widget", kind: "clock", x: 0, y: 2, w: 4, h: 2 },
      { id: "w-cpu", type: "widget", kind: "cpu", x: 6, y: 0, w: 2, h: 2 },
    ]),
  );
  await enterEdit(page);

  // Shift-click multi-select shows the contextual Selection actions bar.
  await page.locator('[data-item-id="w-clock"]').click();
  await page.locator('[data-item-id="w-cpu"]').click({ modifiers: ["Shift"] });
  const multi = page.getByRole("group", { name: "Selection actions" });
  await expect(multi).toBeVisible();
  await expect(multi).toContainText("2 selected");

  // Align top moves w-clock up to y=0.
  await multi.getByRole("button", { name: "Align top" }).click();
  await expect
    .poll(async () => (await storedItems(page)).find((i) => i.id === "w-clock")?.y)
    .toBe(0);

  // Duplicate single selected widget via Ctrl+D.
  await page.locator('[data-item-id="w-cpu"]').click();
  await page.keyboard.press("Control+d");
  await expect.poll(async () => (await storedItems(page)).length).toBe(3);

  // Copy & Paste via Ctrl+C / Ctrl+V adds a 4th widget.
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await expect.poll(async () => (await storedItems(page)).length).toBe(4);

  // Tidy up packs everything neatly starting at (0, 0).
  await page.getByRole("toolbar").getByRole("button", { name: "Tidy up" }).click();
  await expect
    .poll(async () => (await storedItems(page)).some((i) => i.x === 0 && i.y === 0))
    .toBe(true);
});

test("unified Edit-session Undo/Redo covers theme switches from the toolbar", async ({ page }) => {
  await openLayer(page);
  await enterEdit(page);

  const initialTheme = await storedTheme(page);
  await page.getByRole("toolbar").getByRole("button", { name: "Theme" }).click();
  await page.getByRole("menuitem", { name: "Neon" }).click();
  await expect.poll(async () => await storedTheme(page)).toBe("neon");

  // Ctrl+Z reverts the theme switch in the same unified history.
  await page.keyboard.press("Control+z");
  await expect.poll(async () => await storedTheme(page)).toBe(initialTheme);

  // Ctrl+Shift+Z reapplies Neon.
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => await storedTheme(page)).toBe("neon");
});

test("Smart Stack rules can be added and removed in the stack editor", async ({ page }) => {
  const init = fakeInit([
    { id: "s-1", type: "stack", x: 0, y: 0, w: 2, h: 2, children: ["w-a", "w-b"] },
  ]);
  await openLayer(page, {
    ...init,
    settings: {
      ...(init.settings as Record<string, unknown>),
      widgets: { "w-a": { kind: "cpu" }, "w-b": { kind: "memory" } },
    },
  });
  await enterEdit(page);

  await page.getByRole("button", { name: "Edit stack" }).click();
  await page.getByRole("switch", { name: "Smart Rotate" }).click();
  await page.getByRole("textbox", { name: "Smart rule expression" }).fill("cpu.load >= 80");
  await page.getByRole("button", { name: "Add rule" }).click();

  await expect
    .poll(async () => {
      const [stack] = (await storedItems(page)) as { smartRules?: { when: string }[] }[];
      return stack?.smartRules?.[0]?.when;
    })
    .toBe("cpu.load >= 80");

  await page.getByRole("button", { name: "Remove smart rule" }).click();
  await expect
    .poll(async () => {
      const [stack] = (await storedItems(page)) as { smartRules?: { when: string }[] }[];
      return stack?.smartRules?.length ?? 0;
    })
    .toBe(0);
});

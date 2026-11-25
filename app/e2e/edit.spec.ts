// Edit mode on the real layer page with a fake core (e2e/stub): enter and leave, select,
// keyboard moves and resizes, drag, resize handles, remove with undo, undo/redo, stacks.
import {
  commandNames,
  enterEdit,
  expect,
  fakeInit,
  openLayer,
  storedItems,
  test,
} from "./stub/layerFixture";

test("the layer shows the widgets core sends and subscribes their topics", async ({ page }) => {
  await openLayer(page);
  await expect(page.locator("[data-item-id]")).toHaveCount(2);
  await expect(page.locator('[data-item-id="w-clock"]')).toBeVisible();
  await expect(page.locator('[data-item-id="w-cpu"]')).toContainText("%");
  const subs = await page.evaluate(() => window.__fake?.subscriptions ?? []);
  expect(subs).toContain("cpu.load");
});

test("Edit mode opens from core and closes with Done and with Escape", async ({ page }) => {
  await openLayer(page);
  await enterEdit(page);
  await expect(page.getByRole("button", { name: "Remove widget" })).toHaveCount(2);
  await page.getByRole("toolbar").getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("toolbar")).toBeHidden();

  await enterEdit(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("toolbar")).toBeHidden();
});

test("keyboard: Tab selects, arrows move, Shift+arrows resize, Delete removes", async ({
  page,
}) => {
  await openLayer(page);
  await enterEdit(page);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  // The CPU (second item) is selected; move it one cell down.
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => (await storedItems(page)).find((i) => i.id === "w-cpu")?.y).toBe(1);

  // Shift+Right grows it to the next allowed size (S 2×2 → M 4×2).
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(async () => (await storedItems(page)).find((i) => i.id === "w-cpu")?.w).toBe(4);

  await page.keyboard.press("Delete");
  await expect.poll(async () => (await storedItems(page)).map((i) => i.id)).toEqual(["w-clock"]);
  await expect(page.getByRole("status")).toContainText("removed");
});

test("undo and redo with the toolbar and the keyboard", async ({ page }) => {
  await openLayer(page);
  await enterEdit(page);
  const undo = page.getByRole("button", { name: "Undo" }).last();
  await expect(undo).toBeDisabled();

  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => (await storedItems(page))[0]?.y).toBe(1);

  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await storedItems(page))[0]?.y).toBe(0);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await storedItems(page))[0]?.y).toBe(1);

  await page.getByRole("toolbar").getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await storedItems(page))[0]?.y).toBe(0);
});

test("remove badge removes a widget and the snackbar brings it back", async ({ page }) => {
  await openLayer(page);
  await enterEdit(page);
  await page
    .locator('[data-item-id="w-cpu"]')
    .getByRole("button", { name: "Remove widget" })
    .click();
  await expect.poll(async () => (await storedItems(page)).map((i) => i.id)).toEqual(["w-clock"]);
  await page.getByRole("status").getByRole("button", { name: "Undo" }).click();
  await expect
    .poll(async () => (await storedItems(page)).map((i) => i.id).sort())
    .toEqual(["w-clock", "w-cpu"]);
});

test("dragging a widget moves it to the cell under the pointer", async ({ page }) => {
  await openLayer(page);
  await enterEdit(page);
  const cpu = page.locator('[data-item-id="w-cpu"]');
  const box = await cpu.boundingBox();
  if (!box) throw new Error("no box");
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Two cells down (84 px cell + 12 px gap = 96 px per step).
  await page.mouse.move(startX, startY + 100, { steps: 4 });
  await page.mouse.move(startX, startY + 192, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => (await storedItems(page)).find((i) => i.id === "w-cpu"))
    .toMatchObject({ x: 4, y: 2 });
});

test("dragging onto a widget of the same size makes a stack", async ({ page }) => {
  await openLayer(
    page,
    fakeInit([
      { id: "w-clock", type: "widget", kind: "memory", x: 0, y: 0, w: 2, h: 2 },
      { id: "w-cpu", type: "widget", kind: "cpu", x: 4, y: 0, w: 2, h: 2 },
    ]),
  );
  await enterEdit(page);
  const cpu = await page.locator('[data-item-id="w-cpu"]').boundingBox();
  const clock = await page.locator('[data-item-id="w-clock"]').boundingBox();
  if (!cpu || !clock) throw new Error("no box");
  await page.mouse.move(cpu.x + cpu.width / 2, cpu.y + cpu.height / 2);
  await page.mouse.down();
  await page.mouse.move(clock.x + clock.width / 2, clock.y + clock.height / 2, { steps: 8 });
  await expect(page.getByText("Drop to stack")).toBeVisible();
  await page.mouse.up();
  await expect.poll(async () => (await storedItems(page)).map((i) => i.type)).toEqual(["stack"]);
  const [stack] = await storedItems(page);
  expect(stack?.children).toEqual(["w-clock", "w-cpu"]);
});

test("a stack can be split again in the stack editor", async ({ page }) => {
  await openLayer(page, stackInit());
  await enterEdit(page);
  await page.getByRole("button", { name: "Edit stack" }).click();
  await page.getByRole("button", { name: "Move out of stack" }).first().click();
  await expect
    .poll(async () => (await storedItems(page)).map((i) => i.type).sort())
    .toEqual(["widget", "widget"]);
});

function stackInit() {
  const init = fakeInit([
    { id: "s-1", type: "stack", x: 0, y: 0, w: 2, h: 2, children: ["w-a", "w-b"] },
  ]);
  return {
    ...init,
    settings: {
      ...(init.settings as Record<string, unknown>),
      widgets: { "w-a": { kind: "cpu" }, "w-b": { kind: "memory" } },
    },
  } as typeof init;
}

test("resize handles snap to the widget's allowed sizes", async ({ page }) => {
  await openLayer(page);
  await enterEdit(page);
  await page.locator('[data-item-id="w-cpu"]').click();
  const handle = page.getByRole("button", { name: "Resize right" });
  const box = await handle.boundingBox();
  if (!box) throw new Error("no handle");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await storedItems(page)).find((i) => i.id === "w-cpu")?.w).toBe(4);
});

test("leaving Edit mode clears the undo history", async ({ page }) => {
  await openLayer(page);
  await enterEdit(page);
  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => (await storedItems(page))[0]?.y).toBe(1);
  await page.keyboard.press("Escape");
  await enterEdit(page);
  await expect(page.getByRole("toolbar").getByRole("button", { name: "Undo" })).toBeDisabled();
  expect(await commandNames(page)).toContain("update-layouts");
});

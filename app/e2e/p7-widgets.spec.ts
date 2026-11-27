// Phase 7 E2E (PLAN-2 7.1–7.5): Quick Controls (ADR 0016 + ADR 0015 focus hand-back),
// inline Notes & To-do typing, Core Timers & Pomodoro, Widget Gallery 2.0 categories,
// and Developer & Online widgets (n8n toggle).
import { commandNames, enterEdit, expect, fakeInit, openLayer, test } from "./stub/layerFixture";

test("Widget Gallery lists all Phase 7 categories and new widgets", async ({ page }) => {
  await openLayer(page);
  await enterEdit(page);
  await page.getByRole("toolbar").getByRole("button", { name: "Add widget" }).click();
  const sheet = page.getByRole("dialog", { name: "Add widget" });

  await sheet.getByRole("tab", { name: "Controls" }).click();
  await expect(sheet.getByRole("button", { name: /^Add Quick Controls/ })).toBeVisible();

  await sheet.getByRole("tab", { name: "Time & Personal" }).click();
  await expect(sheet.getByRole("button", { name: /^Add Notes/ })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^Add To-do/ })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^Add Timers & Pomodoro/ })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^Add World Clock/ })).toBeVisible();

  await sheet.getByRole("tab", { name: "Media & Photos" }).click();
  await expect(sheet.getByRole("button", { name: /^Add Photo Frame/ })).toBeVisible();

  await sheet.getByRole("tab", { name: "Weather & Ambient" }).click();
  await expect(sheet.getByRole("button", { name: /^Add Sun & Moon/ })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^Add Aura/ })).toBeVisible();

  await sheet.getByRole("tab", { name: "Developer & Online" }).click();
  await expect(sheet.getByRole("button", { name: /^Add GitHub/ })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^Add Home Assistant/ })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^Add n8n Workflows/ })).toBeVisible();
});

test("Quick Controls, To-do inline typing, Notes editor, Timers, and n8n send validated core commands", async ({
  page,
}) => {
  const init = fakeInit([
    { type: "widget", id: "w-ctrl", kind: "controls", x: 0, y: 0, w: 4, h: 2 },
    { type: "widget", id: "w-todo", kind: "todo", x: 4, y: 0, w: 4, h: 2 },
    { type: "widget", id: "w-note", kind: "notes", x: 8, y: 0, w: 4, h: 2 },
    { type: "widget", id: "w-timer", kind: "timers", x: 0, y: 3, w: 4, h: 2 },
    { type: "widget", id: "w-n8n", kind: "n8n", x: 4, y: 3, w: 4, h: 2 },
  ]);
  init.values["controls.state"] = {
    kind: "map",
    v: {
      wifi: { kind: "bool", v: true },
      bluetooth: { kind: "bool", v: false },
      dnd: { kind: "bool", v: false },
      outputVolume: { kind: "num", v: 60 },
      outputMuted: { kind: "bool", v: false },
    },
  };
  init.values["todos.list"] = {
    kind: "map",
    v: {
      openCount: { kind: "num", v: 1 },
      items: {
        kind: "list",
        v: [
          {
            kind: "map",
            v: {
              index: { kind: "num", v: 0 },
              text: { kind: "text", v: "Ship Phase 7" },
              done: { kind: "bool", v: false },
              priority: { kind: "text", v: "A" },
              due: { kind: "text", v: "" },
            },
          },
        ],
      },
    },
  };
  init.values["source.n8n"] = {
    kind: "map",
    v: {
      workflows: {
        kind: "list",
        v: [
          {
            kind: "map",
            v: {
              id: { kind: "text", v: "wf-1" },
              name: { kind: "text", v: "Daily Backup" },
              active: { kind: "bool", v: true },
            },
          },
        ],
      },
    },
  };

  await openLayer(page, init);

  // 1. Quick Controls toggle -> sends control-toggle + release-focus.
  await page.getByRole("button", { name: "Wi-Fi" }).click();
  await expect.poll(async () => await commandNames(page)).toContain("control-toggle");
  await expect.poll(async () => await commandNames(page)).toContain("release-focus");

  // 2. Inline typing in To-do widget -> sends todo-add.
  const input = page.getByRole("textbox", { name: "New task" });
  await input.fill("Buy coffee");
  await input.press("Enter");
  await expect.poll(async () => await commandNames(page)).toContain("todo-add");

  // 3. Inline Markdown editing in Notes -> Escape closes editor.
  await page.getByRole("button", { name: "Edit note" }).click();
  const editor = page.getByRole("textbox", { name: "Note markdown editor" });
  await expect(editor).toBeVisible();
  await editor.press("Escape");
  await expect(editor).toBeHidden();

  // 4. Timers Start -> sends timer-action.
  await page.getByRole("button", { name: "Start timer" }).click();
  await expect.poll(async () => await commandNames(page)).toContain("timer-action");

  // 5. n8n workflow deactivate -> sends n8n-set-workflow-active.
  await page.getByRole("button", { name: "Deactivate Daily Backup" }).click();
  await expect.poll(async () => await commandNames(page)).toContain("n8n-set-workflow-active");
});

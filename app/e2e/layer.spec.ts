import { expect, test } from "@playwright/test";

// Outside Tauri the layer page must still load cleanly: glass stage up, no widgets (they come
// from core's settings), no errors.
test("layer page renders standalone in WebKit", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/layer.html");
  await expect(page.locator("[data-glass]")).toHaveAttribute("data-glass", "webgl2");
  await expect(page.getByRole("group")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("WebGL2 is available to the glass compositor", async ({ page }) => {
  await page.goto("/layer.html");
  const hasWebgl2 = await page.evaluate(
    () => document.createElement("canvas").getContext("webgl2") !== null,
  );
  expect(hasWebgl2).toBe(true);
});

import { expect, test } from "@playwright/test";

// Outside Tauri the layer page must still render and say so, instead of failing silently.
test("layer page renders standalone in WebKit", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/layer.html");
  await expect(page.getByRole("group", { name: "Load average" })).toContainText(
    "Not running inside Opaline",
  );
  expect(errors).toEqual([]);
});

test("WebGL2 is available to the glass compositor", async ({ page }) => {
  await page.goto("/layer.html");
  const hasWebgl2 = await page.evaluate(
    () => document.createElement("canvas").getContext("webgl2") !== null,
  );
  expect(hasWebgl2).toBe(true);
});

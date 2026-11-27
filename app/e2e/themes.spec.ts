// Live theme switching, user/theme CSS injection, data-attribute contract, and non-blocking
// config problem toasts (PLAN-2 P3 tasks 3.4–3.6).
import type { Json } from "./stub/fakeCore";
import { expect, fakeInit, openLayer, test } from "./stub/layerFixture";

const wire = (v: unknown): Json => {
  if (v === null || v === undefined)
    return { kind: "missing", v: { state: "unavailable", reason: "none" } };
  if (typeof v === "boolean") return { kind: "bool", v };
  if (typeof v === "number") return { kind: "num", v };
  if (typeof v === "string") return { kind: "text", v };
  if (Array.isArray(v)) return { kind: "list", v: v.map(wire) };
  const map: Record<string, Json> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) map[k] = wire(val);
  return { kind: "map", v: map };
};

test("live themes, user CSS, and non-blocking config problem toasts", async ({ page }) => {
  const init = fakeInit([
    { id: "w-clock", type: "widget", kind: "clock", x: 0, y: 0, w: 4, h: 2 },
    { id: "w-cpu", type: "widget", kind: "cpu", x: 4, y: 0, w: 2, h: 2 },
  ]);
  await openLayer(page, init);

  const cpuCard = page.locator('[data-kind="cpu"]');
  await expect(cpuCard).toHaveAttribute("data-size", "S");
  await expect(cpuCard).toHaveAttribute("data-state", "ready");

  // Push a live theme update (Opaline) with per-kind CPU accent and custom CSS.
  const themeUpdate = wire({
    activeId: "opaline",
    active: {
      package: {
        id: "opaline",
        name: "Opaline",
        style: { blur: 30, transparency: 80 },
        kinds: { cpu: { accentColor: "#f2903a" } },
      },
      source: "builtin",
      css: "",
      problems: [],
    },
    themes: [],
    problems: [],
  });
  const cssUpdate = wire({
    themeCss: '[data-theme="opaline"] [data-kind="cpu"] { --test-theme: 1; }',
    userCss: '[data-kind="cpu"] { letter-spacing: 0.04em; }',
    safeMode: false,
    problems: [],
  });
  const push = async (seq: number, updates: { topic: string; value: Json }[]) => {
    const raw = JSON.stringify({ kind: "update", seq, atMs: Date.now(), updates });
    await page.evaluate((payload) => {
      window.__fake?.emit(JSON.parse(payload) as Json);
    }, raw);
  };

  await push(100, [
    { topic: "themes", value: themeUpdate },
    { topic: "style.css", value: cssUpdate },
  ]);

  await expect(page.locator("html")).toHaveAttribute("data-theme", "opaline");
  await expect(cpuCard).toHaveAttribute("data-theme", "opaline");
  await expect
    .poll(() => page.locator("#opaline-theme-css").textContent())
    .toContain("--test-theme: 1");
  await expect
    .poll(() => page.locator("#opaline-user-css").textContent())
    .toContain("letter-spacing: 0.04em");
  await expect
    .poll(() =>
      cpuCard.evaluate((el) => getComputedStyle(el).getPropertyValue("--test-theme").trim()),
    )
    .toBe("1");

  // Safe mode clears injected CSS immediately without touching widgets.
  const safeCss = wire({ themeCss: "", userCss: "", safeMode: true, problems: [] });
  await push(101, [{ topic: "style.css", value: safeCss }]);
  await expect(page.locator("#opaline-theme-css")).toHaveCount(0);
  await expect(page.locator("#opaline-user-css")).toHaveCount(0);
  await expect(cpuCard).toBeVisible();

  // Non-blocking config problem shows a toast naming the file and JSON path, widgets stay up.
  const problemsUpdate = wire([
    { file: "settings.json", at: "/style/blur", message: "style-value-out-of-range" },
  ]);
  await push(102, [{ topic: "config.problems", value: problemsUpdate }]);
  await expect(
    page.getByRole("status").filter({ hasText: "settings.json (/style/blur)" }),
  ).toBeVisible();
  await expect(cpuCard).toBeVisible();
});

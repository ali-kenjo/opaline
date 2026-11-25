// Playwright fixture: the real layer page (`layer.html`) on top of the fake core.
import { type Page, test as base, expect } from "@playwright/test";
import { mockValues } from "../../src/lab/labHost";
import { type FakeCoreInit, type Json, installFakeCore } from "./fakeCore";

export const MONITOR_KEY = "TST-0x0001-0x00000000:eDP-1";
export const VIEWPORT = { width: 1536, height: 864 };

const monitor: Json = {
  key: MONITOR_KEY,
  connector: "eDP-1",
  vendor: "TST",
  product: "0x0001",
  serial: "0x00000000",
  x: 0,
  y: 0,
  width: VIEWPORT.width,
  height: VIEWPORT.height,
  scale: 1,
  primary: true,
  builtin: true,
  work_area: [0, 0, VIEWPORT.width, VIEWPORT.height],
};

export interface LayoutItemJson {
  id: string;
  type: "widget" | "stack";
  kind?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  children?: string[];
}

/** Two widgets side by side: a clock (M) and a CPU (S). */
export const DEFAULT_ITEMS: LayoutItemJson[] = [
  { id: "w-clock", type: "widget", kind: "clock", x: 0, y: 0, w: 4, h: 2 },
  { id: "w-cpu", type: "widget", kind: "cpu", x: 4, y: 0, w: 2, h: 2 },
];

export function fakeInit(items: LayoutItemJson[] = DEFAULT_ITEMS): FakeCoreInit {
  const widgets: Record<string, Json> = {};
  for (const it of items) {
    if (it.type === "widget" && it.kind) widgets[it.id] = { kind: it.kind };
  }
  const values = mockValues(42) as unknown as Record<string, Json>;
  return {
    label: "layer-eDP-1",
    monitor,
    monitors: [monitor],
    geometry: { x: 0, y: 0, ...VIEWPORT },
    settings: {
      version: 1,
      language: "en",
      onboardingDone: true,
      appearance: { state: "full", glass: 45 },
      layout: { marginPx: 24 },
      style: {},
      styles: {},
      widgets,
    },
    layouts: {
      version: 1,
      showMissingOnPrimary: false,
      monitors: { [MONITOR_KEY]: { items: items as unknown as Json } },
    },
    appearance: { highContrast: false, animations: false, reducedMotion: true, textScale: 1 },
    values,
  };
}

export async function openLayer(page: Page, init: FakeCoreInit = fakeInit()): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  // Playwright's serializable-argument type recurses forever on `Json`; the value is plain JSON.
  const arg: unknown = init;
  await page.addInitScript(installFakeCore as (arg: unknown) => void, arg);
  await page.goto("/layer.html");
  await expect(page.locator("[data-item-id]").first()).toBeVisible();
}

/** The layout items the fake core holds for the test monitor. */
export async function storedItems(page: Page): Promise<LayoutItemJson[]> {
  return await page.evaluate((key) => {
    const l = window.__fake?.layouts() as {
      monitors?: Record<string, { items?: LayoutItemJson[] }>;
    } | null;
    return l?.monitors?.[key]?.items ?? [];
  }, MONITOR_KEY);
}

export async function commandNames(page: Page): Promise<string[]> {
  return await page.evaluate(() => window.__fake?.commands.map((c) => c.cmd) ?? []);
}

export async function enterEdit(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__fake?.emit({ kind: "edit", active: true });
  });
  await expect(page.getByRole("toolbar")).toBeVisible();
}

export const test = base;
export { expect };

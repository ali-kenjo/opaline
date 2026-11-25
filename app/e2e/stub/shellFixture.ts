// Playwright helpers for the Settings and Onboarding pages on top of the fake shell core.
import type { Page } from "@playwright/test";
import type { Json } from "./fakeCore";
import { installFakeShell } from "./fakeShell";
import { MONITOR_KEY } from "./layerFixture";

export function shellState(overrides: { onboardingDone?: boolean } = {}): Record<string, Json> {
  const monitor = {
    key: MONITOR_KEY,
    connector: "eDP-1",
    vendor: "TST",
    product: "0x0001",
    serial: "0x00000000",
    x: 0,
    y: 0,
    width: 1536,
    height: 864,
    scale: 1,
    primary: true,
    builtin: true,
    work_area: [0, 0, 1536, 864],
  };
  return {
    version: "1.1.0",
    settings: {
      version: 1,
      onboardingDone: overrides.onboardingDone ?? true,
      language: "en",
      appearance: { state: "automatic", glass: 45, density: "comfortable" },
      layout: { marginPx: 24 },
      performance: { mode: "balanced", pauseOnBattery: false },
      weather: { location: null, automatic: false },
      network: { billingDay: 1, latencyTarget: "1.1.1.1", publicIp: false },
      calendar: { system: true, subscriptions: [] },
      privacy: { updateChecks: true, privilegedSensors: false },
      alerts: [],
      style: {},
      styles: {},
      widgets: { "w-cpu": { kind: "cpu" } },
    },
    layouts: {
      version: 1,
      showMissingOnPrimary: false,
      monitors: {
        [MONITOR_KEY]: {
          items: [{ id: "w-cpu", type: "widget", kind: "cpu", x: 0, y: 0, w: 2, h: 2 }],
        },
      },
    },
    monitors: [monitor],
    appearance: { colorScheme: "prefer-dark", animations: false, highContrast: false },
    wallpapers: null,
    autostart: false,
    paused: false,
    desktop: {
      backend: "native",
      helperInstalled: true,
      helperEnabled: true,
      helperRunning: true,
      helperApiVersion: 1,
      helperPath: "/usr/share/gnome-shell/extensions/opaline-desktop@ali-kenjo.github.io",
    },
    shortcuts: { backend: "native", editable: true, peek: "<Super><Alt>w", edit: "<Super><Alt>e" },
    latestUpdate: null,
  };
}

export async function openShellPage(
  page: Page,
  path: "/settings.html" | "/onboarding.html",
  state: Record<string, Json> = shellState(),
): Promise<void> {
  await page.setViewportSize({ width: 1100, height: 760 });
  // Playwright's serializable-argument type recurses forever on `Json`; the value is plain JSON.
  const arg: unknown = state;
  await page.addInitScript(installFakeShell as (arg: unknown) => void, arg);
  await page.goto(path);
}

export async function shellCalls(page: Page): Promise<{ cmd: string; args: Json }[]> {
  return await page.evaluate(() => window.__fakeShell?.calls ?? []);
}

export async function shellSettings(page: Page): Promise<Record<string, Json>> {
  return await page.evaluate(
    () => (window.__fakeShell?.state() as { settings: Record<string, Json> }).settings,
  );
}

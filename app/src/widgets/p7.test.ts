import { describe, expect, it } from "vitest";
import { computeTimeProgress } from "./countdown";
import { WIDGETS, widgetByKind } from "./registry";
import { computeSunMoon } from "./sunMoon";

describe("Phase 7 widgets (PLAN-2 7.1–7.5)", () => {
  it("registers all 16 new Phase 7 widgets alongside the 14 core widgets", () => {
    expect(WIDGETS.length).toBe(30);
    const expected = [
      "controls",
      "notes",
      "todo",
      "timers",
      "countdown",
      "world-clock",
      "photo-frame",
      "sun-moon",
      "quote",
      "aura",
      "decoration",
      "github",
      "home-assistant",
      "mqtt",
      "feeds",
      "n8n",
    ];
    for (const kind of expected) {
      const def = widgetByKind(kind);
      expect(def, `missing widget kind ${kind}`).toBeDefined();
      expect(def?.sizes.length).toBeGreaterThan(0);
    }
  });

  it("computes deterministic year/month/day progress percentages", () => {
    const midYear = new Date(2026, 6, 2, 12, 0, 0);
    const p = computeTimeProgress(midYear);
    expect(p.yearPct).toBeGreaterThan(45);
    expect(p.yearPct).toBeLessThan(55);
    expect(p.dayPct).toBeCloseTo(50, 0);
  });

  it("computes offline sunrise/sunset and moon illumination", () => {
    const solstice = new Date(2026, 5, 21, 12, 0, 0);
    const info = computeSunMoon(solstice, 52.5);
    expect(info.sunriseMin).toBeLessThan(info.sunsetMin);
    expect(info.moonIllumPct).toBeGreaterThanOrEqual(0);
    expect(info.moonIllumPct).toBeLessThanOrEqual(100);
    expect(info.moonPhaseName.length).toBeGreaterThan(0);
  });
});

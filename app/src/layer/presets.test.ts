import { describe, expect, it } from "vitest";
import { PRESETS, buildPreset, migrateWidgetsToGrid } from "./presets";

function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

describe("presets", () => {
  it("builds every starter preset without overlaps or out-of-bounds cells", () => {
    for (const preset of PRESETS) {
      const { items, widgets } = buildPreset(preset, 15, 7);
      expect(items.length).toBeGreaterThan(0);
      expect(Object.keys(widgets).length).toBe(items.length);
      for (const item of items) {
        expect(item.x).toBeGreaterThanOrEqual(0);
        expect(item.y).toBeGreaterThanOrEqual(0);
        expect(item.x + item.w).toBeLessThanOrEqual(15);
        expect(item.y + item.h).toBeLessThanOrEqual(7);
      }
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i];
          const b = items[j];
          if (a && b) expect(overlaps(a, b)).toBe(false);
        }
      }
    }
  });

  it("refits presets onto a narrow 6x6 screen without overlaps", () => {
    for (const preset of PRESETS) {
      const { items } = buildPreset(preset, 6, 6);
      for (const item of items) {
        expect(item.x + item.w).toBeLessThanOrEqual(6);
        expect(item.y + item.h).toBeLessThanOrEqual(6);
      }
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i];
          const b = items[j];
          if (a && b) expect(overlaps(a, b)).toBe(false);
        }
      }
    }
  });

  it("migrates Phase 4 widgets preserving IDs and avoiding overlaps", () => {
    const items = migrateWidgetsToGrid(
      {
        "a-clock": { kind: "clock" },
        "b-cpu": { kind: "cpu" },
        "c-memory": { kind: "memory" },
        "d-network": { kind: "network" },
      },
      15,
      7,
    );
    expect(items.map((i) => i.id)).toEqual(["a-clock", "b-cpu", "c-memory", "d-network"]);
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        if (a && b) expect(overlaps(a, b)).toBe(false);
      }
    }
  });
});

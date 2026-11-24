import { describe, expect, it } from "vitest";
import {
  type LayoutItem,
  cellToPx,
  computeGrid,
  findNearestFree,
  findStackTarget,
  inBounds,
  itemsBoundingBox,
  matchMonitorKey,
  neighborMonitor,
  overlaps,
  pxToCell,
  refitLayout,
  resolveCollisions,
  waitingMonitorKeys,
} from "./grid";
import type { Monitor } from "./protocol";

function w(id: string, x: number, y: number, width: number, height: number): LayoutItem {
  return { id, type: "widget", kind: "cpu", x, y, w: width, h: height };
}

function assertValid(items: readonly LayoutItem[], cols: number, rows: number): void {
  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    if (!a) continue;
    expect(inBounds(a, cols, rows)).toBe(true);
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j];
      if (b) expect(overlaps(a, b)).toBe(false);
    }
  }
}

describe("grid engine", () => {
  it("computes grid dimensions and round-trips pixel coordinates", () => {
    // eDP-1 work area (1536 x 765)
    const g = computeGrid(1536, 765);
    expect(g.cols).toBe(15);
    expect(g.rows).toBe(7);
    const rect = cellToPx(g, 3, 2, 4, 2);
    expect(pxToCell(g, rect.x, rect.y, 4, 2)).toEqual({ x: 3, y: 2 });
  });

  it("resolves collisions with minimal movement and never overlaps", () => {
    const items = [w("a", 0, 0, 2, 2), w("b", 2, 0, 2, 2), w("c", 4, 0, 2, 2)];
    const moved = resolveCollisions(items, "a", 2, 0, 2, 2, 10, 6);
    expect(moved).not.toBeNull();
    if (!moved) return;
    assertValid(moved, 10, 6);
    const a = moved.find((i) => i.id === "a");
    const b = moved.find((i) => i.id === "b");
    const c = moved.find((i) => i.id === "c");
    expect(a && [a.x, a.y]).toEqual([2, 0]);
    expect(c && [c.x, c.y]).toEqual([4, 0]); // untouched
    // b moves minimally (distance 2 cells: either to (0,0) or (2,2)).
    expect(b ? Math.abs(b.x - 2) + Math.abs(b.y - 0) : -1).toBe(2);
  });

  it("property: random drag sequences always stay in bounds and non-overlapping", () => {
    let seed = 42;
    const rand = (n: number) => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed % n;
    };
    const cols = 10;
    const rows = 6;
    let items: LayoutItem[] = [
      w("a", 0, 0, 4, 2),
      w("b", 4, 0, 2, 2),
      w("c", 6, 0, 2, 2),
      w("d", 0, 2, 2, 2),
      w("e", 2, 2, 4, 2),
    ];
    for (let step = 0; step < 80; step++) {
      const target = items[rand(items.length)];
      if (!target) continue;
      const tx = rand(cols - target.w + 1);
      const ty = rand(rows - target.h + 1);
      const next = resolveCollisions(items, target.id, tx, ty, target.w, target.h, cols, rows);
      if (next) {
        assertValid(next, cols, rows);
        items = next;
      }
    }
  });

  it("refits layouts cleanly when the grid shrinks on resolution/scale change", () => {
    const items = [w("a", 11, 0, 4, 2), w("b", 13, 2, 2, 2), w("c", 0, 0, 4, 2)];
    const refit = refitLayout(items, 8, 5, () => ["S", "M"]);
    expect(refit).toHaveLength(3);
    assertValid(refit, 8, 5);
    // c already fit, so it did not move.
    expect(refit.find((i) => i.id === "c")).toMatchObject({ x: 0, y: 0 });
  });

  it("detects stack targets only for matching spans inside the center zone", () => {
    const g = computeGrid(1536, 765);
    const a = w("a", 0, 0, 2, 2);
    const b = w("b", 2, 0, 2, 2);
    const c = w("c", 4, 0, 4, 2);
    const br = cellToPx(g, b.x, b.y, b.w, b.h);
    const cr = cellToPx(g, c.x, c.y, c.w, c.h);
    expect(findStackTarget([a, b, c], a, g, br.x + br.width / 2, br.y + br.height / 2)?.id).toBe(
      "b",
    );
    expect(findStackTarget([a, b, c], a, g, cr.x + cr.width / 2, cr.y + cr.height / 2)).toBeNull();
  });

  it("matches monitor keys per ARCHITECTURE §3.6 and finds neighbors", () => {
    const edp: Monitor = {
      key: "AUO-0x82ed-0x00000000:eDP-1",
      connector: "eDP-1",
      vendor: "AUO",
      product: "0x82ed",
      serial: "0x00000000",
      x: 0,
      y: 0,
      width: 1536,
      height: 864,
      scale: 1.25,
      primary: true,
      builtin: true,
    };
    const hdmi: Monitor = {
      key: "MSI-MAG 272F-ABC123:HDMI-2",
      connector: "HDMI-2",
      vendor: "MSI",
      product: "MAG 272F",
      serial: "ABC123",
      x: 1536,
      y: 0,
      width: 1920,
      height: 1080,
      scale: 1,
      primary: false,
      builtin: false,
    };
    expect(matchMonitorKey(hdmi, ["MSI-MAG 272F-ABC123:DP-1"])).toBe("MSI-MAG 272F-ABC123:DP-1");
    expect(matchMonitorKey(edp, ["AUO-0x82ed-0x00000000:eDP-1"])).toBe(edp.key);
    expect(waitingMonitorKeys([edp], [edp.key, hdmi.key])).toEqual([hdmi.key]);
    expect(neighborMonitor(edp, [edp, hdmi], "right")?.connector).toBe("HDMI-2");
    expect(neighborMonitor(hdmi, [edp, hdmi], "left")?.connector).toBe("eDP-1");
    expect(neighborMonitor(edp, [edp, hdmi], "left")).toBeNull();
  });

  it("finds nearest free slots and tight bounding boxes", () => {
    const g = computeGrid(1536, 765);
    const items = [w("a", 0, 0, 2, 2)];
    expect(findNearestFree(items, 6, 4, 2, 2, 0, 0)).toEqual({ x: 2, y: 0 });
    const box = itemsBoundingBox(items, g, 48, 1536, 765);
    expect(box).not.toBeNull();
    if (!box) return;
    expect(box.width).toBeGreaterThan(180);
    expect(box.width).toBeLessThan(350);
  });
});

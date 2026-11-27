import { describe, expect, it } from "vitest";
import {
  alignItems,
  convertFreeToGrid,
  convertGridToFree,
  distributeItems,
  freeToPx,
  itemRectPx,
  itemsInMarquee,
  nudgeItems,
  pxToFree,
  reorderZ,
  snapFreeRect,
  tidyUpItems,
} from "./free";
import { type LayoutItem, computeGrid, overlaps } from "./grid";

function w(id: string, x: number, y: number, width: number, height: number): LayoutItem {
  return { id, type: "widget", kind: "cpu", x, y, w: width, h: height };
}

describe("Free mode & Edit upgrades (5.3–5.4)", () => {
  const workW = 1536;
  const workH = 765;
  const g = computeGrid(workW, workH);

  it("round-trips work-area-anchored FreeRects and preserves corner anchors on resize", () => {
    // Top-right corner widget, 24 px inset.
    const free = pxToFree({ x: workW - 24 - 372, y: 24, width: 372, height: 180 }, workW, workH);
    expect(free.anchor).toBe("top-right");
    expect(free.offsetX).toBe(24);
    expect(free.offsetY).toBe(24);

    // Same anchor on a wider monitor stays 24 px from the right edge!
    const wider = freeToPx(free, 1920, 1080);
    expect(wider.x).toBe(1920 - 24 - 372);
    expect(wider.y).toBe(24);

    // Center widget picks center anchor.
    const centered = pxToFree(
      {
        x: Math.round((workW - 200) / 2),
        y: Math.round((workH - 200) / 2),
        width: 200,
        height: 200,
      },
      workW,
      workH,
    );
    expect(centered.anchor).toBe("center");
    expect(freeToPx(centered, 1920, 1080).x).toBe(Math.round((1920 - 200) / 2));
  });

  it("snaps to alignment guides and lets Alt bypass snapping", () => {
    const other = { x: 100, y: 120, width: 200, height: 180 };
    const nearLeft = snapFreeRect(
      { x: 104, y: 340, width: 180, height: 180 },
      [other],
      workW,
      workH,
    );
    expect(nearLeft.rect.x).toBe(100);
    expect(nearLeft.guides.some((line) => line.axis === "x" && line.pos === 100)).toBe(true);

    const bypassed = snapFreeRect(
      { x: 104, y: 340, width: 180, height: 180 },
      [other],
      workW,
      workH,
      {
        disableSnap: true,
      },
    );
    expect(bypassed.rect.x).toBe(104);
    expect(bypassed.guides).toEqual([]);
  });

  it("converts Grid → Free keeping exact visual coordinates and Free → Grid without overlap", () => {
    const gridItems = [w("a", 0, 0, 4, 2), w("b", 4, 0, 2, 2)];
    const freeItems = convertGridToFree(gridItems, g, workW, workH);
    for (const item of freeItems) {
      expect(item.free).toBeDefined();
      const freeRect = itemRectPx(item, "free", g, workW, workH);
      const gridRect = itemRectPx(item, "grid", g, workW, workH);
      expect(freeRect).toEqual(gridRect);
    }

    // Overlap two Free items deliberately, then convert back to Grid: refit resolves cleanly.
    const overlapping = freeItems.map((it) => ({
      ...it,
      free: { anchor: "top-left" as const, offsetX: 48, offsetY: 48, width: 180, height: 180 },
    }));
    const back = convertFreeToGrid(overlapping, g, workW, workH);
    const [first, second] = back;
    expect(first && second).toBeTruthy();
    if (first && second) expect(overlaps(first, second)).toBe(false);
  });

  it("aligns and distributes multi-selected items while skipping locked ones", () => {
    const items = convertGridToFree(
      [w("a", 0, 0, 2, 2), w("b", 3, 1, 2, 2), w("c", 7, 2, 2, 2)],
      g,
      workW,
      workH,
    );
    const aligned = alignItems(items, new Set(["a", "b", "c"]), "top", "free", g, workW, workH);
    const ys = aligned.map((it) => itemRectPx(it, "free", g, workW, workH).y);
    expect(new Set(ys).size).toBe(1);

    const dist = distributeItems(
      aligned,
      new Set(["a", "b", "c"]),
      "horizontal",
      "free",
      g,
      workW,
      workH,
    );
    const [x0 = 0, x1 = 0, x2 = 0] = dist.map((it) => itemRectPx(it, "free", g, workW, workH).x);
    expect(x1 - x0).toBeCloseTo(x2 - x1, -1);

    // Locked item stays untouched during nudge.
    const locked = items.map((it) => (it.id === "a" ? { ...it, locked: true } : it));
    const nudged = nudgeItems(locked, new Set(["a", "b"]), 1, 0, "free", g, workW, workH, 10);
    const [n0, n1] = nudged;
    const [l0, l1] = locked;
    expect(n0 && n1 && l0 && l1).toBeTruthy();
    if (n0 && n1 && l0 && l1) {
      expect(itemRectPx(n0, "free", g, workW, workH).x).toBe(
        itemRectPx(l0, "free", g, workW, workH).x,
      );
      expect(itemRectPx(n1, "free", g, workW, workH).x).toBe(
        itemRectPx(l1, "free", g, workW, workH).x + 10,
      );
    }
  });

  it("tidies up scattered layouts, reorders z-index, and selects items inside a marquee", () => {
    const scattered = [w("a", 8, 4, 2, 2), w("b", 10, 1, 2, 2)];
    const tidied = tidyUpItems(scattered, "grid", g, workW, workH);
    expect(tidied.find((i) => i.id === "b")).toMatchObject({ x: 0, y: 0 });
    expect(tidied.find((i) => i.id === "a")).toMatchObject({ x: 2, y: 0 });

    const zFront = reorderZ(
      [
        { ...w("a", 0, 0, 2, 2), z: 1 },
        { ...w("b", 0, 0, 2, 2), z: 2 },
      ],
      new Set(["a"]),
      "front",
    );
    expect(zFront.find((i) => i.id === "a")?.z).toBeGreaterThan(
      zFront.find((i) => i.id === "b")?.z ?? 0,
    );

    const firstTidied = tidied[0];
    expect(firstTidied).toBeDefined();
    if (!firstTidied) return;
    const ra = itemRectPx(firstTidied, "grid", g, workW, workH);
    const picked = itemsInMarquee(
      tidied,
      { x: ra.x - 10, y: ra.y - 10, width: ra.width + 20, height: ra.height + 20 },
      "grid",
      g,
      workW,
      workH,
    );
    expect(picked).toContain("a");
  });
});

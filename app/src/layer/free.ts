// Free-mode placement engine & Edit-mode geometry helpers (PLAN-2 5.3–5.4, brief §6.2 & §7):
// work-area anchors + offsets, smart alignment guides & snapping (Alt disables), Grid ⇄ Free
// switching, multi-select marquee, align, distribute, Tidy up, z-order, and arrow nudge.
import { grid, type SizeClass, sizes, spanPx } from "../design-system/tokens/tokens";
import {
  type FreeAnchor,
  type FreeRect,
  type GridMetrics,
  type LayoutItem,
  type LayoutMode,
  type PxRect,
  cellToPx,
  findNearestFree,
  pxToCell,
  refitLayout,
  resolveCollisions,
} from "./grid";

export type AlignKind = "left" | "center-x" | "right" | "top" | "center-y" | "bottom";
export type DistributeAxis = "horizontal" | "vertical";
export type ZOrderOp = "front" | "forward" | "backward" | "back";

export interface GuideLine {
  axis: "x" | "y";
  pos: number;
  from: number;
  to: number;
  kind: "edge" | "center" | "margin";
}

const MIN_W = 84;
const MIN_H = 84;
const MAX_W = 1600;
const MAX_H = 1200;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Resolves an anchored `FreeRect` into window-local pixels inside `(workW, workH)`. */
export function freeToPx(free: FreeRect, workW: number, workH: number): PxRect {
  const width = clamp(Math.round(free.width), MIN_W, Math.max(MIN_W, Math.min(MAX_W, workW)));
  const height = clamp(Math.round(free.height), MIN_H, Math.max(MIN_H, Math.min(MAX_H, workH)));
  let x = 0;
  let y = 0;
  switch (free.anchor) {
    case "top-left":
      x = free.offsetX;
      y = free.offsetY;
      break;
    case "top-right":
      x = workW - width - free.offsetX;
      y = free.offsetY;
      break;
    case "bottom-left":
      x = free.offsetX;
      y = workH - height - free.offsetY;
      break;
    case "bottom-right":
      x = workW - width - free.offsetX;
      y = workH - height - free.offsetY;
      break;
    case "center":
      x = Math.round((workW - width) / 2) + free.offsetX;
      y = Math.round((workH - height) / 2) + free.offsetY;
      break;
  }
  return {
    x: clamp(Math.round(x), 0, Math.max(0, workW - width)),
    y: clamp(Math.round(y), 0, Math.max(0, workH - height)),
    width,
    height,
  };
}

/** Picks the nearest work-area anchor for `rect` (or uses `preferredAnchor`) and encodes offsets. */
export function pxToFree(
  rect: PxRect,
  workW: number,
  workH: number,
  preferredAnchor?: FreeAnchor,
): FreeRect {
  const width = clamp(Math.round(rect.width), MIN_W, Math.max(MIN_W, Math.min(MAX_W, workW)));
  const height = clamp(Math.round(rect.height), MIN_H, Math.max(MIN_H, Math.min(MAX_H, workH)));
  const x = clamp(Math.round(rect.x), 0, Math.max(0, workW - width));
  const y = clamp(Math.round(rect.y), 0, Math.max(0, workH - height));

  let anchor: FreeAnchor;
  if (preferredAnchor) {
    anchor = preferredAnchor;
  } else {
    const cx = x + width / 2;
    const cy = y + height / 2;
    const nearCenterX = Math.abs(cx - workW / 2) < Math.min(48, workW * 0.06);
    const nearCenterY = Math.abs(cy - workH / 2) < Math.min(48, workH * 0.06);
    if (nearCenterX && nearCenterY) {
      anchor = "center";
    } else {
      const right = cx > workW / 2;
      const bottom = cy > workH / 2;
      anchor = bottom ? (right ? "bottom-right" : "bottom-left") : right ? "top-right" : "top-left";
    }
  }

  let offsetX = x;
  let offsetY = y;
  switch (anchor) {
    case "top-left":
      offsetX = x;
      offsetY = y;
      break;
    case "top-right":
      offsetX = workW - width - x;
      offsetY = y;
      break;
    case "bottom-left":
      offsetX = x;
      offsetY = workH - height - y;
      break;
    case "bottom-right":
      offsetX = workW - width - x;
      offsetY = workH - height - y;
      break;
    case "center":
      offsetX = x - Math.round((workW - width) / 2);
      offsetY = y - Math.round((workH - height) / 2);
      break;
  }
  return {
    anchor,
    offsetX: Math.round(offsetX),
    offsetY: Math.round(offsetY),
    width,
    height,
  };
}

/** Resolves an item's window-local pixel rect in either Grid or Free mode. */
export function itemRectPx(
  item: LayoutItem,
  mode: LayoutMode,
  g: GridMetrics,
  workW: number,
  workH: number,
): PxRect {
  if (mode === "free" && item.free) {
    return freeToPx(item.free, workW, workH);
  }
  return cellToPx(g, item.x, item.y, item.w, item.h);
}

/** Estimates the nearest size class for an arbitrary pixel size in Free mode. */
export function sizeClassForPx(width: number, height: number, cell: number = grid.cell): SizeClass {
  let best: SizeClass = "M";
  let bestDist = Infinity;
  for (const [key, span] of Object.entries(sizes) as [SizeClass, { w: number; h: number }][]) {
    const sw = spanPx(span.w, cell);
    const sh = spanPx(span.h, cell);
    const dist = Math.hypot(width - sw, height - sh);
    if (dist < bestDist) {
      bestDist = dist;
      best = key;
    }
  }
  return best;
}

/**
 * Snaps `moving` in Free mode against other widgets' edges & centers, monitor center, and safe
 * margins. Returns the snapped rect and active alignment guide lines. Pass `disableSnap: true`
 * (Alt held) to bypass snapping cleanly.
 */
export function snapFreeRect(
  moving: PxRect,
  others: readonly PxRect[],
  workW: number,
  workH: number,
  opts?: { margin?: number; disableSnap?: boolean; threshold?: number },
): { rect: PxRect; guides: GuideLine[] } {
  const margin = opts?.margin ?? grid.safeMargin;
  const threshold = opts?.threshold ?? 7;
  const clamped: PxRect = {
    x: clamp(Math.round(moving.x), 0, Math.max(0, workW - moving.width)),
    y: clamp(Math.round(moving.y), 0, Math.max(0, workH - moving.height)),
    width: moving.width,
    height: moving.height,
  };
  if (opts?.disableSnap) {
    return { rect: clamped, guides: [] };
  }

  interface SnapCandidate {
    delta: number;
    guide: GuideLine;
  }

  const best: { x: SnapCandidate | null; y: SnapCandidate | null } = { x: null, y: null };

  const tryX = (
    targetX: number,
    linePos: number,
    from: number,
    to: number,
    kind: GuideLine["kind"],
  ) => {
    const delta = targetX - clamped.x;
    if (Math.abs(delta) <= threshold && (!best.x || Math.abs(delta) < Math.abs(best.x.delta))) {
      best.x = { delta, guide: { axis: "x", pos: Math.round(linePos), from, to, kind } };
    }
  };
  const tryY = (
    targetY: number,
    linePos: number,
    from: number,
    to: number,
    kind: GuideLine["kind"],
  ) => {
    const delta = targetY - clamped.y;
    if (Math.abs(delta) <= threshold && (!best.y || Math.abs(delta) < Math.abs(best.y.delta))) {
      best.y = { delta, guide: { axis: "y", pos: Math.round(linePos), from, to, kind } };
    }
  };

  // Safe margins and monitor center.
  tryX(margin, margin, 0, workH, "margin");
  tryX(workW - margin - clamped.width, workW - margin, 0, workH, "margin");
  tryX(Math.round((workW - clamped.width) / 2), Math.round(workW / 2), 0, workH, "center");

  tryY(margin, margin, 0, workW, "margin");
  tryY(workH - margin - clamped.height, workH - margin, 0, workW, "margin");
  tryY(Math.round((workH - clamped.height) / 2), Math.round(workH / 2), 0, workW, "center");

  // Other widgets' edges, centers, and gap-spaced edges.
  for (const o of others) {
    const minY = Math.min(clamped.y, o.y);
    const maxY = Math.max(clamped.y + clamped.height, o.y + o.height);
    const minX = Math.min(clamped.x, o.x);
    const maxX = Math.max(clamped.x + clamped.width, o.x + o.width);

    // X alignment
    tryX(o.x, o.x, minY, maxY, "edge");
    tryX(o.x + o.width - clamped.width, o.x + o.width, minY, maxY, "edge");
    tryX(o.x + o.width + grid.gap, o.x + o.width + grid.gap, minY, maxY, "edge");
    tryX(o.x - grid.gap - clamped.width, o.x - grid.gap, minY, maxY, "edge");
    tryX(
      Math.round(o.x + o.width / 2 - clamped.width / 2),
      o.x + o.width / 2,
      minY,
      maxY,
      "center",
    );

    // Y alignment
    tryY(o.y, o.y, minX, maxX, "edge");
    tryY(o.y + o.height - clamped.height, o.y + o.height, minX, maxX, "edge");
    tryY(o.y + o.height + grid.gap, o.y + o.height + grid.gap, minX, maxX, "edge");
    tryY(o.y - grid.gap - clamped.height, o.y - grid.gap, minX, maxX, "edge");
    tryY(
      Math.round(o.y + o.height / 2 - clamped.height / 2),
      o.y + o.height / 2,
      minX,
      maxX,
      "center",
    );
  }

  const guides: GuideLine[] = [];
  let x = clamped.x;
  let y = clamped.y;
  if (best.x) {
    x = clamp(clamped.x + best.x.delta, 0, Math.max(0, workW - clamped.width));
    guides.push(best.x.guide);
  }
  if (best.y) {
    y = clamp(clamped.y + best.y.delta, 0, Math.max(0, workH - clamped.height));
    guides.push(best.y.guide);
  }
  return { rect: { x, y, width: clamped.width, height: clamped.height }, guides };
}

/** Converts a monitor's Grid items to Free mode while keeping their exact visual positions. */
export function convertGridToFree(
  items: readonly LayoutItem[],
  g: GridMetrics,
  workW: number,
  workH: number,
): LayoutItem[] {
  return items.map((item, idx) => {
    const rect = item.free
      ? freeToPx(item.free, workW, workH)
      : cellToPx(g, item.x, item.y, item.w, item.h);
    return {
      ...item,
      free: pxToFree(rect, workW, workH, item.free?.anchor),
      z: item.z ?? idx + 1,
    };
  });
}

/** Converts a monitor's Free items back to Grid using nearest cells + minimal-movement refit. */
export function convertFreeToGrid(
  items: readonly LayoutItem[],
  g: GridMetrics,
  workW: number,
  workH: number,
  allowedSizes?: (item: LayoutItem) => readonly SizeClass[],
): LayoutItem[] {
  const snapped = items.map((item) => {
    if (!item.free) return item;
    const rect = freeToPx(item.free, workW, workH);
    const sc = sizeClassForPx(rect.width, rect.height, g.cell);
    const allowed = allowedSizes?.(item);
    const targetSize =
      allowed && allowed.length > 0 && !allowed.includes(sc)
        ? allowed.reduce((best, cur) => {
            const b = sizes[best];
            const c = sizes[cur];
            const bd = Math.hypot(
              rect.width - spanPx(b.w, g.cell),
              rect.height - spanPx(b.h, g.cell),
            );
            const cd = Math.hypot(
              rect.width - spanPx(c.w, g.cell),
              rect.height - spanPx(c.h, g.cell),
            );
            return cd < bd ? cur : best;
          }, allowed[0] ?? sc)
        : sc;
    const span = sizes[targetSize];
    const cell = pxToCell(g, rect.x, rect.y, span.w, span.h);
    return { ...item, x: cell.x, y: cell.y, w: span.w, h: span.h };
  });
  return refitLayout(snapped, g.cols, g.rows, allowedSizes);
}

/** Returns IDs of items intersecting a rubber-band selection rectangle. */
export function itemsInMarquee(
  items: readonly LayoutItem[],
  marquee: PxRect,
  mode: LayoutMode,
  g: GridMetrics,
  workW: number,
  workH: number,
): string[] {
  const mx1 = Math.min(marquee.x, marquee.x + marquee.width);
  const my1 = Math.min(marquee.y, marquee.y + marquee.height);
  const mx2 = Math.max(marquee.x, marquee.x + marquee.width);
  const my2 = Math.max(marquee.y, marquee.y + marquee.height);
  return items
    .filter((it) => {
      const r = itemRectPx(it, mode, g, workW, workH);
      return r.x < mx2 && r.x + r.width > mx1 && r.y < my2 && r.y + r.height > my1;
    })
    .map((it) => it.id);
}

/** Aligns 2+ selected unlocked items along an edge or center axis. */
export function alignItems(
  items: readonly LayoutItem[],
  selectedIds: ReadonlySet<string>,
  kind: AlignKind,
  mode: LayoutMode,
  g: GridMetrics,
  workW: number,
  workH: number,
): LayoutItem[] {
  const targets = items.filter((i) => selectedIds.has(i.id) && !i.locked);
  if (targets.length < 2) return [...items];

  if (mode === "free") {
    const rects = new Map(targets.map((i) => [i.id, itemRectPx(i, "free", g, workW, workH)]));
    const vals = [...rects.values()];
    const minX = Math.min(...vals.map((r) => r.x));
    const maxRight = Math.max(...vals.map((r) => r.x + r.width));
    const midX = (minX + maxRight) / 2;
    const minY = Math.min(...vals.map((r) => r.y));
    const maxBottom = Math.max(...vals.map((r) => r.y + r.height));
    const midY = (minY + maxBottom) / 2;

    return items.map((it) => {
      const r = rects.get(it.id);
      if (!r) return it;
      let nx = r.x;
      let ny = r.y;
      if (kind === "left") nx = minX;
      else if (kind === "right") nx = maxRight - r.width;
      else if (kind === "center-x") nx = Math.round(midX - r.width / 2);
      else if (kind === "top") ny = minY;
      else if (kind === "bottom") ny = maxBottom - r.height;
      else ny = Math.round(midY - r.height / 2);
      return {
        ...it,
        free: pxToFree({ ...r, x: nx, y: ny }, workW, workH, it.free?.anchor),
      };
    });
  }

  // Grid mode alignment using collision resolution.
  const minX = Math.min(...targets.map((i) => i.x));
  const maxRight = Math.max(...targets.map((i) => i.x + i.w));
  const midX = (minX + maxRight) / 2;
  const minY = Math.min(...targets.map((i) => i.y));
  const maxBottom = Math.max(...targets.map((i) => i.y + i.h));
  const midY = (minY + maxBottom) / 2;

  let cur = [...items];
  for (const t of targets) {
    const live = cur.find((i) => i.id === t.id);
    if (!live) continue;
    let nx = live.x;
    let ny = live.y;
    if (kind === "left") nx = minX;
    else if (kind === "right") nx = maxRight - live.w;
    else if (kind === "center-x") nx = Math.round(midX - live.w / 2);
    else if (kind === "top") ny = minY;
    else if (kind === "bottom") ny = maxBottom - live.h;
    else ny = Math.round(midY - live.h / 2);
    const next = resolveCollisions(cur, live.id, nx, ny, live.w, live.h, g.cols, g.rows);
    if (next) cur = next;
  }
  return cur;
}

/** Evenly distributes 3+ selected unlocked items horizontally or vertically. */
export function distributeItems(
  items: readonly LayoutItem[],
  selectedIds: ReadonlySet<string>,
  axis: DistributeAxis,
  mode: LayoutMode,
  g: GridMetrics,
  workW: number,
  workH: number,
): LayoutItem[] {
  const targets = items.filter((i) => selectedIds.has(i.id) && !i.locked);
  if (targets.length < 3) return [...items];

  if (mode === "free") {
    const entries = targets.map((it) => ({
      item: it,
      rect: itemRectPx(it, "free", g, workW, workH),
    }));
    entries.sort((a, b) => (axis === "horizontal" ? a.rect.x - b.rect.x : a.rect.y - b.rect.y));
    const first = entries[0];
    const last = entries[entries.length - 1];
    if (!first || !last) return [...items];

    const updated = new Map<string, FreeRect>();
    if (axis === "horizontal") {
      const totalSpan = last.rect.x + last.rect.width - first.rect.x;
      const sumW = entries.reduce((acc, e) => acc + e.rect.width, 0);
      const gap = (totalSpan - sumW) / (entries.length - 1);
      let cursor = first.rect.x;
      for (const e of entries) {
        updated.set(
          e.item.id,
          pxToFree({ ...e.rect, x: Math.round(cursor) }, workW, workH, e.item.free?.anchor),
        );
        cursor += e.rect.width + gap;
      }
    } else {
      const totalSpan = last.rect.y + last.rect.height - first.rect.y;
      const sumH = entries.reduce((acc, e) => acc + e.rect.height, 0);
      const gap = (totalSpan - sumH) / (entries.length - 1);
      let cursor = first.rect.y;
      for (const e of entries) {
        updated.set(
          e.item.id,
          pxToFree({ ...e.rect, y: Math.round(cursor) }, workW, workH, e.item.free?.anchor),
        );
        cursor += e.rect.height + gap;
      }
    }
    return items.map((it) => {
      const free = updated.get(it.id);
      return free ? { ...it, free } : it;
    });
  }

  // Grid mode distribution.
  const sorted = [...targets].sort((a, b) => (axis === "horizontal" ? a.x - b.x : a.y - b.y));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return [...items];

  let cur = [...items];
  const count = sorted.length;
  for (let idx = 1; idx < count - 1; idx++) {
    const t = sorted[idx];
    if (!t) continue;
    const frac = idx / (count - 1);
    const nx = axis === "horizontal" ? Math.round(first.x + (last.x - first.x) * frac) : t.x;
    const ny = axis === "vertical" ? Math.round(first.y + (last.y - first.y) * frac) : t.y;
    const next = resolveCollisions(cur, t.id, nx, ny, t.w, t.h, g.cols, g.rows);
    if (next) cur = next;
  }
  return cur;
}

/** Packs unlocked items cleanly into neat rows ("Tidy up", brief §6.2). */
export function tidyUpItems(
  items: readonly LayoutItem[],
  mode: LayoutMode,
  g: GridMetrics,
  workW: number,
  workH: number,
): LayoutItem[] {
  if (items.length === 0) return [];
  const locked = items.filter((i) => i.locked);
  const unlocked = items.filter((i) => !i.locked);

  if (mode === "free") {
    const margin = grid.safeMargin;
    let cx: number = margin;
    let cy: number = margin;
    let rowH = 0;
    const sorted = [...unlocked].sort((a, b) => {
      const ra = itemRectPx(a, "free", g, workW, workH);
      const rb = itemRectPx(b, "free", g, workW, workH);
      return ra.y - rb.y || ra.x - rb.x;
    });
    const placed = new Map<string, LayoutItem>();
    for (const it of sorted) {
      const r = itemRectPx(it, "free", g, workW, workH);
      const wrap = cx > margin && cx + r.width > workW - margin;
      if (wrap) {
        cx = margin;
        cy += rowH + grid.gap;
        rowH = 0;
      }
      placed.set(it.id, {
        ...it,
        free: pxToFree(
          { x: cx, y: cy, width: r.width, height: r.height },
          workW,
          workH,
          "top-left",
        ),
      });
      cx += r.width + grid.gap;
      rowH = Math.max(rowH, r.height);
    }
    return items.map((it) => placed.get(it.id) ?? it);
  }

  // Grid mode: keep locked items fixed, pack unlocked items neatly top-left to bottom-right.
  const placed: LayoutItem[] = [...locked];
  const sorted = [...unlocked].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const it of sorted) {
    const slot = findNearestFree(placed, g.cols, g.rows, it.w, it.h, 0, 0);
    if (slot) placed.push({ ...it, x: slot.x, y: slot.y });
    else placed.push(it);
  }
  const byId = new Map(placed.map((p) => [p.id, p]));
  return items.map((it) => byId.get(it.id) ?? it);
}

/** Reorders z-index of selected items in Free mode (`front | forward | backward | back`). */
export function reorderZ(
  items: readonly LayoutItem[],
  ids: ReadonlySet<string>,
  op: ZOrderOp,
): LayoutItem[] {
  if (ids.size === 0 || items.length < 2) return [...items];
  const normalized = items.map((it, idx) => ({ it, z: it.z ?? idx + 1 }));
  const maxZ = Math.max(...normalized.map((n) => n.z));
  const minZ = Math.min(...normalized.map((n) => n.z));
  const updated = normalized.map(({ it, z }) => {
    if (!ids.has(it.id)) return { it, z };
    const nz =
      op === "front" ? maxZ + 1 : op === "back" ? minZ - 1 : op === "forward" ? z + 1 : z - 1;
    return { it, z: clamp(nz, -999, 999) };
  });
  // Renumber cleanly to 1..N preserving relative order so z never drifts out of bounds.
  const order = [...updated].sort((a, b) => a.z - b.z);
  const rank = new Map(order.map((e, idx) => [e.it.id, idx + 1]));
  return items.map((it) => ({ ...it, z: rank.get(it.id) ?? it.z ?? 1 }));
}

/** Nudges selected unlocked items by `(dx, dy)` (cells in Grid mode, pixels in Free mode). */
export function nudgeItems(
  items: readonly LayoutItem[],
  selectedIds: ReadonlySet<string>,
  dx: number,
  dy: number,
  mode: LayoutMode,
  g: GridMetrics,
  workW: number,
  workH: number,
  stepPx = 1,
): LayoutItem[] {
  const targets = items.filter((i) => selectedIds.has(i.id) && !i.locked);
  if (targets.length === 0) return [...items];

  if (mode === "free") {
    return items.map((it) => {
      if (!selectedIds.has(it.id) || it.locked) return it;
      const r = itemRectPx(it, "free", g, workW, workH);
      const nextRect: PxRect = {
        ...r,
        x: clamp(r.x + dx * stepPx, 0, Math.max(0, workW - r.width)),
        y: clamp(r.y + dy * stepPx, 0, Math.max(0, workH - r.height)),
      };
      return {
        ...it,
        free: pxToFree(nextRect, workW, workH, it.free?.anchor),
      };
    });
  }

  // Grid mode: move in order of direction so multi-selected items don't collide with each other.
  const ordered = [...targets].sort((a, b) => {
    if (dx > 0) return b.x - a.x;
    if (dx < 0) return a.x - b.x;
    if (dy > 0) return b.y - a.y;
    return a.y - b.y;
  });
  let cur = [...items];
  for (const t of ordered) {
    const live = cur.find((i) => i.id === t.id);
    if (!live) continue;
    const next = resolveCollisions(
      cur,
      live.id,
      live.x + dx,
      live.y + dy,
      live.w,
      live.h,
      g.cols,
      g.rows,
    );
    if (next) cur = next;
  }
  return cur;
}

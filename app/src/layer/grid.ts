// Per-monitor grid engine (brief §2.4, PLAN 5.1-5.2): cell geometry from work area minus
// 24 px margins, collision resolution with minimal movement, refit on resolution/scale change,
// monitor key matching (ARCHITECTURE §3.6), and cross-display neighbor lookup.
import { grid, type SizeClass, sizes, spanPx } from "../design-system/tokens/tokens";
import type { Monitor } from "./protocol";

export interface WidgetLayoutItem {
  id: string;
  type: "widget";
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StackLayoutItem {
  id: string;
  type: "stack";
  x: number;
  y: number;
  w: number;
  h: number;
  children: string[];
  activeIndex?: number;
  smartRotate?: boolean;
}

export type LayoutItem = WidgetLayoutItem | StackLayoutItem;

export interface MonitorLayout {
  items: LayoutItem[];
}

export interface LayoutsDoc {
  version: number;
  showMissingOnPrimary: boolean;
  monitors: Record<string, MonitorLayout>;
}

export interface GridMetrics {
  cols: number;
  rows: number;
  originX: number;
  originY: number;
  cell: number;
  gap: number;
  step: number;
  width: number;
  height: number;
}

export interface PxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Computes the grid that fits inside a monitor's work area minus safe margins. */
export function computeGrid(
  workWidth: number,
  workHeight: number,
  margin: number = grid.safeMargin,
): GridMetrics {
  const step = grid.cell + grid.gap;
  const usableW = Math.max(grid.cell * 2 + grid.gap, workWidth - margin * 2);
  const usableH = Math.max(grid.cell * 2 + grid.gap, workHeight - margin * 2);
  const cols = Math.max(2, Math.floor((usableW + grid.gap) / step));
  const rows = Math.max(2, Math.floor((usableH + grid.gap) / step));
  const width = spanPx(cols);
  const height = spanPx(rows);
  const originX = Math.max(0, Math.floor((workWidth - width) / 2));
  const originY = Math.max(0, Math.floor((workHeight - height) / 2));
  return { cols, rows, originX, originY, cell: grid.cell, gap: grid.gap, step, width, height };
}

/** Pixel rectangle of an item inside its layer window. */
export function cellToPx(g: GridMetrics, x: number, y: number, w: number, h: number): PxRect {
  return {
    x: g.originX + x * g.step,
    y: g.originY + y * g.step,
    width: spanPx(w),
    height: spanPx(h),
  };
}

/** Snaps a window-local pixel top-left coordinate to the nearest in-bounds grid cell. */
export function pxToCell(
  g: GridMetrics,
  px: number,
  py: number,
  w: number,
  h: number,
): { x: number; y: number } {
  const rawX = Math.round((px - g.originX) / g.step);
  const rawY = Math.round((py - g.originY) / g.step);
  return {
    x: clamp(rawX, 0, Math.max(0, g.cols - w)),
    y: clamp(rawY, 0, Math.max(0, g.rows - h)),
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function sizeClassForSpan(w: number, h: number): SizeClass {
  for (const [k, s] of Object.entries(sizes) as [SizeClass, { w: number; h: number }][]) {
    if (s.w === w && s.h === h) return k;
  }
  if (w >= 6) return "XL";
  if (w >= 4 && h >= 4) return "L";
  if (w >= 4 && h >= 2) return "M";
  if (w >= 4) return "4x1";
  if (h === 1 && w >= 2) return "2x1";
  if (h === 1) return "1x1";
  return "S";
}

export function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function inBounds(
  r: { x: number; y: number; w: number; h: number },
  cols: number,
  rows: number,
): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= cols && r.y + r.h <= rows;
}

/** Finds the nearest free `(x, y)` cell for a `(w, h)` rect, minimizing distance to `(prefX, prefY)`. */
export function findNearestFree(
  occupied: readonly { x: number; y: number; w: number; h: number }[],
  cols: number,
  rows: number,
  w: number,
  h: number,
  prefX = 0,
  prefY = 0,
): { x: number; y: number } | null {
  if (w > cols || h > rows) return null;
  let best: { x: number; y: number; dist: number; dy: number } | null = null;
  for (let y = 0; y <= rows - h; y++) {
    for (let x = 0; x <= cols - w; x++) {
      const candidate = { x, y, w, h };
      if (occupied.some((o) => overlaps(o, candidate))) continue;
      const dist = Math.abs(x - prefX) + Math.abs(y - prefY);
      const dy = Math.abs(y - prefY);
      if (
        !best ||
        dist < best.dist ||
        (dist === best.dist && dy < best.dy) ||
        (dist === best.dist && dy === best.dy && (y < best.y || (y === best.y && x < best.x)))
      ) {
        best = { x, y, dist, dy };
      }
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}

/**
 * Places `movingId` at `(targetX, targetY, targetW, targetH)` and shifts any colliding items
 * with minimal movement. Returns `null` if no valid non-overlapping arrangement fits.
 */
export function resolveCollisions(
  items: readonly LayoutItem[],
  movingId: string,
  targetX: number,
  targetY: number,
  targetW: number,
  targetH: number,
  cols: number,
  rows: number,
): LayoutItem[] | null {
  const moving = items.find((i) => i.id === movingId);
  if (!moving) return null;
  if (targetW > cols || targetH > rows) return null;
  const placedMoving: LayoutItem = {
    ...moving,
    x: clamp(targetX, 0, cols - targetW),
    y: clamp(targetY, 0, rows - targetH),
    w: targetW,
    h: targetH,
  };

  // Start with the moving item fixed, plus all items that don't overlap it.
  const locked: LayoutItem[] = [placedMoving];
  const displaced: LayoutItem[] = [];
  for (const item of items) {
    if (item.id === movingId) continue;
    if (overlaps(item, placedMoving)) {
      displaced.push(item);
    } else {
      locked.push(item);
    }
  }
  if (displaced.length === 0) return restoreOrder(items, locked);

  // Place displaced items one by one as close as possible to their original cells.
  displaced.sort((a, b) => b.w * b.h - a.w * a.h || a.y - b.y || a.x - b.x);
  const stillFailed: LayoutItem[] = [];
  for (const d of displaced) {
    const slot = findNearestFree(locked, cols, rows, d.w, d.h, d.x, d.y);
    if (slot) {
      locked.push({ ...d, x: slot.x, y: slot.y });
    } else {
      stillFailed.push(d);
    }
  }
  if (stillFailed.length === 0) return restoreOrder(items, locked);

  // Fallback: keep the moving item fixed and repack all other items by original proximity.
  const repacked: LayoutItem[] = [placedMoving];
  const rest = items
    .filter((i) => i.id !== movingId)
    .sort((a, b) => b.w * b.h - a.w * a.h || a.y - b.y || a.x - b.x);
  for (const item of rest) {
    const slot = findNearestFree(repacked, cols, rows, item.w, item.h, item.x, item.y);
    if (!slot) return null;
    repacked.push({ ...item, x: slot.x, y: slot.y });
  }
  return restoreOrder(items, repacked);
}

function restoreOrder(
  original: readonly LayoutItem[],
  placed: readonly LayoutItem[],
): LayoutItem[] {
  const byId = new Map(placed.map((p) => [p.id, p]));
  return original.map((o) => byId.get(o.id) ?? o);
}

/**
 * Refits a layout when a monitor's resolution or scale shrinks the grid: keeps every item
 * that still fits in place, shrinks spans only if an item no longer fits the grid at all,
 * and moves out-of-bounds items with minimal movement.
 */
export function refitLayout(
  items: readonly LayoutItem[],
  cols: number,
  rows: number,
  allowedSizes?: (item: LayoutItem) => readonly SizeClass[],
): LayoutItem[] {
  const placed: LayoutItem[] = [];
  const toMove: LayoutItem[] = [];

  for (const item of items) {
    let { w, h } = item;
    if (w > cols || h > rows) {
      const allowed = allowedSizes?.(item) ?? [];
      const fitting = allowed
        .map((s) => sizes[s])
        .filter((s) => s.w <= cols && s.h <= rows)
        .sort((a, b) => b.w * b.h - a.w * a.h);
      const best = fitting[0];
      if (best) {
        w = best.w;
        h = best.h;
      } else {
        w = Math.min(w, cols);
        h = Math.min(h, rows);
      }
    }
    const candidate: LayoutItem = { ...item, w, h };
    if (inBounds(candidate, cols, rows) && !placed.some((p) => overlaps(p, candidate))) {
      placed.push(candidate);
    } else {
      toMove.push(candidate);
    }
  }

  for (const item of toMove) {
    const slot = findNearestFree(
      placed,
      cols,
      rows,
      item.w,
      item.h,
      clamp(item.x, 0, Math.max(0, cols - item.w)),
      clamp(item.y, 0, Math.max(0, rows - item.h)),
    );
    if (slot) placed.push({ ...item, x: slot.x, y: slot.y });
  }
  return restoreOrder(items, placed).filter((i) => placed.some((p) => p.id === i.id));
}

/**
 * Returns another item of the exact same `(w, h)` whose bounding box contains `(pointerX, pointerY)`
 * in window pixels, for dropping one widget onto another to create/extend a stack.
 */
export function findStackTarget(
  items: readonly LayoutItem[],
  moving: LayoutItem,
  g: GridMetrics,
  pointerX: number,
  pointerY: number,
): LayoutItem | null {
  if (moving.type !== "widget") return null;
  for (const item of items) {
    if (item.id === moving.id) continue;
    if (item.w !== moving.w || item.h !== moving.h) continue;
    const r = cellToPx(g, item.x, item.y, item.w, item.h);
    // Use an inner 65% hit zone so moving past a neighbor reflows instead of stacking unexpectedly.
    const padX = r.width * 0.18;
    const padY = r.height * 0.18;
    if (
      pointerX >= r.x + padX &&
      pointerX <= r.x + r.width - padX &&
      pointerY >= r.y + padY &&
      pointerY <= r.y + r.height - padY
    ) {
      return item;
    }
  }
  return null;
}

/** Splits `<vendor>-<product>-<serial>:<connector>` into its identity parts. */
function parseMonitorKey(key: string): {
  vendorProduct: string;
  serial: string;
  connector: string;
} {
  const colon = key.lastIndexOf(":");
  const idPart = colon >= 0 ? key.slice(0, colon) : key;
  const connector = colon >= 0 ? key.slice(colon + 1) : "";
  const lastDash = idPart.lastIndexOf("-");
  const vendorProduct = lastDash >= 0 ? idPart.slice(0, lastDash) : idPart;
  const serial = lastDash >= 0 ? idPart.slice(lastDash + 1) : "";
  return { vendorProduct, serial, connector };
}

function hasRealSerial(serial: string): boolean {
  const stripped = serial.trim().replace(/^0x/i, "");
  return stripped.length > 0 && /[^0]/.test(stripped);
}

/**
 * Matches a connected monitor to its saved layout key (ARCHITECTURE §3.6):
 * exact key → same vendor/product/non-zero serial on another connector → same connector + vendor/product.
 */
export function matchMonitorKey(monitor: Monitor, savedKeys: readonly string[]): string | null {
  if (savedKeys.includes(monitor.key)) return monitor.key;
  const targetVp = `${monitor.vendor}-${monitor.product}`;
  if (hasRealSerial(monitor.serial)) {
    const bySerial = savedKeys.find((k) => {
      const p = parseMonitorKey(k);
      return p.vendorProduct === targetVp && p.serial === monitor.serial;
    });
    if (bySerial) return bySerial;
  }
  const byConn = savedKeys.find((k) => {
    const p = parseMonitorKey(k);
    return p.connector === monitor.connector && p.vendorProduct === targetVp;
  });
  return byConn ?? null;
}

/** Saved layout keys whose monitors are currently disconnected ("waiting" layouts). */
export function waitingMonitorKeys(
  connected: readonly Monitor[],
  savedKeys: readonly string[],
): string[] {
  const matched = new Set(
    connected.map((m) => matchMonitorKey(m, savedKeys)).filter((k): k is string => k !== null),
  );
  return savedKeys.filter((k) => !matched.has(k));
}

export type MonitorEdge = "left" | "right" | "top" | "bottom";

/** Finds the neighboring monitor touching `edge` of `current`, for 600 ms cross-display drag. */
export function neighborMonitor(
  current: Monitor,
  all: readonly Monitor[],
  edge: MonitorEdge,
): Monitor | null {
  const cx1 = current.x;
  const cy1 = current.y;
  const cx2 = current.x + current.width;
  const cy2 = current.y + current.height;
  let best: { mon: Monitor; dist: number } | null = null;
  for (const m of all) {
    if (m.key === current.key) continue;
    const mx1 = m.x;
    const my1 = m.y;
    const mx2 = m.x + m.width;
    const my2 = m.y + m.height;
    const overlapY = Math.min(cy2, my2) - Math.max(cy1, my1);
    const overlapX = Math.min(cx2, mx2) - Math.max(cx1, mx1);
    let dist: number | null = null;
    if (edge === "right" && mx1 >= cx2 - 4 && overlapY > 0) dist = Math.abs(mx1 - cx2);
    else if (edge === "left" && mx2 <= cx1 + 4 && overlapY > 0) dist = Math.abs(cx1 - mx2);
    else if (edge === "bottom" && my1 >= cy2 - 4 && overlapX > 0) dist = Math.abs(my1 - cy2);
    else if (edge === "top" && my2 <= cy1 + 4 && overlapX > 0) dist = Math.abs(cy1 - my2);
    if (dist !== null && (!best || dist < best.dist)) best = { mon: m, dist };
  }
  return best?.mon ?? null;
}

/** Bounding box of all items in window pixels (plus `pad` for glass shadows), or `null` if empty. */
export function itemsBoundingBox(
  items: readonly LayoutItem[],
  g: GridMetrics,
  pad = 48,
  maxWidth = Infinity,
  maxHeight = Infinity,
): PxRect | null {
  if (items.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const it of items) {
    const r = cellToPx(g, it.x, it.y, it.w, it.h);
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  const x = Math.max(0, Math.floor(minX - pad));
  const y = Math.max(0, Math.floor(minY - pad));
  const right = Math.min(maxWidth, Math.ceil(maxX + pad));
  const bottom = Math.min(maxHeight, Math.ceil(maxY + pad));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

// Layout rules used while editing: which sizes an item may take, snapping a resize drag to
// them, and which pointer targets belong to controls inside a widget.
import { type SizeClass, sizes } from "../design-system/tokens/tokens";
import { widgetByKind } from "../widgets/registry";
import type { StoredSettings } from "../widgets/host";
import { type LayoutItem, sizeClassForSpan } from "./grid";

export function allowedSizesOf(
  item: LayoutItem,
  widgets: StoredSettings["widgets"],
): readonly SizeClass[] {
  if (item.type === "widget") return widgetByKind(item.kind)?.sizes ?? ["S"];
  let common: SizeClass[] | null = null;
  for (const cid of item.children) {
    const kind = widgets[cid]?.kind;
    const sz = kind ? [...(widgetByKind(kind)?.sizes ?? [])] : [];
    if (sz.length === 0) continue;
    common = common ? common.filter((s) => sz.includes(s)) : sz;
  }
  return common && common.length > 0 ? common : [sizeClassForSpan(item.w, item.h)];
}

/** Picks the allowed span closest to the user's resize drag target. */
export function snapResizeSpan(
  allowed: readonly SizeClass[],
  targetW: number,
  targetH: number,
  maxCols: number,
  maxRows: number,
): { w: number; h: number } {
  const candidates = allowed.map((s) => sizes[s]).filter((s) => s.w <= maxCols && s.h <= maxRows);
  let best = candidates[0] ?? { w: 2, h: 2 };
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = Math.abs(c.w - targetW) + Math.abs(c.h - targetH);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

export function isInteractiveTarget(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false;
  return Boolean(
    el.closest("button, input, select, textarea, a, [role='slider'], [role='switch']"),
  );
}

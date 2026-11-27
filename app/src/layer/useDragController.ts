// Pointer interaction on the grid and in Free mode (PLAN-2 5.3–5.4): single & multi-item drag,
// Free-mode smart alignment guides (Alt disables snapping), arbitrary pixel resize in Free mode,
// Grid-mode collision resolution & stack targets, remove zone, 600 ms cross-monitor hand-off,
// 450 ms long-press outside Edit mode, and dragging a new widget out of the picker/gallery.
import { useCallback, useRef, useState } from "react";
import { type SizeClass, sizes, spanPx } from "../design-system/tokens/tokens";
import type { StoredSettings } from "../widgets/host";
import type { DragState, ResizeEdge, ResizeState } from "./editTypes";
import { itemRectPx, pxToFree, snapFreeRect } from "./free";
import {
  type GridMetrics,
  type LayoutItem,
  type LayoutMode,
  type MonitorEdge,
  type PxRect,
  type StackLayoutItem,
  findStackTarget,
  neighborMonitor,
  pxToCell,
  resolveCollisions,
} from "./grid";
import { allowedSizesOf, isInteractiveTarget, snapResizeSpan } from "./layoutRules";
import { setEditActive } from "./modes";
import { newStackId, newWidgetId } from "./presets";
import type { Monitor } from "./protocol";

const LONG_PRESS_MS = 450;
const EDGE_HOLD_MS = 600;
const EDGE_MARGIN_PX = 24;
const REMOVE_ZONE_H = 72;
const MIN_FREE_W = 84;
const MIN_FREE_H = 84;

export interface DragControllerOptions {
  edit: boolean;
  mode: LayoutMode;
  items: LayoutItem[];
  selectedIds: ReadonlySet<string>;
  widgets: StoredSettings["widgets"];
  g: GridMetrics;
  width: number;
  height: number;
  marginPx: number;
  monitor: Monitor | null;
  monitors: Monitor[];
  onSelect: (id: string, additive?: boolean) => void;
  /** A drag began: close menus that would be in the way. */
  onDragStart: () => void;
  onClosePicker: () => void;
  /** A widget dragged out of the picker landed: give it its settings entry. */
  onAddWidget: (id: string, kind: string) => void;
  onMoveToDisplay: (item: LayoutItem, target: Monitor) => void;
  onRemove: (item: LayoutItem) => void;
  onCommit: (items: LayoutItem[]) => void;
}

export function useDragController({
  edit,
  mode,
  items,
  selectedIds,
  widgets,
  g,
  width,
  height,
  marginPx,
  monitor,
  monitors,
  onSelect,
  onDragStart,
  onClosePicker,
  onAddWidget,
  onMoveToDisplay,
  onRemove,
  onCommit,
}: DragControllerOptions) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [resize, setResize] = useState<ResizeState | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const edgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Set for a moment after a drag ends, so the release isn't also a click. */
  const suppressClick = useRef(false);

  const beginDrag = useCallback(
    (
      item: LayoutItem,
      grabX: number,
      grabY: number,
      clientX: number,
      clientY: number,
      fromPicker?: { kind: string; size: SizeClass },
    ) => {
      if (item.locked && !fromPicker) return;
      if (!selectedIds.has(item.id) || fromPicker) {
        onSelect(item.id, false);
      }
      onDragStart();

      const baseItems = fromPicker ? [...items, item] : items;
      const movingIds =
        !fromPicker && selectedIds.has(item.id) && selectedIds.size > 1
          ? baseItems.filter((i) => selectedIds.has(i.id) && !i.locked).map((i) => i.id)
          : [item.id];
      const movingSet = new Set(movingIds);
      const startRects = new Map(
        baseItems.map((i) => [i.id, itemRectPx(i, mode, g, width, height)]),
      );
      const primaryStart = startRects.get(item.id) ?? itemRectPx(item, mode, g, width, height);

      const initial: DragState = {
        mode,
        item,
        movingIds,
        grabX,
        grabY,
        startX: clientX,
        startY: clientY,
        pointerX: clientX,
        pointerY: clientY,
        preview: baseItems,
        landing: { x: item.x, y: item.y, w: item.w, h: item.h },
        ...(mode === "free" ? { freeRect: primaryStart } : {}),
        guides: [],
        stackTarget: null,
        overRemove: false,
        edge: null,
        edgeTarget: null,
        ...(fromPicker ? { fromPicker } : {}),
      };
      setDrag(initial);

      let latest = initial;
      let activeEdge: MonitorEdge | null = null;
      const clearEdgeTimer = () => {
        if (edgeTimer.current) {
          clearTimeout(edgeTimer.current);
          edgeTimer.current = null;
        }
      };

      const onMove = (ev: PointerEvent) => {
        const px = ev.clientX;
        const py = ev.clientY;
        const overRemove =
          !fromPicker &&
          movingIds.length === 1 &&
          py < REMOVE_ZONE_H &&
          Math.abs(px - width / 2) < 140;

        let stackTarget: LayoutItem | null = null;
        let preview = baseItems;
        let landing = latest.landing;
        let freeRect = latest.freeRect;
        let guides: DragState["guides"] = [];

        if (mode === "free") {
          if (!overRemove) {
            const rawX = px - grabX;
            const rawY = py - grabY;
            const others = baseItems
              .filter((i) => !movingSet.has(i.id))
              .map((i) => startRects.get(i.id) ?? itemRectPx(i, "free", g, width, height));
            const snapped = snapFreeRect(
              { x: rawX, y: rawY, width: primaryStart.width, height: primaryStart.height },
              others,
              width,
              height,
              { margin: marginPx, disableSnap: ev.altKey },
            );
            freeRect = snapped.rect;
            guides = snapped.guides;
            const dx = snapped.rect.x - primaryStart.x;
            const dy = snapped.rect.y - primaryStart.y;
            preview = baseItems.map((it) => {
              if (!movingSet.has(it.id)) return it;
              const sr = startRects.get(it.id) ?? itemRectPx(it, "free", g, width, height);
              const nextR: PxRect = {
                x: Math.max(0, Math.min(width - sr.width, sr.x + dx)),
                y: Math.max(0, Math.min(height - sr.height, sr.y + dy)),
                width: sr.width,
                height: sr.height,
              };
              const cell = pxToCell(g, nextR.x, nextR.y, it.w, it.h);
              return {
                ...it,
                x: cell.x,
                y: cell.y,
                free: pxToFree(nextR, width, height, it.free?.anchor),
              };
            });
          }
        } else {
          stackTarget =
            overRemove || movingIds.length > 1 ? null : findStackTarget(baseItems, item, g, px, py);
          if (!overRemove && !stackTarget) {
            if (movingIds.length === 1) {
              const cell = pxToCell(g, px - grabX, py - grabY, item.w, item.h);
              const resolved = resolveCollisions(
                baseItems,
                item.id,
                cell.x,
                cell.y,
                item.w,
                item.h,
                g.cols,
                g.rows,
              );
              if (resolved) {
                preview = resolved;
                const moved = resolved.find((i) => i.id === item.id);
                if (moved) landing = { x: moved.x, y: moved.y, w: moved.w, h: moved.h };
              }
            } else {
              // Multi-select group move in Grid mode: shift all selected items by (dCols, dRows).
              const dCols = Math.round((px - clientX) / g.step);
              const dRows = Math.round((py - clientY) / g.step);
              const ordered = baseItems
                .filter((i) => movingSet.has(i.id))
                .sort((a, b) => {
                  if (dCols > 0) return b.x - a.x;
                  if (dCols < 0) return a.x - b.x;
                  if (dRows > 0) return b.y - a.y;
                  return a.y - b.y;
                });
              let cur = baseItems;
              for (const m of ordered) {
                const next = resolveCollisions(
                  cur,
                  m.id,
                  m.x + dCols,
                  m.y + dRows,
                  m.w,
                  m.h,
                  g.cols,
                  g.rows,
                );
                if (next) cur = next;
              }
              preview = cur;
              const moved = cur.find((i) => i.id === item.id);
              if (moved) landing = { x: moved.x, y: moved.y, w: moved.w, h: moved.h };
            }
          }
        }

        // Detect monitor edge hold for 600 ms cross-display handoff.
        let edge: MonitorEdge | null = null;
        if (!fromPicker && movingIds.length === 1 && monitor && monitors.length > 1) {
          if (px <= EDGE_MARGIN_PX) edge = "left";
          else if (px >= width - EDGE_MARGIN_PX) edge = "right";
          else if (py <= EDGE_MARGIN_PX) edge = "top";
          else if (py >= height - EDGE_MARGIN_PX) edge = "bottom";
        }
        const edgeTarget = edge && monitor ? neighborMonitor(monitor, monitors, edge) : null;
        const nextEdge = edgeTarget ? edge : null;
        if (nextEdge !== activeEdge) {
          activeEdge = nextEdge;
          clearEdgeTimer();
          if (edgeTarget) {
            edgeTimer.current = setTimeout(() => {
              cleanup();
              setDrag(null);
              onMoveToDisplay(item, edgeTarget);
            }, EDGE_HOLD_MS);
          }
        }
        latest = {
          ...latest,
          pointerX: px,
          pointerY: py,
          preview,
          landing,
          ...(freeRect ? { freeRect } : {}),
          guides,
          stackTarget,
          overRemove,
          edge: nextEdge,
          edgeTarget,
        };
        setDrag(latest);
      };

      const finish = () => {
        cleanup();
        clearEdgeTimer();
        setDrag(null);
        suppressClick.current = true;
        setTimeout(() => {
          suppressClick.current = false;
        }, 80);

        if (latest.overRemove) {
          onRemove(item);
          return;
        }
        if (latest.fromPicker) {
          onAddWidget(item.id, latest.fromPicker.kind);
        }
        if (latest.stackTarget && item.type === "widget") {
          const target = latest.stackTarget;
          const nextStack: StackLayoutItem =
            target.type === "stack"
              ? {
                  ...target,
                  children: [...target.children, item.id],
                  activeIndex: target.children.length,
                }
              : {
                  id: newStackId(),
                  type: "stack",
                  x: target.x,
                  y: target.y,
                  w: target.w,
                  h: target.h,
                  children: [target.id, item.id],
                  activeIndex: 1,
                  smartRotate: false,
                };
          const merged = baseItems
            .filter((i) => i.id !== item.id && i.id !== target.id)
            .concat(nextStack);
          onCommit(merged);
          onSelect(nextStack.id, false);
          return;
        }
        onCommit(latest.preview);
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    },
    [
      mode,
      items,
      selectedIds,
      width,
      height,
      marginPx,
      g,
      monitor,
      monitors,
      onSelect,
      onDragStart,
      onAddWidget,
      onMoveToDisplay,
      onRemove,
      onCommit,
    ],
  );

  // Pointer down on a widget: in Edit mode drags on > 6 px move; outside Edit mode starts 450 ms long-press.
  const handlePointerDownItem = useCallback(
    (item: LayoutItem, e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 || isInteractiveTarget(e.target)) return;
      const rect = itemRectPx(item, mode, g, width, height);
      const grabX = e.clientX - rect.x;
      const grabY = e.clientY - rect.y;
      const startX = e.clientX;
      const startY = e.clientY;

      if (edit) {
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          // Multi-select toggle happens on click; don't collapse selection on pointerdown.
          return;
        }
        if (!selectedIds.has(item.id)) {
          onSelect(item.id, false);
        }
        if (item.locked) return;
        const onMove = (ev: PointerEvent) => {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 6) {
            cleanup();
            beginDrag(item, grabX, grabY, ev.clientX, ev.clientY);
          }
        };
        const cleanup = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", cleanup);
          window.removeEventListener("pointercancel", cleanup);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", cleanup);
        window.addEventListener("pointercancel", cleanup);
        return;
      }

      if (item.locked) return;
      // Outside Edit mode: 450 ms long-press without movement enters Edit mode and continues dragging.
      let curX = startX;
      let curY = startY;
      const clearLP = () => {
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", clearLP);
        window.removeEventListener("pointercancel", clearLP);
      };
      const onMove = (ev: PointerEvent) => {
        curX = ev.clientX;
        curY = ev.clientY;
        if (Math.hypot(curX - startX, curY - startY) > 6) clearLP();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", clearLP);
      window.addEventListener("pointercancel", clearLP);
      longPressTimer.current = setTimeout(() => {
        clearLP();
        void setEditActive(true);
        beginDrag(item, grabX, grabY, curX, curY);
      }, LONG_PRESS_MS);
    },
    [edit, mode, g, width, height, selectedIds, beginDrag, onSelect],
  );

  // Resize handle drag (Grid snaps to allowed size classes; Free allows arbitrary pixels within bounds).
  const handleStartResize = useCallback(
    (item: LayoutItem, edge: ResizeEdge, e: React.PointerEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      if (e.button !== 0 || item.locked) return;
      const allowed = allowedSizesOf(item, widgets);
      const startX = e.clientX;
      const startY = e.clientY;
      const startRect = itemRectPx(item, mode, g, width, height);
      let latest: ResizeState = {
        mode,
        item,
        edge,
        startX,
        startY,
        preview: items,
        current: { x: item.x, y: item.y, w: item.w, h: item.h },
        ...(mode === "free" ? { freeRect: startRect } : {}),
        guides: [],
      };
      setResize(latest);

      const onMove = (ev: PointerEvent) => {
        if (mode === "free") {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          let x = startRect.x;
          let y = startRect.y;
          let w = startRect.width;
          let h = startRect.height;
          if (edge === "e") w = Math.max(MIN_FREE_W, Math.min(width - x, startRect.width + dx));
          if (edge === "s") h = Math.max(MIN_FREE_H, Math.min(height - y, startRect.height + dy));
          if (edge === "w") {
            const maxLeft = startRect.x + startRect.width - MIN_FREE_W;
            x = Math.max(0, Math.min(maxLeft, startRect.x + dx));
            w = startRect.x + startRect.width - x;
          }
          if (edge === "n") {
            const maxTop = startRect.y + startRect.height - MIN_FREE_H;
            y = Math.max(0, Math.min(maxTop, startRect.y + dy));
            h = startRect.y + startRect.height - y;
          }
          const nextRect: PxRect = {
            x: Math.round(x),
            y: Math.round(y),
            width: Math.round(w),
            height: Math.round(h),
          };
          const preview = items.map((it) =>
            it.id === item.id
              ? { ...it, free: pxToFree(nextRect, width, height, it.free?.anchor) }
              : it,
          );
          latest = { ...latest, preview, freeRect: nextRect, guides: [] };
          setResize(latest);
          return;
        }

        const dCols = Math.round((ev.clientX - startX) / g.step);
        const dRows = Math.round((ev.clientY - startY) / g.step);
        const wantW = edge === "e" ? item.w + dCols : edge === "w" ? item.w - dCols : item.w;
        const wantH = edge === "s" ? item.h + dRows : edge === "n" ? item.h - dRows : item.h;
        const snapped = snapResizeSpan(allowed, wantW, wantH, g.cols, g.rows);
        const nx = edge === "w" ? item.x + (item.w - snapped.w) : item.x;
        const ny = edge === "n" ? item.y + (item.h - snapped.h) : item.y;
        const resolved = resolveCollisions(
          items,
          item.id,
          nx,
          ny,
          snapped.w,
          snapped.h,
          g.cols,
          g.rows,
        );
        if (resolved) {
          const moved = resolved.find((i) => i.id === item.id);
          if (moved) {
            latest = {
              ...latest,
              preview: resolved,
              current: { x: moved.x, y: moved.y, w: moved.w, h: moved.h },
            };
            setResize(latest);
          }
        }
      };

      const finish = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        setResize(null);
        onCommit(latest.preview);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    },
    [mode, widgets, items, g, width, height, onCommit],
  );

  // Drag fresh widget from Widget Picker/Gallery onto the monitor.
  const handlePickerDragStart = useCallback(
    (kind: string, size: SizeClass, clientX: number, clientY: number) => {
      onClosePicker();
      const span = sizes[size];
      const wPx = spanPx(span.w, g.cell);
      const hPx = spanPx(span.h, g.cell);
      const cell = pxToCell(g, clientX - wPx / 2, clientY - hPx / 2, span.w, span.h);
      const freeRect =
        mode === "free"
          ? pxToFree(
              { x: clientX - wPx / 2, y: clientY - hPx / 2, width: wPx, height: hPx },
              width,
              height,
            )
          : undefined;
      const item: LayoutItem = {
        id: newWidgetId(kind),
        type: "widget",
        kind,
        x: cell.x,
        y: cell.y,
        w: span.w,
        h: span.h,
        ...(freeRect ? { free: freeRect, z: items.length + 1 } : {}),
      };
      beginDrag(item, wPx / 2, hPx / 2, clientX, clientY, { kind, size });
    },
    [mode, g, width, height, items.length, beginDrag, onClosePicker],
  );

  /** Drops any drag or resize in progress (Edit mode ended). */
  const cancel = useCallback(() => {
    setDrag(null);
    setResize(null);
  }, []);

  /** True for a moment after a drag ends, so the release isn't taken as a click. */
  const isClickSuppressed = useCallback(() => suppressClick.current, []);

  return {
    drag,
    resize,
    cancel,
    isClickSuppressed,
    onPointerDownItem: handlePointerDownItem,
    onStartResize: handleStartResize,
    onPickerDragStart: handlePickerDragStart,
  };
}

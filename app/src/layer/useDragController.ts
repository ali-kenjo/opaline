// Pointer interaction on the grid: drag to move (with stack targets, the remove zone and
// cross-monitor hand-off at the edges), long-press outside Edit mode, resize handles, and
// dragging a new widget out of the picker (split out of LayerApp.tsx).
import { useCallback, useRef, useState } from "react";
import { type SizeClass, sizes, spanPx } from "../design-system/tokens/tokens";
import type { StoredSettings } from "../widgets/host";
import type { DragState, ResizeEdge, ResizeState } from "./editTypes";
import {
  type GridMetrics,
  type LayoutItem,
  type MonitorEdge,
  type StackLayoutItem,
  cellToPx,
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

export interface DragControllerOptions {
  edit: boolean;
  items: LayoutItem[];
  widgets: StoredSettings["widgets"];
  g: GridMetrics;
  width: number;
  height: number;
  monitor: Monitor | null;
  monitors: Monitor[];
  onSelect: (id: string) => void;
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
  items,
  widgets,
  g,
  width,
  height,
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

  // Begin dragging an item (from Edit mode pointer-down, long-press, or Widget Picker).
  const beginDrag = useCallback(
    (
      item: LayoutItem,
      grabX: number,
      grabY: number,
      clientX: number,
      clientY: number,
      fromPicker?: { kind: string; size: SizeClass },
    ) => {
      onSelect(item.id);
      onDragStart();
      const baseItems = fromPicker ? [...items, item] : items;
      const initial: DragState = {
        item,
        grabX,
        grabY,
        pointerX: clientX,
        pointerY: clientY,
        preview: baseItems,
        landing: { x: item.x, y: item.y, w: item.w, h: item.h },
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
        const overRemove = !fromPicker && py < REMOVE_ZONE_H && Math.abs(px - width / 2) < 140;
        const stackTarget = overRemove ? null : findStackTarget(baseItems, item, g, px, py);
        let preview = baseItems;
        let landing = latest.landing;
        if (!overRemove && !stackTarget) {
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
        }
        // Detect monitor edge hold for 600 ms cross-display handoff.
        let edge: MonitorEdge | null = null;
        if (!fromPicker && monitor && monitors.length > 1) {
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
          onSelect(nextStack.id);
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
      items,
      width,
      height,
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
      const rect = cellToPx(g, item.x, item.y, item.w, item.h);
      const grabX = e.clientX - rect.x;
      const grabY = e.clientY - rect.y;
      const startX = e.clientX;
      const startY = e.clientY;

      if (edit) {
        onSelect(item.id);
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
    [edit, g, beginDrag, onSelect],
  );

  // Resize handle drag.
  const handleStartResize = useCallback(
    (item: LayoutItem, edge: ResizeEdge, e: React.PointerEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      const allowed = allowedSizesOf(item, widgets);
      const startX = e.clientX;
      const startY = e.clientY;
      let latest: ResizeState = {
        item,
        edge,
        startX,
        startY,
        preview: items,
        current: { x: item.x, y: item.y, w: item.w, h: item.h },
      };
      setResize(latest);

      const onMove = (ev: PointerEvent) => {
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
    [widgets, items, g.step, g.cols, g.rows, onCommit],
  );

  // Drag fresh widget from Widget Picker onto the grid.
  const handlePickerDragStart = useCallback(
    (kind: string, size: SizeClass, clientX: number, clientY: number) => {
      onClosePicker();
      const span = sizes[size];
      const cell = pxToCell(
        g,
        clientX - spanPx(span.w) / 2,
        clientY - spanPx(span.h) / 2,
        span.w,
        span.h,
      );
      const item: LayoutItem = {
        id: newWidgetId(kind),
        type: "widget",
        kind,
        x: cell.x,
        y: cell.y,
        w: span.w,
        h: span.h,
      };
      beginDrag(item, spanPx(span.w) / 2, spanPx(span.h) / 2, clientX, clientY, { kind, size });
    },
    [g, beginDrag, onClosePicker],
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

// The keyboard model of Edit mode (brief 1.0 §2.2 + 2.0 §6.2):
// Tab/Shift+Tab select; arrows nudge (1 cell on Grid; 1 px or Shift+10 px in Free mode);
// Shift+arrows resize in Grid mode; Delete removes; Enter opens settings/inspector;
// Ctrl+D duplicates; Ctrl+C/V copies & pastes across monitors; Ctrl+A selects all;
// Escape closes popups or leaves Edit mode; Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y undo & redo.
import { useEffect, useLayoutEffect, useRef } from "react";
import type { StoredSettings } from "../widgets/host";
import { nudgeItems } from "./free";
import { type GridMetrics, type LayoutItem, type LayoutMode, resolveCollisions } from "./grid";
import { allowedSizesOf, snapResizeSpan } from "./layoutRules";
import { setEditActive } from "./modes";

export interface EditKeyboardOptions {
  /** Edit mode is on and no sheet, picker or menu has the keyboard. */
  active: boolean;
  mode: LayoutMode;
  items: LayoutItem[];
  selectedIds: ReadonlySet<string>;
  primarySelectedId: string | null;
  setSelectedId: (id: string) => void;
  setSelectedIds: (ids: ReadonlySet<string>) => void;
  widgets: StoredSettings["widgets"];
  g: GridMetrics;
  width: number;
  height: number;
  hasOpenPopover: boolean;
  closePopovers: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDuplicate: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onRemoveSelected: () => void;
  onOpen: (item: LayoutItem) => void;
  onCommit: (items: LayoutItem[]) => void;
}

export function useEditKeyboard(options: EditKeyboardOptions): void {
  // The listener is registered once per Edit session and reads the latest options from here.
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });

  const { active } = options;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const o = latest.current;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) o.onRedo();
        else o.onUndo();
        return;
      }
      if (mod && key === "y") {
        e.preventDefault();
        o.onRedo();
        return;
      }
      if (mod && key === "d") {
        e.preventDefault();
        o.onDuplicate();
        return;
      }
      if (mod && key === "c" && !e.shiftKey) {
        e.preventDefault();
        o.onCopy();
        return;
      }
      if (mod && key === "v" && !e.shiftKey) {
        e.preventDefault();
        o.onPaste();
        return;
      }
      if (mod && key === "a") {
        e.preventDefault();
        o.setSelectedIds(new Set(o.items.map((i) => i.id)));
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (o.hasOpenPopover) o.closePopovers();
        else void setEditActive(false);
        return;
      }
      if (e.key === "Tab" && o.items.length > 0) {
        e.preventDefault();
        const idx = o.items.findIndex((i) => i.id === o.primarySelectedId);
        const delta = e.shiftKey ? -1 : 1;
        const next = o.items[(idx + delta + o.items.length) % o.items.length];
        if (next) o.setSelectedId(next.id);
        return;
      }
      if (o.selectedIds.size === 0) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        o.onRemoveSelected();
        return;
      }
      const primary = o.items.find((i) => i.id === o.primarySelectedId);
      if (e.key === "Enter" && primary) {
        e.preventDefault();
        o.onOpen(primary);
        return;
      }
      const dx = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      const dy = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
      if (dx === 0 && dy === 0) return;
      e.preventDefault();

      if (
        o.mode === "grid" &&
        e.shiftKey &&
        primary &&
        o.selectedIds.size === 1 &&
        !primary.locked
      ) {
        const allowed = allowedSizesOf(primary, o.widgets);
        const span = snapResizeSpan(
          allowed,
          primary.w + dx * 2,
          primary.h + dy * 2,
          o.g.cols,
          o.g.rows,
        );
        if (span.w !== primary.w || span.h !== primary.h) {
          const next = resolveCollisions(
            o.items,
            primary.id,
            primary.x,
            primary.y,
            span.w,
            span.h,
            o.g.cols,
            o.g.rows,
          );
          if (next) o.onCommit(next);
        }
        return;
      }

      const stepPx = o.mode === "free" ? (e.shiftKey ? 10 : 1) : 1;
      const next = nudgeItems(
        o.items,
        o.selectedIds,
        dx,
        dy,
        o.mode,
        o.g,
        o.width,
        o.height,
        stepPx,
      );
      o.onCommit(next);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [active]);
}

// The keyboard model of Edit mode (brief 1.0 §2.2): Tab/Shift+Tab select, arrows move one cell,
// Shift+arrows resize to the next allowed size, Delete removes, Enter opens settings, Escape
// leaves, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y undo and redo.
import { useEffect, useLayoutEffect, useRef } from "react";
import type { StoredSettings } from "../widgets/host";
import { type LayoutItem, resolveCollisions } from "./grid";
import { allowedSizesOf, snapResizeSpan } from "./layoutRules";
import { setEditActive } from "./modes";

export interface EditKeyboardOptions {
  /** Edit mode is on and no sheet, picker or menu has the keyboard. */
  active: boolean;
  items: LayoutItem[];
  selectedId: string | null;
  setSelectedId: (id: string) => void;
  widgets: StoredSettings["widgets"];
  cols: number;
  rows: number;
  presetsOpen: boolean;
  closePresets: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onRemove: (item: LayoutItem) => void;
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
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) o.onRedo();
        else o.onUndo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        o.onRedo();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (o.presetsOpen) o.closePresets();
        else void setEditActive(false);
        return;
      }
      if (e.key === "Tab" && o.items.length > 0) {
        e.preventDefault();
        const idx = o.items.findIndex((i) => i.id === o.selectedId);
        const delta = e.shiftKey ? -1 : 1;
        const next = o.items[(idx + delta + o.items.length) % o.items.length];
        if (next) o.setSelectedId(next.id);
        return;
      }
      const sel = o.items.find((i) => i.id === o.selectedId);
      if (!sel) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        o.onRemove(sel);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        o.onOpen(sel);
        return;
      }
      const dx = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      const dy = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
      if (dx === 0 && dy === 0) return;
      e.preventDefault();
      if (e.shiftKey) {
        const allowed = allowedSizesOf(sel, o.widgets);
        const span = snapResizeSpan(allowed, sel.w + dx * 2, sel.h + dy * 2, o.cols, o.rows);
        if (span.w !== sel.w || span.h !== sel.h) {
          const next = resolveCollisions(
            o.items,
            sel.id,
            sel.x,
            sel.y,
            span.w,
            span.h,
            o.cols,
            o.rows,
          );
          if (next) o.onCommit(next);
        }
      } else {
        const next = resolveCollisions(
          o.items,
          sel.id,
          sel.x + dx,
          sel.y + dy,
          sel.w,
          sel.h,
          o.cols,
          o.rows,
        );
        if (next) o.onCommit(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [active]);
}

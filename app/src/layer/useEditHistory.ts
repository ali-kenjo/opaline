// Undo/redo of layout changes within one Edit session. Every step sends the whole resulting
// layout to core as one command; core stays the only writer.
import { useCallback, useState } from "react";
import { updateLayouts } from "../widgets/layerHost";
import type { LayoutsDoc } from "./grid";

/** Steps kept per Edit session. */
const DEPTH = 30;

export interface EditHistory {
  /** Sends `next` to core, remembering `current` for undo unless `recordUndo` is false. */
  commit: (next: LayoutsDoc, recordUndo?: boolean) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Forgets the session (called when Edit mode ends). */
  clear: () => void;
}

export function useEditHistory(current: LayoutsDoc): EditHistory {
  const [undoStack, setUndoStack] = useState<LayoutsDoc[]>([]);
  const [redoStack, setRedoStack] = useState<LayoutsDoc[]>([]);

  const commit = useCallback(
    (next: LayoutsDoc, recordUndo = true) => {
      if (recordUndo) {
        setUndoStack((prev) => [...prev.slice(-(DEPTH - 1)), current]);
        setRedoStack([]);
      }
      void updateLayouts(next);
    },
    [current],
  );

  const undo = useCallback(() => {
    const prev = undoStack[undoStack.length - 1];
    if (!prev) return;
    setUndoStack((s) => s.slice(0, -1));
    setRedoStack((s) => [...s, current]);
    void updateLayouts(prev);
  }, [undoStack, current]);

  const redo = useCallback(() => {
    const next = redoStack[redoStack.length - 1];
    if (!next) return;
    setRedoStack((s) => s.slice(0, -1));
    setUndoStack((s) => [...s, current]);
    void updateLayouts(next);
  }, [redoStack, current]);

  const clear = useCallback(() => {
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  return {
    commit,
    undo,
    redo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    clear,
  };
}

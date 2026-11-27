// Unified Edit-session undo/redo (PLAN-2 5.2, brief §6.1): one history stack per Edit session
// covering layout changes, widget styles, kind/global styles, content, theme, and Desktop look.
import { useCallback, useState } from "react";
import type { StoredSettings } from "../widgets/host";
import type { Json } from "../widgets/json";
import { updateLayouts, updateSettings } from "../widgets/layerHost";
import type { LayoutsDoc } from "./grid";
import type { CommandResult } from "./protocol";

/** Steps kept per Edit session. */
const DEPTH = 40;

export interface EditSnapshot {
  layouts: LayoutsDoc;
  settings: StoredSettings;
}

function isPlainObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isPlainObj(a) && isPlainObj(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

/** Computes a minimal RFC 7396 JSON merge patch turning `from` into `to`. */
function mergePatchObject(
  from: Record<string, unknown>,
  to: Record<string, unknown>,
): Record<string, Json> | null {
  const out: Record<string, Json> = {};
  let changed = false;

  for (const k of Object.keys(from)) {
    if (!Object.hasOwn(to, k) || to[k] === undefined) {
      out[k] = null;
      changed = true;
    }
  }
  for (const [k, tv] of Object.entries(to)) {
    if (tv === undefined) continue;
    const fv = from[k];
    if (deepEqual(fv, tv)) continue;
    changed = true;
    if (isPlainObj(fv) && isPlainObj(tv)) {
      const sub = mergePatchObject(fv, tv);
      if (sub) out[k] = sub;
    } else {
      out[k] = tv as Json;
    }
  }
  return changed ? out : null;
}

function settingsToJson(s: StoredSettings): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    style: s.style,
    styles: s.styles,
    widgets: s.widgets,
  };
  if (s.theme !== undefined) obj.theme = s.theme;
  if (s.kindStyles !== undefined) obj.kindStyles = s.kindStyles;
  if (s.look) {
    obj.appearance = {
      look: s.look.look,
      masterTransparency: s.look.masterTransparency,
      ...(s.look.lookColor ? { lookColor: s.look.lookColor } : {}),
    };
  }
  return obj;
}

/** Minimal RFC 7396 merge patch restoring `target` settings from `current`. */
export function settingsDiffPatch(
  current: StoredSettings,
  target: StoredSettings,
): Record<string, Json> | null {
  return mergePatchObject(settingsToJson(current), settingsToJson(target));
}

export interface EditHistory {
  /** Sends `next` layouts to core, recording the current snapshot unless `recordUndo` is false. */
  commit: (next: LayoutsDoc, recordUndo?: boolean) => void;
  /** Sends a settings/style/content/theme patch to core, recording one undo step. */
  commitSettings: (patch: Record<string, Json>, recordUndo?: boolean) => Promise<CommandResult>;
  /** Sends both a layout change and settings patch as a single atomic undo step. */
  commitBoth: (
    nextLayouts: LayoutsDoc,
    settingsPatch: Record<string, Json>,
    recordUndo?: boolean,
  ) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Forgets the session (called when Edit mode ends). */
  clear: () => void;
}

export function useEditHistory(
  currentLayouts: LayoutsDoc,
  currentSettings: StoredSettings,
): EditHistory {
  const [undoStack, setUndoStack] = useState<EditSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<EditSnapshot[]>([]);

  const pushUndo = useCallback(() => {
    const snap: EditSnapshot = { layouts: currentLayouts, settings: currentSettings };
    setUndoStack((prev) => [...prev.slice(-(DEPTH - 1)), snap]);
    setRedoStack([]);
  }, [currentLayouts, currentSettings]);

  const commit = useCallback(
    (next: LayoutsDoc, recordUndo = true) => {
      if (recordUndo) pushUndo();
      void updateLayouts(next);
    },
    [pushUndo],
  );

  const commitSettings = useCallback(
    async (patch: Record<string, Json>, recordUndo = true): Promise<CommandResult> => {
      if (recordUndo) pushUndo();
      return await updateSettings(patch);
    },
    [pushUndo],
  );

  const commitBoth = useCallback(
    (nextLayouts: LayoutsDoc, settingsPatch: Record<string, Json>, recordUndo = true) => {
      if (recordUndo) pushUndo();
      void updateSettings(settingsPatch);
      void updateLayouts(nextLayouts);
    },
    [pushUndo],
  );

  const applySnapshot = useCallback(
    (target: EditSnapshot) => {
      if (!deepEqual(currentLayouts, target.layouts)) {
        void updateLayouts(target.layouts);
      }
      const patch = settingsDiffPatch(currentSettings, target.settings);
      if (patch) {
        void updateSettings(patch);
      }
    },
    [currentLayouts, currentSettings],
  );

  const undo = useCallback(() => {
    const prev = undoStack[undoStack.length - 1];
    if (!prev) return;
    setUndoStack((s) => s.slice(0, -1));
    setRedoStack((s) => [...s, { layouts: currentLayouts, settings: currentSettings }]);
    applySnapshot(prev);
  }, [undoStack, currentLayouts, currentSettings, applySnapshot]);

  const redo = useCallback(() => {
    const next = redoStack[redoStack.length - 1];
    if (!next) return;
    setRedoStack((s) => s.slice(0, -1));
    setUndoStack((s) => [...s, { layouts: currentLayouts, settings: currentSettings }]);
    applySnapshot(next);
  }, [redoStack, currentLayouts, currentSettings, applySnapshot]);

  const clear = useCallback(() => {
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  return {
    commit,
    commitSettings,
    commitBoth,
    undo,
    redo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    clear,
  };
}

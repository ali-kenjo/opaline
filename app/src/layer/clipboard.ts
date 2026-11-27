// Cross-monitor Edit clipboard (brief §6.2): stores copied widgets/stacks in localStorage
// (shared across all layer windows on the same origin) with an in-memory fallback.
import type { StoredWidget } from "../widgets/host";
import type { LayoutItem } from "./grid";

const STORAGE_KEY = "opaline.edit.clipboard.v1";

export interface EditClipboardPayload {
  items: LayoutItem[];
  widgets: Record<string, StoredWidget>;
}

let memoryFallback: EditClipboardPayload | null = null;

export function writeEditClipboard(payload: EditClipboardPayload): void {
  memoryFallback = payload;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Restricted storage environment; in-memory fallback still works within this window.
  }
}

export function readEditClipboard(): EditClipboardPayload | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        Array.isArray((parsed as EditClipboardPayload).items) &&
        typeof (parsed as EditClipboardPayload).widgets === "object"
      ) {
        return parsed as EditClipboardPayload;
      }
    }
  } catch {
    // Fall back to in-memory copy.
  }
  return memoryFallback;
}

// State shared by Edit mode's controllers and overlays (split out of LayerApp.tsx).
import type { SizeClass } from "../design-system/tokens/tokens";
import type { LayoutItem, LayoutsDoc, MonitorEdge, PxRect } from "./grid";
import type { Monitor } from "./protocol";

export type ResizeEdge = "n" | "s" | "e" | "w";

export interface DragState {
  item: LayoutItem;
  grabX: number;
  grabY: number;
  pointerX: number;
  pointerY: number;
  preview: LayoutItem[];
  landing: { x: number; y: number; w: number; h: number };
  stackTarget: LayoutItem | null;
  overRemove: boolean;
  edge: MonitorEdge | null;
  edgeTarget: Monitor | null;
  /** True when dragged fresh from the Widget Picker (adds to settings + layout on drop). */
  fromPicker?: { kind: string; size: SizeClass };
}

export interface ResizeState {
  item: LayoutItem;
  edge: ResizeEdge;
  startX: number;
  startY: number;
  preview: LayoutItem[];
  current: { x: number; y: number; w: number; h: number };
}

export interface ContextMenuState {
  item: LayoutItem;
  x: number;
  y: number;
}

export interface DetailState {
  widgetId: string;
  kind: string;
  origin: PxRect | null;
}

export interface UndoToast {
  message: string;
  previous: LayoutsDoc;
}

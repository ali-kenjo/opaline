// State shared by Edit mode's controllers and overlays (split out of LayerApp.tsx).
import type { SizeClass } from "../design-system/tokens/tokens";
import type { GuideLine } from "./free";
import type { LayoutItem, LayoutMode, LayoutsDoc, MonitorEdge, PxRect } from "./grid";
import type { Monitor } from "./protocol";

export type ResizeEdge = "n" | "s" | "e" | "w";

export interface DragState {
  mode: LayoutMode;
  item: LayoutItem;
  /** IDs moving together (single item or multi-selected group). */
  movingIds: string[];
  grabX: number;
  grabY: number;
  startX: number;
  startY: number;
  pointerX: number;
  pointerY: number;
  preview: LayoutItem[];
  landing: { x: number; y: number; w: number; h: number };
  freeRect?: PxRect;
  guides: GuideLine[];
  stackTarget: LayoutItem | null;
  overRemove: boolean;
  edge: MonitorEdge | null;
  edgeTarget: Monitor | null;
  /** True when dragged fresh from the Widget Picker/Gallery (adds to settings + layout on drop). */
  fromPicker?: { kind: string; size: SizeClass };
}

export interface ResizeState {
  mode: LayoutMode;
  item: LayoutItem;
  edge: ResizeEdge;
  startX: number;
  startY: number;
  preview: LayoutItem[];
  current: { x: number; y: number; w: number; h: number };
  freeRect?: PxRect;
  guides: GuideLine[];
}

export interface MarqueeState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
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

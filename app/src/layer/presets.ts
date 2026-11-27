// Starter presets (brief §2.8, PLAN 5.8) and migration from Phase 4's flat settings.widgets
// into the Phase 5 grid layout.
import { type SizeClass, sizes } from "../design-system/tokens/tokens";
import type { StoredWidget } from "../widgets/host";
import { widgetByKind } from "../widgets/registry";
import { type LayoutItem, findNearestFree, refitLayout } from "./grid";
import { type LookStarterLayout, starterLayoutForTheme } from "./starterLayouts";
import type { Json } from "../widgets/json";

export {
  BUILTIN_LOOK_IDS,
  LOOK_STARTER_LAYOUTS,
  starterLayoutForTheme,
  type BuiltinLookId,
  type LookStarterLayout,
  type StarterWidgetEntry,
} from "./starterLayouts";

export interface PresetSpec {
  id: string;
  name: string;
  description: string;
  entries: readonly { kind: string; size: SizeClass }[];
}

export const PRESETS: readonly PresetSpec[] = [
  {
    id: "essentials",
    name: "Essentials",
    description: "Clock, CPU, memory, network and weather",
    entries: [
      { kind: "clock", size: "M" },
      { kind: "cpu", size: "S" },
      { kind: "memory", size: "S" },
      { kind: "network", size: "S" },
      { kind: "weather", size: "M" },
    ],
  },
  {
    id: "performance",
    name: "Performance",
    description: "CPU, memory, GPU, storage, network and fans",
    entries: [
      { kind: "cpu", size: "M" },
      { kind: "memory", size: "M" },
      { kind: "gpu", size: "M" },
      { kind: "storage", size: "M" },
      { kind: "network", size: "S" },
      { kind: "fans", size: "S" },
    ],
  },
  {
    id: "creator",
    name: "Creator",
    description: "Clock, Now Playing, visualizer, GPU, storage and CPU",
    entries: [
      { kind: "clock", size: "M" },
      { kind: "media", size: "M" },
      { kind: "visualizer", size: "M" },
      { kind: "gpu", size: "M" },
      { kind: "cpu", size: "S" },
      { kind: "storage", size: "S" },
    ],
  },
  {
    id: "developer",
    name: "Developer",
    description: "Clock, CPU, memory, Docker, processes and network",
    entries: [
      { kind: "clock", size: "S" },
      { kind: "cpu", size: "M" },
      { kind: "memory", size: "M" },
      { kind: "docker", size: "L" },
      { kind: "processes", size: "M" },
      { kind: "network", size: "S" },
    ],
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Just the clock and weather",
    entries: [
      { kind: "clock", size: "M" },
      { kind: "weather", size: "S" },
    ],
  },
];

let seq = 0;

export function newWidgetId(kind: string): string {
  seq = (seq + 1) % 10000;
  return `w_${kind}_${Date.now().toString(36)}_${seq.toString(36)}`;
}

export function newStackId(): string {
  seq = (seq + 1) % 10000;
  return `s_${Date.now().toString(36)}_${seq.toString(36)}`;
}

/** Places a theme's curated starter layout onto the top-right columns of a `cols × rows` grid. */
export function buildStarterLayout(
  themeIdOrSpec: string | LookStarterLayout,
  cols: number,
  rows: number,
): {
  items: LayoutItem[];
  widgets: Record<string, { kind: string; content?: Record<string, Json> }>;
} {
  const spec =
    typeof themeIdOrSpec === "string" ? starterLayoutForTheme(themeIdOrSpec) : themeIdOrSpec;
  const placed: LayoutItem[] = [];
  const widgets: Record<string, { kind: string; content?: Record<string, Json> }> = {};
  for (const entry of spec.entries) {
    const def = widgetByKind(entry.kind);
    if (!def) continue;
    const { w, h } = sizes[entry.size];
    const slot = findNearestFree(placed, cols, rows, w, h, Math.max(0, cols - w), 0);
    if (!slot) continue;
    const id = newWidgetId(entry.kind);
    placed.push({ id, type: "widget", kind: entry.kind, x: slot.x, y: slot.y, w, h });
    widgets[id] = entry.content
      ? { kind: entry.kind, content: entry.content }
      : { kind: entry.kind };
  }
  return {
    items: refitLayout(placed, cols, rows, (it) =>
      it.type === "widget" ? (widgetByKind(it.kind)?.sizes ?? ["S"]) : ["S"],
    ),
    widgets,
  };
}

/** Places a preset onto the top-right columns of a `cols × rows` grid. */
export function buildPreset(
  preset: PresetSpec,
  cols: number,
  rows: number,
): { items: LayoutItem[]; widgets: Record<string, { kind: string }> } {
  const placed: LayoutItem[] = [];
  const widgets: Record<string, { kind: string }> = {};
  for (const entry of preset.entries) {
    const def = widgetByKind(entry.kind);
    if (!def) continue;
    const { w, h } = sizes[entry.size];
    const slot = findNearestFree(placed, cols, rows, w, h, Math.max(0, cols - w), 0);
    if (!slot) continue;
    const id = newWidgetId(entry.kind);
    placed.push({ id, type: "widget", kind: entry.kind, x: slot.x, y: slot.y, w, h });
    widgets[id] = { kind: entry.kind };
  }
  return {
    items: refitLayout(placed, cols, rows, (it) =>
      it.type === "widget" ? (widgetByKind(it.kind)?.sizes ?? ["S"]) : ["S"],
    ),
    widgets,
  };
}

/** Migrates Phase 4's flat `settings.widgets` into a top-right grid layout (preserving IDs & styles). */
export function migrateWidgetsToGrid(
  widgets: Readonly<Record<string, StoredWidget>>,
  cols: number,
  rows: number,
): LayoutItem[] {
  const placed: LayoutItem[] = [];
  for (const [id, w] of Object.entries(widgets)) {
    const def = widgetByKind(w.kind);
    if (!def) continue;
    const span = sizes[def.defaultSize];
    const slot = findNearestFree(placed, cols, rows, span.w, span.h, Math.max(0, cols - span.w), 0);
    if (!slot) continue;
    placed.push({ id, type: "widget", kind: w.kind, x: slot.x, y: slot.y, w: span.w, h: span.h });
  }
  return placed;
}

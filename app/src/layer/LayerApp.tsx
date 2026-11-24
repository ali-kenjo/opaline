// The widget layer of one monitor (Phase 5): per-monitor grid, Edit mode (move, resize, stack,
// remove with 5 s undo snackbar, undo/redo, keyboard navigation, cross-display moves, widget
// picker, presets), glass context menu, shared-element detail views, Peek, Automatic appearance,
// and tight WebGL2 canvas bounds outside Edit/Peek.
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cssVariables } from "../design-system/color/scheme";
import { Button, ContextMenu, type MenuItem, Snackbar, Toolbar } from "../design-system/components";
import { GlassStage, useGlassSync } from "../design-system/glass";
import { luminance as lum } from "../design-system/glass/legibility";
import { Icon } from "../design-system/icons";
import { applyPalette, scheduler, setReducedMotion } from "../design-system/motion";
import { resolveStyle, rolesFor, sanitizeStyle } from "../design-system/style";
import { type SizeClass, sizes, spanPx } from "../design-system/tokens/tokens";
import { applyDocumentLocale, isRtl, resolveLocale, t } from "../i18n";
import { HostContext, type StoredSettings } from "../widgets/host";
import { toJson } from "../widgets/json";
import {
  APPEARANCE_TOPIC,
  LAYOUTS_TOPIC,
  WALLPAPER_TOPIC,
  attachLayer,
  storedLayouts,
  updateLayouts,
  useCoreHost,
} from "../widgets/layerHost";
import { widgetByKind } from "../widgets/registry";
import { WidgetSettings } from "../widgets/settings/WidgetSettings";
import { WidgetFrame } from "../widgets/WidgetFrame";
import { inTauri, report, setInputRegion } from "./bridge";
import { DetailModal } from "./DetailModal";
import {
  type GridMetrics,
  type LayoutItem,
  type LayoutsDoc,
  type MonitorEdge,
  type PxRect,
  type StackLayoutItem,
  cellToPx,
  computeGrid,
  findNearestFree,
  findStackTarget,
  matchMonitorKey,
  neighborMonitor,
  pxToCell,
  refitLayout,
  resolveCollisions,
  sizeClassForSpan,
  waitingMonitorKeys,
} from "./grid";
import {
  PRESETS,
  type PresetSpec,
  buildPreset,
  migrateWidgetsToGrid,
  newStackId,
  newWidgetId,
} from "./presets";
import type { Monitor } from "./protocol";
import { SpringSlot } from "./SpringSlot";
import { StackEditor, StackWidget } from "./StackWidget";
import { useLayer } from "./store";
import { WidgetPicker } from "./WidgetPicker";
import styles from "./LayerApp.module.css";

/** Written to settings on first run, so editing one doesn't make the others disappear. */
const DEFAULT_WIDGETS = {
  "a-clock": { kind: "clock" },
  "b-cpu": { kind: "cpu" },
  "c-memory": { kind: "memory" },
  "d-network": { kind: "network" },
} as const;

const LONG_PRESS_MS = 450;
const EDGE_HOLD_MS = 600;
const EDGE_MARGIN_PX = 24;
const REMOVE_ZONE_H = 72;

type ResizeEdge = "n" | "s" | "e" | "w";

interface DragState {
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

interface ResizeState {
  item: LayoutItem;
  edge: ResizeEdge;
  startX: number;
  startY: number;
  preview: LayoutItem[];
  current: { x: number; y: number; w: number; h: number };
}

interface ContextMenuState {
  item: LayoutItem;
  x: number;
  y: number;
}

interface DetailState {
  widgetId: string;
  kind: string;
  origin: PxRect | null;
}

interface UndoToast {
  message: string;
  previous: LayoutsDoc;
}

function useImage(url: string | null): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!url || !inTauri) return;
    let alive = true;
    let objectUrl: string | null = null;
    invoke<ArrayBuffer>("layer_asset", { url })
      .then(async (bytes) => {
        const blob = new Blob([bytes], { type: "image/png" });
        objectUrl = URL.createObjectURL(blob);
        const i = new Image();
        i.src = objectUrl;
        await i.decode();
        if (alive) setImg(i);
      })
      .catch((e: unknown) => {
        console.error("wallpaper load failed", url, e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);
  return url ? img : null;
}

async function setPeekActive(active: boolean): Promise<void> {
  if (!inTauri) {
    useLayer.setState({ peek: active });
    return;
  }
  await invoke("layer_set_peek", { active });
}

async function setEditActive(active: boolean): Promise<void> {
  if (!inTauri) {
    useLayer.setState({ edit: active });
    return;
  }
  await invoke("layer_set_edit", { active });
}

function allowedSizesOf(
  item: LayoutItem,
  widgets: StoredSettings["widgets"],
): readonly SizeClass[] {
  if (item.type === "widget") return widgetByKind(item.kind)?.sizes ?? ["S"];
  let common: SizeClass[] | null = null;
  for (const cid of item.children) {
    const kind = widgets[cid]?.kind;
    const sz = kind ? [...(widgetByKind(kind)?.sizes ?? [])] : [];
    if (sz.length === 0) continue;
    common = common ? common.filter((s) => sz.includes(s)) : sz;
  }
  return common && common.length > 0 ? common : [sizeClassForSpan(item.w, item.h)];
}

/** Picks the allowed span closest to the user's resize drag target. */
function snapResizeSpan(
  allowed: readonly SizeClass[],
  targetW: number,
  targetH: number,
  maxCols: number,
  maxRows: number,
): { w: number; h: number } {
  const candidates = allowed.map((s) => sizes[s]).filter((s) => s.w <= maxCols && s.h <= maxRows);
  let best = candidates[0] ?? { w: 2, h: 2 };
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = Math.abs(c.w - targetW) + Math.abs(c.h - targetH);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

function isInteractiveTarget(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false;
  return Boolean(
    el.closest("button, input, select, textarea, a, [role='slider'], [role='switch']"),
  );
}

interface GridItemsProps {
  items: readonly LayoutItem[];
  g: GridMetrics;
  edit: boolean;
  selectedId: string | null;
  drag: DragState | null;
  resize: ResizeState | null;
  autoDimmed: boolean;
  widgets: StoredSettings["widgets"];
  onHover: (hovered: boolean) => void;
  onPointerDownItem: (item: LayoutItem, e: React.PointerEvent<HTMLDivElement>) => void;
  onClickItem: (item: LayoutItem, e: React.MouseEvent<HTMLDivElement>) => void;
  onContextItem: (item: LayoutItem, e: React.MouseEvent<HTMLDivElement>) => void;
  onStartResize: (
    item: LayoutItem,
    edge: ResizeEdge,
    e: React.PointerEvent<HTMLButtonElement>,
  ) => void;
  onRemoveItem: (item: LayoutItem) => void;
  onOpenSettings: (widgetId: string) => void;
  onEditStack: (stackId: string) => void;
  onStackActive: (stackId: string, idx: number) => void;
  contentDir: "ltr" | "rtl";
}

function GridItems({
  items,
  g,
  edit,
  selectedId,
  drag,
  resize,
  autoDimmed,
  widgets,
  onHover,
  onPointerDownItem,
  onClickItem,
  onContextItem,
  onStartResize,
  onRemoveItem,
  onOpenSettings,
  onEditStack,
  onStackActive,
  contentDir,
}: GridItemsProps) {
  const syncGlass = useGlassSync();

  return (
    <>
      {items.map((item) => {
        const isDragging = drag?.item.id === item.id;
        const isResizing = resize?.item.id === item.id;
        const rect = isDragging
          ? {
              x: drag.pointerX - drag.grabX,
              y: drag.pointerY - drag.grabY,
              width: spanPx(item.w),
              height: spanPx(item.h),
            }
          : cellToPx(g, item.x, item.y, item.w, item.h);
        const size = sizeClassForSpan(item.w, item.h);
        const isSelected = edit && selectedId === item.id;
        const isStackTarget = drag?.stackTarget?.id === item.id;
        const canResize = allowedSizesOf(item, widgets).length > 1;

        const body =
          item.type === "stack" ? (
            <StackWidget
              item={item}
              size={size}
              autoDimmed={autoDimmed}
              lifted={isDragging}
              editMode={edit}
              onActiveChange={(idx) => {
                onStackActive(item.id, idx);
              }}
              onOpenSettings={onOpenSettings}
            />
          ) : (
            (() => {
              const def = widgetByKind(item.kind);
              return def ? (
                <WidgetFrame
                  id={item.id}
                  def={def}
                  size={size}
                  autoDimmed={autoDimmed}
                  lifted={isDragging}
                  onOpenSettings={() => {
                    onOpenSettings(item.id);
                  }}
                />
              ) : null;
            })()
          );

        if (!body) return null;

        return (
          <SpringSlot
            key={item.id}
            x={rect.x}
            y={rect.y}
            dragging={isDragging || isResizing}
            onTick={syncGlass}
            dataItemId={item.id}
            dir={contentDir}
            tabIndex={edit ? 0 : undefined}
            ariaLabel={
              item.type === "stack" ? `Stack of ${String(item.children.length)} widgets` : item.kind
            }
            className={`${styles.widget} ${edit ? styles.widgetEdit : ""} ${isDragging ? styles.widgetDragging : ""} ${isSelected ? styles.widgetSelected : ""} ${isStackTarget ? styles.stackHighlight : ""}`}
            onPointerEnter={() => {
              onHover(true);
            }}
            onPointerLeave={() => {
              onHover(false);
            }}
            onPointerDown={(e) => {
              onPointerDownItem(item, e);
            }}
            onClick={(e) => {
              onClickItem(item, e);
            }}
            onContextMenu={(e) => {
              onContextItem(item, e);
            }}
          >
            {body}
            {edit && !isDragging ? (
              <>
                <button
                  type="button"
                  className={styles.removeBadge}
                  aria-label="Remove widget"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveItem(item);
                  }}
                >
                  <Icon name="remove" size={16} />
                </button>
                <button
                  type="button"
                  className={styles.settingsBadge}
                  aria-label="Customize widget"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (item.type === "stack") onEditStack(item.id);
                    else onOpenSettings(item.id);
                  }}
                >
                  <Icon name="tune" size={15} />
                </button>
              </>
            ) : null}
            {edit && item.type === "stack" && !isDragging ? (
              <button
                type="button"
                className={styles.stackBadge}
                aria-label="Edit stack"
                onPointerDown={(e) => {
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onEditStack(item.id);
                }}
              >
                <Icon name="stacks" size={14} />
                {item.children.length}
              </button>
            ) : null}
            {isSelected && canResize && !isDragging ? (
              <>
                <button
                  type="button"
                  className={`${styles.handle} ${styles.handleN}`}
                  aria-label="Resize top"
                  onPointerDown={(e) => {
                    onStartResize(item, "n", e);
                  }}
                />
                <button
                  type="button"
                  className={`${styles.handle} ${styles.handleS}`}
                  aria-label="Resize bottom"
                  onPointerDown={(e) => {
                    onStartResize(item, "s", e);
                  }}
                />
                <button
                  type="button"
                  className={`${styles.handle} ${styles.handleW}`}
                  aria-label="Resize left"
                  onPointerDown={(e) => {
                    onStartResize(item, "w", e);
                  }}
                />
                <button
                  type="button"
                  className={`${styles.handle} ${styles.handleE}`}
                  aria-label="Resize right"
                  onPointerDown={(e) => {
                    onStartResize(item, "e", e);
                  }}
                />
              </>
            ) : null}
          </SpringSlot>
        );
      })}
    </>
  );
}

export function LayerApp() {
  const connection = useLayer((s) => s.connection);
  const monitor = useLayer((s) => s.monitor);
  const monitors = useLayer((s) => s.monitors);
  const geometry = useLayer((s) => s.geometry);
  const desktopFocused = useLayer((s) => s.desktopFocused);
  const covered = useLayer((s) => s.covered);
  const peek = useLayer((s) => s.peek);
  const edit = useLayer((s) => s.edit);
  const wallpapers = useLayer((s) => s.values[WALLPAPER_TOPIC]);
  const layoutsValue = useLayer((s) => s.values[LAYOUTS_TOPIC]);
  const host = useCoreHost(monitor?.key ?? null);

  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [openSettings, setOpenSettings] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [stackEditId, setStackEditId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [resize, setResize] = useState<ResizeState | null>(null);
  const [undoStack, setUndoStack] = useState<LayoutsDoc[]>([]);
  const [redoStack, setRedoStack] = useState<LayoutsDoc[]>([]);
  const [undoToast, setUndoToast] = useState<UndoToast | null>(null);

  const root = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const edgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef(false);
  const migrated = useRef(false);

  useEffect(() => {
    if (!inTauri) {
      useLayer.setState({ connection: { state: "standalone" } });
      return;
    }
    attachLayer().catch((e: unknown) => {
      console.error("layer_attach failed", e);
    });
  }, []);

  // Global style → page palette (sheets, toolbar, context menu and backdrop use it).
  const globalStyle = useMemo(
    () => resolveStyle(sanitizeStyle(host.settings.style)).style,
    [host.settings.style],
  );
  const roles = rolesFor(globalStyle, host.colors);
  useEffect(() => {
    applyPalette(cssVariables(roles));
  }, [roles]);

  const connected = connection.state === "connected";
  const backend = connected ? connection.backend : "instant";
  const isHome = monitor?.primary ?? true;
  const widgets = host.settings.widgets;
  const settingsLoaded = useLayer((s) => s.values.settings !== undefined);
  const layoutsLoaded = layoutsValue !== undefined;
  const layouts = useMemo(() => storedLayouts(layoutsValue), [layoutsValue]);

  const width = geometry?.width ?? window.innerWidth;
  const height = geometry?.height ?? window.innerHeight;
  const rawSettings = useLayer((s) => s.values.settings);
  const rawAppearance = useLayer((s) => s.values[APPEARANCE_TOPIC]);
  const settingsExtra = useMemo(() => {
    const j = toJson(rawSettings);
    const obj = typeof j === "object" && j !== null && !Array.isArray(j) ? j : {};
    const app =
      typeof obj.appearance === "object" &&
      obj.appearance !== null &&
      !Array.isArray(obj.appearance)
        ? obj.appearance
        : {};
    const lay =
      typeof obj.layout === "object" && obj.layout !== null && !Array.isArray(obj.layout)
        ? obj.layout
        : {};
    const state =
      app.state === "full" || app.state === "dimmed" || app.state === "automatic"
        ? app.state
        : "automatic";
    const glass = typeof app.glass === "number" ? Math.max(0, Math.min(100, app.glass)) : 45;
    const marginPx =
      typeof lay.marginPx === "number" ? Math.max(12, Math.min(64, lay.marginPx)) : 24;
    const language = typeof obj.language === "string" ? obj.language : "system";
    return { state, glass, marginPx, language };
  }, [rawSettings]);
  const a11y = useMemo(() => {
    const j = toJson(rawAppearance);
    const obj = typeof j === "object" && j !== null && !Array.isArray(j) ? j : {};
    const highContrast = obj.highContrast === true;
    const reduced = obj.animations === false || obj.reducedMotion === true;
    const scale =
      typeof obj.textScale === "number" && Number.isFinite(obj.textScale)
        ? Math.min(2, Math.max(0.75, obj.textScale))
        : 1;
    return { highContrast, reduced, scale };
  }, [rawAppearance]);
  const locale = resolveLocale(settingsExtra.language);
  const rtl = isRtl(locale);
  const contentDir: "rtl" | "ltr" = rtl ? "rtl" : "ltr";

  useEffect(() => {
    // Set document lang only; keep .surface LTR so user widget coordinates never mirror (brief §2.10).
    applyDocumentLocale(locale, false);
  }, [locale]);

  useEffect(() => {
    setReducedMotion(a11y.reduced);
    const el = document.documentElement;
    el.dataset.highContrast = a11y.highContrast ? "true" : "false";
    el.dataset.reducedMotion = a11y.reduced ? "true" : "false";
    el.style.setProperty("--text-scale", String(a11y.scale));
  }, [a11y]);

  const g = useMemo(
    () => computeGrid(width, height, settingsExtra.marginPx),
    [width, height, settingsExtra.marginPx],
  );

  // Startup diagnostics: page size vs. the window geometry core placed (layer log).
  useEffect(() => {
    if (!inTauri || !geometry) return;
    report("layer-size", {
      inner: [window.innerWidth, window.innerHeight],
      dpr: window.devicePixelRatio,
      geometry,
    }).catch(() => undefined);
  }, [geometry]);

  // First run / upgrade from Phase 4: seed settings.widgets and migrate into layouts.json once.
  useEffect(() => {
    if (!connected || !isHome || !settingsLoaded || !layoutsLoaded || !monitor) return;
    if (Object.keys(widgets).length === 0) {
      void host.updateSettings({ widgets: DEFAULT_WIDGETS });
      return;
    }
    if (Object.keys(layouts.monitors).length === 0 && !migrated.current) {
      migrated.current = true;
      const items = migrateWidgetsToGrid(widgets, g.cols, g.rows);
      void updateLayouts({
        version: 1,
        showMissingOnPrimary: layouts.showMissingOnPrimary,
        monitors: { [monitor.key]: { items } },
      });
    }
  }, [
    connected,
    isHome,
    settingsLoaded,
    layoutsLoaded,
    monitor,
    widgets,
    layouts,
    g.cols,
    g.rows,
    host,
  ]);

  // Resolve this monitor's layout key (exact → serial → connector+vendor/product).
  const layoutKey = useMemo(() => {
    if (!monitor) return "primary";
    return matchMonitorKey(monitor, Object.keys(layouts.monitors)) ?? monitor.key;
  }, [monitor, layouts.monitors]);

  const monitorItems = useMemo(() => {
    const base = layouts.monitors[layoutKey]?.items ?? [];
    const extras: LayoutItem[] = [];
    if (isHome && layouts.showMissingOnPrimary && monitors.length > 0) {
      for (const wk of waitingMonitorKeys(monitors, Object.keys(layouts.monitors))) {
        extras.push(...(layouts.monitors[wk]?.items ?? []));
      }
    }
    const combined = extras.length > 0 ? [...base, ...extras] : base;
    return refitLayout(combined, g.cols, g.rows, (it) => allowedSizesOf(it, widgets));
  }, [layouts, layoutKey, isHome, monitors, g.cols, g.rows, widgets]);

  const displayedItems = drag?.preview ?? resize?.preview ?? monitorItems;

  // Commit a new LayoutsDoc with undo tracking inside the current Edit session.
  const commitLayouts = useCallback(
    (next: LayoutsDoc, recordUndo = true) => {
      if (recordUndo) {
        setUndoStack((prev) => [...prev.slice(-29), layouts]);
        setRedoStack([]);
      }
      void updateLayouts(next);
    },
    [layouts],
  );

  const commitMonitorItems = useCallback(
    (nextItems: LayoutItem[], recordUndo = true) => {
      const next: LayoutsDoc = {
        ...layouts,
        monitors: { ...layouts.monitors, [layoutKey]: { items: nextItems } },
      };
      commitLayouts(next, recordUndo);
    },
    [layouts, layoutKey, commitLayouts],
  );

  const handleUndo = useCallback(() => {
    const prev = undoStack[undoStack.length - 1];
    if (!prev) return;
    setUndoStack((s) => s.slice(0, -1));
    setRedoStack((s) => [...s, layouts]);
    void updateLayouts(prev);
  }, [undoStack, layouts]);

  const handleRedo = useCallback(() => {
    const next = redoStack[redoStack.length - 1];
    if (!next) return;
    setRedoStack((s) => s.slice(0, -1));
    setUndoStack((s) => [...s, layouts]);
    void updateLayouts(next);
  }, [redoStack, layouts]);

  const handleRemoveItem = useCallback(
    (item: LayoutItem) => {
      const previous = layouts;
      const nextItems = monitorItems.filter((i) => i.id !== item.id);
      commitMonitorItems(nextItems);
      if (selectedId === item.id) setSelectedId(null);
      const label =
        item.type === "stack"
          ? "Stack removed"
          : `${widgetByKind(item.kind)?.name ?? "Widget"} removed`;
      setUndoToast({ message: label, previous });
    },
    [layouts, monitorItems, commitMonitorItems, selectedId],
  );

  const handleMoveToDisplay = useCallback(
    (item: LayoutItem, targetMonitor: Monitor) => {
      const targetKey =
        matchMonitorKey(targetMonitor, Object.keys(layouts.monitors)) ?? targetMonitor.key;
      if (targetKey === layoutKey) return;
      const targetArea = targetMonitor.work_area;
      const tg = computeGrid(
        targetArea ? targetArea[2] : targetMonitor.width,
        targetArea ? targetArea[3] : targetMonitor.height,
      );
      const targetExisting = layouts.monitors[targetKey]?.items ?? [];
      const slot = findNearestFree(targetExisting, tg.cols, tg.rows, item.w, item.h, 0, 0);
      if (!slot) return;
      const movedItem: LayoutItem = { ...item, x: slot.x, y: slot.y };
      const next: LayoutsDoc = {
        ...layouts,
        monitors: {
          ...layouts.monitors,
          [layoutKey]: { items: monitorItems.filter((i) => i.id !== item.id) },
          [targetKey]: { items: [...targetExisting, movedItem] },
        },
      };
      commitLayouts(next);
      if (selectedId === item.id) setSelectedId(null);
    },
    [layouts, layoutKey, monitorItems, commitLayouts, selectedId],
  );

  const handleAddWidget = useCallback(
    (kind: string, size: SizeClass) => {
      const span = sizes[size];
      const slot = findNearestFree(
        monitorItems,
        g.cols,
        g.rows,
        span.w,
        span.h,
        Math.max(0, g.cols - span.w),
        0,
      );
      if (!slot) return;
      const id = newWidgetId(kind);
      void host.updateSettings({ widgets: { [id]: { kind } } });
      const added: LayoutItem = {
        id,
        type: "widget",
        kind,
        x: slot.x,
        y: slot.y,
        w: span.w,
        h: span.h,
      };
      commitMonitorItems([...monitorItems, added]);
      setSelectedId(id);
      setPickerOpen(false);
    },
    [monitorItems, g.cols, g.rows, host, commitMonitorItems],
  );

  const handleApplyPreset = useCallback(
    (preset: PresetSpec) => {
      const built = buildPreset(preset, g.cols, g.rows);
      void host.updateSettings({ widgets: built.widgets });
      commitMonitorItems(built.items);
      setPresetsOpen(false);
      setSelectedId(null);
    },
    [g.cols, g.rows, host, commitMonitorItems],
  );

  const latestAlertCtx = useRef({ monitorItems, widgets, g });
  useLayoutEffect(() => {
    latestAlertCtx.current = { monitorItems, widgets, g };
  }, [monitorItems, widgets, g]);

  // Clear edit session UI when leaving Edit mode, and open detail view when an alert is opened.
  useEffect(
    () =>
      useLayer.subscribe((next, prev) => {
        if (prev.peek && !next.peek) {
          setContextMenu(null);
          setHovered(false);
        }
        if (prev.edit && !next.edit) {
          setSelectedId(null);
          setPickerOpen(false);
          setPresetsOpen(false);
          setStackEditId(null);
          setContextMenu(null);
          setUndoToast(null);
          setHovered(false);
          setDrag(null);
          setResize(null);
          setUndoStack([]);
          setRedoStack([]);
        }
        if (next.alertRule && next.alertRule !== prev.alertRule) {
          const { monitorItems: items, widgets: ws, g: grid } = latestAlertCtx.current;
          const prefix = next.alertRule.split("-")[0] ?? "";
          const match = items.find((it) => {
            if (it.type === "widget") return it.kind === prefix;
            return it.children.some((cid) => ws[cid]?.kind === prefix);
          });
          if (match) {
            const widgetId =
              match.type === "widget"
                ? match.id
                : (match.children.find((cid) => ws[cid]?.kind === prefix) ?? match.children[0]);
            const kind = widgetId
              ? match.type === "widget"
                ? match.kind
                : ws[widgetId]?.kind
              : undefined;
            if (widgetId && kind) {
              setDetail({
                widgetId,
                kind,
                origin: cellToPx(grid, match.x, match.y, match.w, match.h),
              });
            }
          }
          useLayer.setState({ alertRule: null });
        }
      }),
    [],
  );

  // Peek Esc handler.
  useEffect(() => {
    if (!peek) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void setPeekActive(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [peek]);

  // Full keyboard model in Edit mode (brief §2.2, PLAN 5.6).
  useEffect(() => {
    if (!edit || openSettings || pickerOpen || stackEditId || contextMenu) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        handleRedo();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (presetsOpen) setPresetsOpen(false);
        else void setEditActive(false);
        return;
      }
      if (e.key === "Tab" && monitorItems.length > 0) {
        e.preventDefault();
        const idx = monitorItems.findIndex((i) => i.id === selectedId);
        const delta = e.shiftKey ? -1 : 1;
        const next = monitorItems[(idx + delta + monitorItems.length) % monitorItems.length];
        if (next) setSelectedId(next.id);
        return;
      }
      const sel = monitorItems.find((i) => i.id === selectedId);
      if (!sel) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        handleRemoveItem(sel);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (sel.type === "stack") setStackEditId(sel.id);
        else setOpenSettings(sel.id);
        return;
      }
      const dx = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      const dy = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
      if (dx === 0 && dy === 0) return;
      e.preventDefault();
      if (e.shiftKey) {
        const allowed = allowedSizesOf(sel, widgets);
        const span = snapResizeSpan(allowed, sel.w + dx * 2, sel.h + dy * 2, g.cols, g.rows);
        if (span.w !== sel.w || span.h !== sel.h) {
          const next = resolveCollisions(
            monitorItems,
            sel.id,
            sel.x,
            sel.y,
            span.w,
            span.h,
            g.cols,
            g.rows,
          );
          if (next) commitMonitorItems(next);
        }
      } else {
        const next = resolveCollisions(
          monitorItems,
          sel.id,
          sel.x + dx,
          sel.y + dy,
          sel.w,
          sel.h,
          g.cols,
          g.rows,
        );
        if (next) commitMonitorItems(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [
    edit,
    openSettings,
    pickerOpen,
    stackEditId,
    contextMenu,
    presetsOpen,
    monitorItems,
    selectedId,
    widgets,
    g.cols,
    g.rows,
    handleUndo,
    handleRedo,
    handleRemoveItem,
    commitMonitorItems,
  ]);

  // Native mode: pause rAF while covered and not peeking/editing.
  useEffect(() => {
    scheduler.setPaused(covered && !peek && !edit);
    return () => {
      scheduler.setPaused(false);
    };
  }, [covered, peek, edit]);

  useEffect(() => {
    const on = () => {
      setFocused(true);
    };
    const off = () => {
      setFocused(false);
    };
    window.addEventListener("focus", on);
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("focus", on);
      window.removeEventListener("blur", off);
    };
  }, []);

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
      setSelectedId(item.id);
      setContextMenu(null);
      setPresetsOpen(false);
      const baseItems = fromPicker ? [...monitorItems, item] : monitorItems;
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
              handleMoveToDisplay(item, edgeTarget);
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
          handleRemoveItem(item);
          return;
        }
        if (latest.fromPicker) {
          void host.updateSettings({ widgets: { [item.id]: { kind: latest.fromPicker.kind } } });
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
          commitMonitorItems(merged);
          setSelectedId(nextStack.id);
          return;
        }
        commitMonitorItems(latest.preview);
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
      monitorItems,
      width,
      height,
      g,
      monitor,
      monitors,
      host,
      handleMoveToDisplay,
      handleRemoveItem,
      commitMonitorItems,
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
        setSelectedId(item.id);
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
    [edit, g, beginDrag],
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
        preview: monitorItems,
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
          monitorItems,
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
        commitMonitorItems(latest.preview);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    },
    [widgets, monitorItems, g.step, g.cols, g.rows, commitMonitorItems],
  );

  // Drag fresh widget from Widget Picker onto the grid.
  const handlePickerDragStart = useCallback(
    (kind: string, size: SizeClass, clientX: number, clientY: number) => {
      setPickerOpen(false);
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
    [g, beginDrag],
  );

  // Click widget: in Edit mode opens settings/stack editor; outside Edit mode opens shared-element DetailModal.
  const handleClickItem = useCallback(
    (item: LayoutItem, e: React.MouseEvent<HTMLDivElement>) => {
      if (suppressClick.current || isInteractiveTarget(e.target)) return;
      if (edit) {
        if (selectedId === item.id) {
          if (item.type === "stack") setStackEditId(item.id);
          else setOpenSettings(item.id);
        } else {
          setSelectedId(item.id);
        }
        return;
      }
      const rect = cellToPx(g, item.x, item.y, item.w, item.h);
      if (item.type === "widget") {
        setDetail({ widgetId: item.id, kind: item.kind, origin: rect });
      } else {
        const activeId = item.children[item.activeIndex ?? 0] ?? item.children[0];
        const kind = activeId ? widgets[activeId]?.kind : undefined;
        if (activeId && kind) setDetail({ widgetId: activeId, kind, origin: rect });
      }
    },
    [edit, selectedId, g, widgets],
  );

  const handleContextItem = useCallback(
    (item: LayoutItem, e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const x = Math.min(e.clientX, Math.max(8, width - 220));
      const y = Math.min(e.clientY, Math.max(8, height - 240));
      setContextMenu({ item, x, y });
    },
    [width, height],
  );

  // Input region: full window only while Edit mode, Peek, or an overlay is open;
  // otherwise empty so every click on the desktop (including over widgets) passes straight through.
  useLayoutEffect(() => {
    if (!inTauri) return;
    const full =
      peek ||
      edit ||
      openSettings !== null ||
      detail !== null ||
      pickerOpen ||
      stackEditId !== null ||
      contextMenu !== null ||
      undoToast !== null;
    const rects = full ? [{ x: 0, y: 0, width, height }] : [];
    setInputRegion(rects).catch((e: unknown) => {
      console.error("input region failed", e);
    });
  }, [
    peek,
    edit,
    openSettings,
    detail,
    pickerOpen,
    stackEditId,
    contextMenu,
    undoToast,
    width,
    height,
  ]);

  // Appearance state (brief §2.6): Automatic (default), Full color, or Dimmed.
  const desktopActive = backend === "native" ? (desktopFocused ?? true) : focused;
  const interactiveOverride = peek || edit || hovered || openSettings !== null || detail !== null;
  const autoDimmed =
    settingsExtra.state === "full"
      ? false
      : settingsExtra.state === "dimmed"
        ? !interactiveOverride
        : !(interactiveOverride || desktopActive);

  const entry = useMemo(() => {
    const all = toJson(wallpapers);
    if (typeof all !== "object" || all === null || Array.isArray(all) || !monitor) return null;
    const e = all[monitor.key];
    return typeof e === "object" && e !== null && !Array.isArray(e) ? e : null;
  }, [wallpapers, monitor]);
  const wallpaper = useImage(typeof entry?.glass === "string" ? entry.glass : null);
  const luminance = useMemo(
    () =>
      Array.isArray(entry?.luminance)
        ? entry.luminance.filter((v): v is number => typeof v === "number")
        : undefined,
    [entry],
  );
  const surfaceContainer = roles.surfaceContainer;
  const tint = useMemo<[number, number, number]>(
    () => [(surfaceContainer >> 16) & 255, (surfaceContainer >> 8) & 255, surfaceContainer & 255],
    [surfaceContainer],
  );
  const text = roles.onSurface;
  const offsetX = geometry && monitor ? geometry.x - monitor.x : 0;
  const offsetY = geometry && monitor ? geometry.y - monitor.y : 0;
  const monitorWidth = monitor?.width ?? width;
  const monitorHeight = monitor?.height ?? height;
  const placement = useMemo(
    () => ({ offsetX, offsetY, monitorWidth, monitorHeight }),
    [offsetX, offsetY, monitorWidth, monitorHeight],
  );

  const openDef = openSettings ? widgetByKind(widgets[openSettings]?.kind ?? "") : undefined;
  const detailDef = detail ? widgetByKind(detail.kind) : undefined;
  const editingStack = useMemo(
    () =>
      stackEditId
        ? (monitorItems.find(
            (i): i is StackLayoutItem => i.type === "stack" && i.id === stackEditId,
          ) ?? null)
        : null,
    [stackEditId, monitorItems],
  );

  // Context menu items for right-clicked widget/stack.
  const contextItems = useMemo<MenuItem[]>(() => {
    if (!contextMenu) return [];
    const list: MenuItem[] = [
      {
        id: "edit",
        label: edit ? t(locale, "action.doneEditing") : t(locale, "action.editWidgets"),
        icon: "edit",
      },
      { id: "settings", label: t(locale, "action.widgetSettings"), icon: "tune" },
    ];
    if (contextMenu.item.type === "stack") {
      list.push({ id: "stack", label: t(locale, "action.editStack"), icon: "stacks" });
    }
    for (const m of monitors) {
      if (monitor && m.key !== monitor.key) {
        list.push({
          id: `move:${m.key}`,
          label: t(locale, "action.moveTo", { display: m.connector }),
          icon: "open_in_full",
        });
      }
    }
    list.push({ id: "remove", label: t(locale, "action.remove"), icon: "delete", danger: true });
    return list;
  }, [contextMenu, edit, monitors, monitor, locale]);

  const handleContextSelect = (id: string) => {
    if (!contextMenu) return;
    const item = contextMenu.item;
    setContextMenu(null);
    if (id === "edit") {
      void setEditActive(!edit);
    } else if (id === "settings") {
      const targetId =
        item.type === "widget"
          ? item.id
          : (item.children[item.activeIndex ?? 0] ?? item.children[0]);
      if (targetId) setOpenSettings(targetId);
    } else if (id === "stack" && item.type === "stack") {
      setStackEditId(item.id);
    } else if (id === "remove") {
      handleRemoveItem(item);
    } else if (id.startsWith("move:")) {
      const key = id.slice(5);
      const target = monitors.find((m) => m.key === key);
      if (target) handleMoveToDisplay(item, target);
    }
  };

  const ghostRect = drag
    ? drag.stackTarget
      ? cellToPx(g, drag.stackTarget.x, drag.stackTarget.y, drag.stackTarget.w, drag.stackTarget.h)
      : !drag.overRemove
        ? cellToPx(g, drag.landing.x, drag.landing.y, drag.landing.w, drag.landing.h)
        : null
    : resize
      ? cellToPx(g, resize.current.x, resize.current.y, resize.current.w, resize.current.h)
      : null;

  return (
    <HostContext.Provider value={host}>
      <div
        ref={root}
        className={styles.layer}
        onContextMenu={(e) => {
          e.preventDefault();
        }}
      >
        <GlassStage
          wallpaper={wallpaper}
          wallpaperUrl={typeof entry?.glass === "string" ? entry.glass : null}
          placement={placement}
          tint={tint}
          textLuminance={lum((text >> 16) & 255, (text >> 8) & 255, text & 255)}
          {...(luminance ? { luminance } : {})}
          slider={settingsExtra.glass}
          opaque={a11y.highContrast}
          backdrop={peek || edit ? 0.92 : 0}
          tightCanvas
        >
          <div className={styles.surface}>
            {peek || edit ? (
              <div
                className={styles.backdrop}
                role="button"
                tabIndex={-1}
                aria-label={edit ? "Done editing" : "Close Peek"}
                onClick={() => {
                  if (contextMenu) {
                    setContextMenu(null);
                    return;
                  }
                  if (presetsOpen) {
                    setPresetsOpen(false);
                    return;
                  }
                  if (edit) void setEditActive(false);
                  else void setPeekActive(false);
                }}
              />
            ) : null}

            {edit ? (
              <div
                className={styles.dotGrid}
                aria-hidden="true"
                style={{
                  left: g.originX,
                  top: g.originY,
                  width: g.width,
                  height: g.height,
                }}
              />
            ) : null}

            {ghostRect ? (
              <div
                className={`${styles.ghost} ${drag?.stackTarget ? styles.ghostStack : ""}`}
                style={{
                  left: ghostRect.x,
                  top: ghostRect.y,
                  width: ghostRect.width,
                  height: ghostRect.height,
                }}
              >
                {drag?.stackTarget ? "Drop to stack" : null}
              </div>
            ) : null}

            <GridItems
              items={displayedItems}
              g={g}
              edit={edit}
              selectedId={selectedId}
              drag={drag}
              resize={resize}
              autoDimmed={autoDimmed}
              widgets={widgets}
              contentDir={contentDir}
              onHover={setHovered}
              onPointerDownItem={handlePointerDownItem}
              onClickItem={handleClickItem}
              onContextItem={handleContextItem}
              onStartResize={handleStartResize}
              onRemoveItem={handleRemoveItem}
              onOpenSettings={setOpenSettings}
              onEditStack={setStackEditId}
              onStackActive={(stackId, idx) => {
                const next = monitorItems.map((it) =>
                  it.type === "stack" && it.id === stackId ? { ...it, activeIndex: idx } : it,
                );
                commitMonitorItems(next, false);
              }}
            />

            {edit && !drag ? (
              <div className={styles.toolbarWrap} dir={contentDir}>
                <Toolbar label={t(locale, "action.editWidgets")}>
                  <Button
                    variant="tonal"
                    icon="add"
                    onClick={() => {
                      setPresetsOpen(false);
                      setPickerOpen(true);
                    }}
                  >
                    {t(locale, "action.addWidget")}
                  </Button>
                  <Button
                    variant="text"
                    icon="grid_view"
                    onClick={() => {
                      setPresetsOpen((p) => !p);
                    }}
                  >
                    {t(locale, "action.presets")}
                  </Button>
                  <Button
                    variant="text"
                    icon="settings"
                    onClick={() => {
                      setPresetsOpen(false);
                      void setEditActive(false);
                      void host.command({ cmd: "open-settings" });
                    }}
                  >
                    {t(locale, "action.settings")}
                  </Button>
                  <Button
                    variant="text"
                    icon="undo"
                    label={t(locale, "action.undo")}
                    disabled={undoStack.length === 0}
                    onClick={handleUndo}
                  />
                  <Button
                    variant="text"
                    icon="redo"
                    label={t(locale, "action.redo")}
                    disabled={redoStack.length === 0}
                    onClick={handleRedo}
                  />
                  <Button
                    variant="filled"
                    icon="check"
                    onClick={() => {
                      void setEditActive(false);
                    }}
                  >
                    {t(locale, "action.done")}
                  </Button>
                </Toolbar>
              </div>
            ) : null}

            {drag && !drag.fromPicker ? (
              <div
                dir={contentDir}
                className={`${styles.removeZone} ${drag.overRemove ? styles.removeZoneHot : ""}`}
              >
                <Icon name="delete" size={18} />
                <span>
                  {drag.overRemove
                    ? t(locale, "edit.releaseToRemove")
                    : t(locale, "edit.dropToRemove")}
                </span>
              </div>
            ) : null}

            {drag?.edge && drag.edgeTarget ? (
              <div
                className={`${styles.edgeGlow} ${
                  drag.edge === "left"
                    ? styles.edgeLeft
                    : drag.edge === "right"
                      ? styles.edgeRight
                      : drag.edge === "top"
                        ? styles.edgeTop
                        : styles.edgeBottom
                }`}
              >
                {drag.edgeTarget.connector}
              </div>
            ) : null}

            {presetsOpen && edit ? (
              <div
                className={styles.menuAnchor}
                style={{ bottom: 76, left: Math.max(16, width / 2 - 110) }}
              >
                <ContextMenu
                  label="Layout presets"
                  items={PRESETS.map((p) => ({ id: p.id, label: p.name, icon: "grid_view" }))}
                  onSelect={(id) => {
                    const p = PRESETS.find((x) => x.id === id);
                    if (p) handleApplyPreset(p);
                  }}
                  onClose={() => {
                    setPresetsOpen(false);
                  }}
                />
              </div>
            ) : null}

            {contextMenu ? (
              <div
                className={styles.menuAnchor}
                style={{ left: contextMenu.x, top: contextMenu.y }}
              >
                <ContextMenu
                  label="Widget actions"
                  items={contextItems}
                  onSelect={handleContextSelect}
                  onClose={() => {
                    setContextMenu(null);
                  }}
                />
              </div>
            ) : null}

            {undoToast ? (
              <div className={`${styles.snackbarWrap} ${edit ? styles.snackbarWrapEdit : ""}`}>
                <Snackbar
                  message={undoToast.message}
                  action={{
                    label: "Undo",
                    onClick: () => {
                      void updateLayouts(undoToast.previous);
                      setUndoToast(null);
                    },
                  }}
                  onDismiss={() => {
                    setUndoToast(null);
                  }}
                />
              </div>
            ) : null}

            {/* Inside the stage's content layer: as a layer of its own, WebKitGTK stretched the
                pill's background over the whole window. */}
            {peek ? (
              <div className={styles.hint} dir={contentDir}>
                {t(locale, "peek.hint")}
              </div>
            ) : null}
          </div>
        </GlassStage>
      </div>

      {detail && detailDef ? (
        <DetailModal
          id={detail.widgetId}
          def={detailDef}
          origin={detail.origin}
          viewportW={width}
          viewportH={height}
          onClose={() => {
            setDetail(null);
          }}
          onOpenSettings={() => {
            const wid = detail.widgetId;
            setDetail(null);
            setOpenSettings(wid);
          }}
        />
      ) : null}

      <WidgetPicker
        open={pickerOpen}
        onClose={() => {
          setPickerOpen(false);
        }}
        onAdd={handleAddWidget}
        onDragStart={handlePickerDragStart}
      />

      {editingStack ? (
        <StackEditor
          stack={editingStack}
          open
          onClose={() => {
            setStackEditId(null);
          }}
          onReorder={(children) => {
            commitMonitorItems(
              monitorItems.map((it) =>
                it.type === "stack" && it.id === editingStack.id ? { ...it, children } : it,
              ),
            );
          }}
          onRemoveChild={(childId) => {
            const remaining = editingStack.children.filter((c) => c !== childId);
            if (remaining.length === 0) {
              handleRemoveItem(editingStack);
              setStackEditId(null);
            } else if (remaining.length === 1 && remaining[0]) {
              const lone = remaining[0];
              const kind = widgets[lone]?.kind ?? "cpu";
              commitMonitorItems(
                monitorItems.map((it) =>
                  it.type === "stack" && it.id === editingStack.id
                    ? { id: lone, type: "widget", kind, x: it.x, y: it.y, w: it.w, h: it.h }
                    : it,
                ),
              );
              setStackEditId(null);
            } else {
              commitMonitorItems(
                monitorItems.map((it) =>
                  it.type === "stack" && it.id === editingStack.id
                    ? { ...it, children: remaining, activeIndex: 0 }
                    : it,
                ),
              );
            }
          }}
          onUnstackChild={(childId) => {
            const remaining = editingStack.children.filter((c) => c !== childId);
            const kind = widgets[childId]?.kind ?? "cpu";
            const slot = findNearestFree(
              monitorItems,
              g.cols,
              g.rows,
              editingStack.w,
              editingStack.h,
              editingStack.x,
              editingStack.y,
            );
            if (!slot) return;
            const extracted: LayoutItem = {
              id: childId,
              type: "widget",
              kind,
              x: slot.x,
              y: slot.y,
              w: editingStack.w,
              h: editingStack.h,
            };
            const updated = monitorItems
              .map((it): LayoutItem | null => {
                if (it.type !== "stack" || it.id !== editingStack.id) return it;
                if (remaining.length === 0) return null;
                if (remaining.length === 1 && remaining[0]) {
                  const lone = remaining[0];
                  return {
                    id: lone,
                    type: "widget",
                    kind: widgets[lone]?.kind ?? "cpu",
                    x: it.x,
                    y: it.y,
                    w: it.w,
                    h: it.h,
                  };
                }
                return { ...it, children: remaining, activeIndex: 0 };
              })
              .filter((i): i is LayoutItem => i !== null)
              .concat(extracted);
            commitMonitorItems(updated);
            if (remaining.length <= 1) setStackEditId(null);
          }}
          onToggleSmartRotate={(enabled) => {
            commitMonitorItems(
              monitorItems.map((it) =>
                it.type === "stack" && it.id === editingStack.id
                  ? { ...it, smartRotate: enabled }
                  : it,
              ),
            );
          }}
          onOpenWidgetSettings={(childId) => {
            setStackEditId(null);
            setOpenSettings(childId);
          }}
        />
      ) : null}

      {openSettings && openDef ? (
        <WidgetSettings
          id={openSettings}
          def={openDef}
          open
          onClose={() => {
            setOpenSettings(null);
          }}
        />
      ) : null}
    </HostContext.Provider>
  );
}

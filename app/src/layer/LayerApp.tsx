// The widget layer of one monitor (Phase 5): per-monitor Grid & Free placement, Edit mode
// upgrades (multi-select, rubber-band marquee, align/distribute, duplicate, copy/paste across
// monitors, lock, z-order, Tidy up, theme & look switchers, unified undo/redo for layout, style
// and content), glass context menu, shared-element detail views, Peek, Automatic appearance, and
// tight WebGL2 canvas bounds outside Edit/Peek.
import { invoke } from "@tauri-apps/api/core";
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cssVariables } from "../design-system/color/scheme";
import { ContextMenu, type MenuItem, Snackbar } from "../design-system/components";
import { GlassStage, SPIKE_WANTS_SHARP } from "../design-system/glass";
import { luminance as lum } from "../design-system/glass/legibility";
import { applyPalette, scheduler, setReducedMotion } from "../design-system/motion";
import {
  DEFAULT_LOOK,
  DESKTOP_LOOKS,
  applyDesktopLook,
  inksFor,
  resolveStyle,
  rolesFor,
  sanitizeStyle,
} from "../design-system/style";
import { type SizeClass, grid as gridTokens, sizes, spanPx } from "../design-system/tokens/tokens";
import { applyDocumentLocale, isRtl, resolveLocale, t } from "../i18n";
import {
  CUSTOM_WIDGETS_TOPIC,
  type CustomWidgetPackage,
  forkWidgetToPackage,
  syncCustomWidgetsFromTopic,
  useCustomWidgets,
} from "../widgets/customWidgets";
import { HostContext, type StoredWidget, type WidgetHost } from "../widgets/host";
import { type Json, toJson } from "../widgets/json";
import {
  LAYOUTS_TOPIC,
  PROBLEMS_TOPIC,
  THEMES_TOPIC,
  WALLPAPER_TOPIC,
  attachLayer,
  storedLayouts,
  storedProblems,
  storedThemeList,
  updateLayouts,
  useCoreHost,
  useLiveCss,
} from "../widgets/layerHost";
import { widgetByKind } from "../widgets/registry";
import { type Rect, inTauri, report, setInputRegion } from "./bridge";
import { readEditClipboard, writeEditClipboard } from "./clipboard";
import { DetailModal } from "./DetailModal";
import { DragFeedback } from "./DragFeedback";
import type { ContextMenuState, DetailState, MarqueeState, UndoToast } from "./editTypes";
import { EditToolbar } from "./EditToolbar";
import {
  type AlignKind,
  type DistributeAxis,
  type ZOrderOp,
  alignItems,
  convertFreeToGrid,
  convertGridToFree,
  distributeItems,
  itemRectPx,
  itemsInMarquee,
  pxToFree,
  reorderZ,
  tidyUpItems,
} from "./free";
import {
  type LayoutItem,
  type LayoutMode,
  type LayoutsDoc,
  type StackLayoutItem,
  computeGrid,
  findNearestFree,
  matchMonitorKey,
  refitLayout,
  waitingMonitorKeys,
} from "./grid";
import { GridItems } from "./GridItems";
import { useInputRegion } from "./interactiveRegion";
import { LayerStackEditor } from "./LayerStackEditor";
import { allowedSizesOf, isInteractiveTarget } from "./layoutRules";
import { setEditActive, setPeekActive } from "./modes";
import {
  BUILTIN_LOOK_IDS,
  LOOK_STARTER_LAYOUTS,
  PRESETS,
  type PresetSpec,
  buildPreset,
  migrateWidgetsToGrid,
  newStackId,
  newWidgetId,
} from "./presets";
import type { Monitor } from "./protocol";
import { useLayer } from "./store";
import { useDragController } from "./useDragController";
import { useEditHistory } from "./useEditHistory";
import { useEditKeyboard } from "./useEditKeyboard";
import { useLayerPrefs } from "./useLayerPrefs";
import { WidgetGallery } from "./WidgetGallery";
import styles from "./LayerApp.module.css";

// Loaded only when the user inspects or builds a widget in Edit mode (PLAN-2 5.1, 6.7, §12 budget).
const LazyInspector = lazy(() => import("../inspector/Inspector"));
const LazyWidgetBuilder = lazy(() => import("../builder/WidgetBuilder"));

/** Written to settings on first run, so editing one doesn't make the others disappear. */
const DEFAULT_WIDGETS = {
  "a-clock": { kind: "clock" },
  "b-cpu": { kind: "cpu" },
  "c-memory": { kind: "memory" },
  "d-network": { kind: "network" },
} as const;

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

function widgetEntryToJson(w: StoredWidget): Record<string, Json> {
  const out: Record<string, Json> = { kind: w.kind };
  if (w.style) out.style = w.style as unknown as Json;
  if (w.elements) out.elements = w.elements as unknown as Json;
  if (w.content) out.content = w.content;
  return out;
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
  const themesValue = useLayer((s) => s.values[THEMES_TOPIC]);
  const problemsValue = useLayer((s) => s.values[PROBLEMS_TOPIC]);
  const customWidgetsValue = useLayer((s) => s.values[CUSTOM_WIDGETS_TOPIC]);
  const baseHost = useCoreHost(monitor?.key ?? null);
  useEffect(() => {
    syncCustomWidgetsFromTopic(customWidgetsValue);
  }, [customWidgetsValue]);
  useEffect(() => {
    baseHost.subscribe([CUSTOM_WIDGETS_TOPIC], "ambient");
  }, [baseHost]);
  useLiveCss(baseHost.theme?.id);
  const configProblems = useMemo(() => storedProblems(problemsValue), [problemsValue]);
  const [dismissedProblemsKey, setDismissedProblemsKey] = useState("");
  const problemsKey = configProblems.map((p) => `${p.file}:${p.at}:${p.message}`).join("|");
  const visibleProblem =
    configProblems.length > 0 && problemsKey !== dismissedProblemsKey ? configProblems[0] : null;

  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [openSettings, setOpenSettings] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [primarySelectedId, setPrimarySelectedId] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [builderPkg, setBuilderPkg] = useState<CustomWidgetPackage | null | undefined>(undefined);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [lookOpen, setLookOpen] = useState(false);
  const [stackEditId, setStackEditId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [undoToast, setUndoToast] = useState<UndoToast | null>(null);

  const root = useRef<HTMLDivElement>(null);
  const migrated = useRef(false);
  const suppressBackdropClick = useRef(false);
  const justSelectedOnDown = useRef<string | null>(null);

  useEffect(() => {
    if (!inTauri) {
      useLayer.setState({ connection: { state: "standalone" } });
      return;
    }
    attachLayer().catch((e: unknown) => {
      console.error("layer_attach failed", e);
    });
  }, []);

  const layouts = useMemo(() => storedLayouts(layoutsValue), [layoutsValue]);

  // Unified Edit-session undo/redo covering layout, style, content, theme, and Desktop look.
  const {
    commit: commitLayouts,
    commitSettings,
    commitBoth,
    undo: handleUndo,
    redo: handleRedo,
    canUndo,
    canRedo,
    clear: clearHistory,
  } = useEditHistory(layouts, baseHost.settings);

  // While Edit mode is active, route host.updateSettings through unified Edit history.
  const host: WidgetHost = useMemo(
    () => (edit ? { ...baseHost, updateSettings: (patch) => commitSettings(patch) } : baseHost),
    [baseHost, edit, commitSettings],
  );

  // Global style → page palette (sheets, toolbar, context menu and backdrop use it).
  const lookSettings = host.settings.look ?? DEFAULT_LOOK;
  const globalStyle = useMemo(
    () =>
      applyDesktopLook(
        resolveStyle(
          sanitizeStyle(host.settings.style),
          {},
          {
            theme: host.theme?.style ? sanitizeStyle(host.theme.style) : undefined,
          },
        ).style,
        lookSettings,
      ),
    [host.settings.style, host.theme, lookSettings],
  );
  const roles = rolesFor(globalStyle, host.colors);
  const inks = useMemo(() => inksFor(globalStyle, host.colors), [globalStyle, host.colors]);
  useEffect(() => {
    applyPalette(cssVariables(roles));
  }, [roles]);

  const connected = connection.state === "connected";
  const backend = connected ? connection.backend : "instant";
  const isHome = monitor?.primary ?? true;
  const widgets = host.settings.widgets;
  const settingsLoaded = useLayer((s) => s.values.settings !== undefined);
  const layoutsLoaded = layoutsValue !== undefined;

  const width = geometry?.width ?? window.innerWidth;
  const height = geometry?.height ?? window.innerHeight;
  const { settingsExtra, a11y } = useLayerPrefs();
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

  // Resolve this monitor's layout key (exact → serial → connector+vendor/product).
  const layoutKey = useMemo(() => {
    if (!monitor) return "primary";
    return matchMonitorKey(monitor, Object.keys(layouts.monitors)) ?? monitor.key;
  }, [monitor, layouts.monitors]);

  const monitorLayout = layouts.monitors[layoutKey];
  const mode: LayoutMode = monitorLayout?.mode ?? "grid";
  const cellSize = monitorLayout?.cellSize ?? gridTokens.cell;

  const g = useMemo(
    () => computeGrid(width, height, settingsExtra.marginPx, cellSize),
    [width, height, settingsExtra.marginPx, cellSize],
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
      void baseHost.updateSettings({ widgets: DEFAULT_WIDGETS });
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
    baseHost,
  ]);

  const monitorItems = useMemo(() => {
    const base = monitorLayout?.items ?? [];
    const extras: LayoutItem[] = [];
    if (isHome && layouts.showMissingOnPrimary && monitors.length > 0) {
      for (const wk of waitingMonitorKeys(monitors, Object.keys(layouts.monitors))) {
        extras.push(...(layouts.monitors[wk]?.items ?? []));
      }
    }
    const combined = extras.length > 0 ? [...base, ...extras] : base;
    if (mode === "free") return combined;
    return refitLayout(combined, g.cols, g.rows, (it) => allowedSizesOf(it, widgets));
  }, [monitorLayout, layouts, isHome, monitors, mode, g.cols, g.rows, widgets]);

  const setSingleSelection = useCallback((id: string | null) => {
    setPrimarySelectedId(id);
    setSelectedIds(id ? new Set([id]) : new Set());
  }, []);

  const handleSelectItem = useCallback(
    (id: string, additive = false) => {
      const target = monitorItems.find((i) => i.id === id);
      const groupMembers = target?.groupId
        ? monitorItems.filter((i) => i.groupId === target.groupId).map((i) => i.id)
        : [id];
      if (!additive) {
        if (selectedIds.size !== 1 || primarySelectedId !== id) {
          justSelectedOnDown.current = id;
        }
        setPrimarySelectedId(id);
        setSelectedIds(new Set(groupMembers));
        return;
      }
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          for (const mid of groupMembers) next.delete(mid);
        } else {
          for (const mid of groupMembers) next.add(mid);
        }
        setPrimarySelectedId(next.has(id) ? id : ([...next][0] ?? null));
        return next;
      });
    },
    [monitorItems, selectedIds.size, primarySelectedId],
  );

  const commitMonitorState = useCallback(
    (
      nextItems: LayoutItem[],
      opts?: { mode?: LayoutMode; recordUndo?: boolean; settingsPatch?: Record<string, Json> },
    ) => {
      const nextMode = opts?.mode ?? mode;
      const nextDoc: LayoutsDoc = {
        ...layouts,
        monitors: {
          ...layouts.monitors,
          [layoutKey]: {
            ...(nextMode === "free" ? { mode: "free" as const } : {}),
            ...(monitorLayout?.cellSize !== undefined ? { cellSize: monitorLayout.cellSize } : {}),
            items: nextItems,
          },
        },
      };
      if (opts?.settingsPatch) {
        commitBoth(nextDoc, opts.settingsPatch, opts.recordUndo ?? true);
      } else {
        commitLayouts(nextDoc, opts?.recordUndo ?? true);
      }
    },
    [layouts, layoutKey, mode, monitorLayout, commitLayouts, commitBoth],
  );

  const commitMonitorItems = useCallback(
    (nextItems: LayoutItem[], recordUndo = true) => {
      commitMonitorState(nextItems, { recordUndo });
    },
    [commitMonitorState],
  );

  const handleRemoveItem = useCallback(
    (item: LayoutItem) => {
      if (item.locked) return;
      const previous = layouts;
      const nextItems = monitorItems.filter((i) => i.id !== item.id);
      commitMonitorItems(nextItems);
      if (selectedIds.has(item.id)) {
        const rest = new Set(selectedIds);
        rest.delete(item.id);
        setSelectedIds(rest);
        setPrimarySelectedId([...rest][0] ?? null);
      }
      const label =
        item.type === "stack"
          ? "Stack removed"
          : `${widgetByKind(item.kind)?.name ?? "Widget"} removed`;
      setUndoToast({ message: label, previous });
    },
    [layouts, monitorItems, commitMonitorItems, selectedIds],
  );

  const handleRemoveSelected = useCallback(() => {
    const removable = monitorItems.filter((i) => selectedIds.has(i.id) && !i.locked);
    if (removable.length === 0) return;
    if (removable.length === 1 && removable[0]) {
      handleRemoveItem(removable[0]);
      return;
    }
    const previous = layouts;
    const dropIds = new Set(removable.map((r) => r.id));
    commitMonitorItems(monitorItems.filter((i) => !dropIds.has(i.id)));
    setSingleSelection(null);
    setUndoToast({ message: `${String(removable.length)} widgets removed`, previous });
  }, [
    monitorItems,
    selectedIds,
    layouts,
    commitMonitorItems,
    handleRemoveItem,
    setSingleSelection,
  ]);

  const cloneItems = useCallback(
    (sourceItems: readonly LayoutItem[], sourceWidgets: Readonly<Record<string, StoredWidget>>) => {
      const createdItems: LayoutItem[] = [];
      const createdWidgets: Record<string, Json> = {};
      const occupied: LayoutItem[] = [...monitorItems];

      for (const src of sourceItems) {
        if (src.type === "widget") {
          const id = newWidgetId(src.kind);
          const stored = sourceWidgets[src.id];
          createdWidgets[id] = stored ? widgetEntryToJson(stored) : { kind: src.kind };
          if (mode === "free") {
            const r = itemRectPx(src, "free", g, width, height);
            const free = pxToFree(
              {
                x: Math.min(width - r.width, r.x + 24),
                y: Math.min(height - r.height, r.y + 24),
                width: r.width,
                height: r.height,
              },
              width,
              height,
              src.free?.anchor,
            );
            const item: LayoutItem = {
              id,
              type: "widget",
              kind: src.kind,
              x: src.x,
              y: src.y,
              w: src.w,
              h: src.h,
              free,
              z: occupied.length + createdItems.length + 1,
            };
            createdItems.push(item);
          } else {
            const slot = findNearestFree(occupied, g.cols, g.rows, src.w, src.h, src.x + 1, src.y);
            if (!slot) continue;
            const item: LayoutItem = {
              id,
              type: "widget",
              kind: src.kind,
              x: slot.x,
              y: slot.y,
              w: src.w,
              h: src.h,
            };
            occupied.push(item);
            createdItems.push(item);
          }
        } else {
          const newChildren: string[] = [];
          const idMap = new Map<string, string>();
          for (const cid of src.children) {
            const stored = sourceWidgets[cid];
            const kind = stored?.kind ?? "cpu";
            const newCid = newWidgetId(kind);
            idMap.set(cid, newCid);
            newChildren.push(newCid);
            createdWidgets[newCid] = stored ? widgetEntryToJson(stored) : { kind };
          }
          const remappedRules = src.smartRules?.map((r) => ({
            ...r,
            childId: idMap.get(r.childId) ?? r.childId,
          }));
          if (mode === "free") {
            const r = itemRectPx(src, "free", g, width, height);
            const item: StackLayoutItem = {
              id: newStackId(),
              type: "stack",
              x: src.x,
              y: src.y,
              w: src.w,
              h: src.h,
              children: newChildren,
              activeIndex: src.activeIndex ?? 0,
              smartRotate: Boolean(src.smartRotate),
              ...(remappedRules?.length ? { smartRules: remappedRules } : {}),
              free: pxToFree(
                {
                  x: Math.min(width - r.width, r.x + 24),
                  y: Math.min(height - r.height, r.y + 24),
                  width: r.width,
                  height: r.height,
                },
                width,
                height,
                src.free?.anchor,
              ),
              z: occupied.length + createdItems.length + 1,
            };
            createdItems.push(item);
          } else {
            const slot = findNearestFree(occupied, g.cols, g.rows, src.w, src.h, src.x + 1, src.y);
            if (!slot) continue;
            const item: StackLayoutItem = {
              id: newStackId(),
              type: "stack",
              x: slot.x,
              y: slot.y,
              w: src.w,
              h: src.h,
              children: newChildren,
              activeIndex: src.activeIndex ?? 0,
              smartRotate: Boolean(src.smartRotate),
              ...(remappedRules?.length ? { smartRules: remappedRules } : {}),
            };
            occupied.push(item);
            createdItems.push(item);
          }
        }
      }
      if (createdItems.length === 0) return;
      commitMonitorState([...monitorItems, ...createdItems], {
        settingsPatch: { widgets: createdWidgets },
      });
      setSelectedIds(new Set(createdItems.map((i) => i.id)));
      setPrimarySelectedId(createdItems[0]?.id ?? null);
    },
    [monitorItems, mode, g, width, height, commitMonitorState],
  );

  const handleDuplicate = useCallback(
    (explicit?: LayoutItem) => {
      const targets = explicit ? [explicit] : monitorItems.filter((i) => selectedIds.has(i.id));
      if (targets.length === 0) return;
      cloneItems(targets, widgets);
    },
    [monitorItems, selectedIds, widgets, cloneItems],
  );

  const handleCopy = useCallback(
    (explicit?: LayoutItem) => {
      const targets = explicit ? [explicit] : monitorItems.filter((i) => selectedIds.has(i.id));
      if (targets.length === 0) return;
      const copiedWidgets: Record<string, StoredWidget> = {};
      for (const it of targets) {
        if (it.type === "widget") {
          const w = widgets[it.id];
          if (w) copiedWidgets[it.id] = w;
        } else {
          for (const cid of it.children) {
            const w = widgets[cid];
            if (w) copiedWidgets[cid] = w;
          }
        }
      }
      writeEditClipboard({ items: targets, widgets: copiedWidgets });
    },
    [monitorItems, selectedIds, widgets],
  );

  const handlePaste = useCallback(() => {
    const clip = readEditClipboard();
    if (!clip || clip.items.length === 0) return;
    cloneItems(clip.items, clip.widgets);
  }, [cloneItems]);

  const handleToggleLock = useCallback(
    (explicit?: LayoutItem) => {
      const ids = explicit ? new Set([explicit.id]) : selectedIds;
      if (ids.size === 0) return;
      const targets = monitorItems.filter((i) => ids.has(i.id));
      const nextLocked = !targets.every((i) => Boolean(i.locked));
      commitMonitorItems(
        monitorItems.map((it) => {
          if (!ids.has(it.id)) return it;
          if (!nextLocked) {
            const copy = { ...it };
            delete copy.locked;
            return copy;
          }
          return { ...it, locked: true };
        }),
      );
    },
    [monitorItems, selectedIds, commitMonitorItems],
  );

  const handleGroupToggle = useCallback(() => {
    if (selectedIds.size < 2) return;
    const targets = monitorItems.filter((i) => selectedIds.has(i.id));
    const existingGroup = targets[0]?.groupId;
    const allGroupedTogether =
      Boolean(existingGroup) && targets.every((i) => i.groupId === existingGroup);
    const gid = allGroupedTogether ? undefined : `grp-${String(Date.now()).slice(-6)}`;
    commitMonitorItems(
      monitorItems.map((it) => {
        if (!selectedIds.has(it.id)) return it;
        if (!gid) {
          const copy = { ...it };
          delete copy.groupId;
          return copy;
        }
        return { ...it, groupId: gid };
      }),
    );
  }, [monitorItems, selectedIds, commitMonitorItems]);

  const handleToggleMode = useCallback(() => {
    if (mode === "grid") {
      const converted = convertGridToFree(monitorItems, g, width, height);
      commitMonitorState(converted, { mode: "free" });
    } else {
      const converted = convertFreeToGrid(monitorItems, g, width, height, (it) =>
        allowedSizesOf(it, widgets),
      );
      commitMonitorState(converted, { mode: "grid" });
    }
  }, [mode, monitorItems, g, width, height, widgets, commitMonitorState]);

  const handleTidyUp = useCallback(() => {
    const tidied = tidyUpItems(monitorItems, mode, g, width, height);
    commitMonitorItems(tidied);
  }, [monitorItems, mode, g, width, height, commitMonitorItems]);

  const handleAlign = useCallback(
    (kind: AlignKind) => {
      commitMonitorItems(alignItems(monitorItems, selectedIds, kind, mode, g, width, height));
    },
    [monitorItems, selectedIds, mode, g, width, height, commitMonitorItems],
  );

  const handleDistribute = useCallback(
    (axis: DistributeAxis) => {
      commitMonitorItems(distributeItems(monitorItems, selectedIds, axis, mode, g, width, height));
    },
    [monitorItems, selectedIds, mode, g, width, height, commitMonitorItems],
  );

  const handleZOrder = useCallback(
    (item: LayoutItem, op: ZOrderOp) => {
      commitMonitorItems(reorderZ(monitorItems, new Set([item.id]), op));
    },
    [monitorItems, commitMonitorItems],
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
      const targetMon = layouts.monitors[targetKey];
      const targetExisting = targetMon?.items ?? [];
      const slot = findNearestFree(targetExisting, tg.cols, tg.rows, item.w, item.h, 0, 0);
      if (!slot) return;
      const movedItem: LayoutItem = { ...item, x: slot.x, y: slot.y };
      const next: LayoutsDoc = {
        ...layouts,
        monitors: {
          ...layouts.monitors,
          [layoutKey]: {
            ...(mode === "free" ? { mode: "free" as const } : {}),
            ...(monitorLayout?.cellSize !== undefined ? { cellSize: monitorLayout.cellSize } : {}),
            items: monitorItems.filter((i) => i.id !== item.id),
          },
          [targetKey]: {
            ...(targetMon?.mode === "free" ? { mode: "free" as const } : {}),
            ...(targetMon?.cellSize !== undefined ? { cellSize: targetMon.cellSize } : {}),
            items: [...targetExisting, movedItem],
          },
        },
      };
      commitLayouts(next);
      if (selectedIds.has(item.id)) setSingleSelection(null);
    },
    [
      layouts,
      layoutKey,
      mode,
      monitorLayout,
      monitorItems,
      commitLayouts,
      selectedIds,
      setSingleSelection,
    ],
  );

  const handleAddWidget = useCallback(
    (kind: string, size: SizeClass) => {
      const span = sizes[size];
      const id = newWidgetId(kind);
      if (mode === "free") {
        const wPx = spanPx(span.w, g.cell);
        const hPx = spanPx(span.h, g.cell);
        const offset = (monitorItems.length % 5) * 28;
        const free = pxToFree(
          {
            x: Math.max(settingsExtra.marginPx, width - settingsExtra.marginPx - wPx - offset),
            y: settingsExtra.marginPx + offset,
            width: wPx,
            height: hPx,
          },
          width,
          height,
          "top-right",
        );
        const added: LayoutItem = {
          id,
          type: "widget",
          kind,
          x: Math.max(0, g.cols - span.w),
          y: 0,
          w: span.w,
          h: span.h,
          free,
          z: monitorItems.length + 1,
        };
        commitMonitorState([...monitorItems, added], {
          settingsPatch: { widgets: { [id]: { kind } } },
        });
      } else {
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
        const added: LayoutItem = {
          id,
          type: "widget",
          kind,
          x: slot.x,
          y: slot.y,
          w: span.w,
          h: span.h,
        };
        commitMonitorState([...monitorItems, added], {
          settingsPatch: { widgets: { [id]: { kind } } },
        });
      }
      setSingleSelection(id);
      setPickerOpen(false);
    },
    [
      mode,
      monitorItems,
      g,
      width,
      height,
      settingsExtra.marginPx,
      commitMonitorState,
      setSingleSelection,
    ],
  );

  const handleApplyPreset = useCallback(
    (preset: PresetSpec) => {
      const built = buildPreset(preset, g.cols, g.rows);
      const nextItems =
        mode === "free" ? convertGridToFree(built.items, g, width, height) : built.items;
      commitMonitorState(nextItems, {
        settingsPatch: { widgets: built.widgets },
      });
      setPresetsOpen(false);
      setSingleSelection(null);
    },
    [mode, g, width, height, commitMonitorState, setSingleSelection],
  );

  const {
    drag,
    resize,
    cancel: cancelDrag,
    isClickSuppressed,
    onPointerDownItem: handlePointerDownItem,
    onStartResize: handleStartResize,
    onPickerDragStart: handlePickerDragStart,
  } = useDragController({
    edit,
    mode,
    items: monitorItems,
    selectedIds,
    widgets,
    g,
    width,
    height,
    marginPx: settingsExtra.marginPx,
    monitor,
    monitors,
    onSelect: handleSelectItem,
    onDragStart: () => {
      setContextMenu(null);
      setPresetsOpen(false);
      setThemeOpen(false);
      setLookOpen(false);
    },
    onClosePicker: () => {
      setPickerOpen(false);
    },
    onAddWidget: (id, kind) => {
      void host.updateSettings({ widgets: { [id]: { kind } } });
    },
    onMoveToDisplay: handleMoveToDisplay,
    onRemove: handleRemoveItem,
    onCommit: commitMonitorItems,
  });

  const displayedItems = drag?.preview ?? resize?.preview ?? monitorItems;

  const latestAlertCtx = useRef({ monitorItems, widgets, g, mode, width, height });
  useLayoutEffect(() => {
    latestAlertCtx.current = { monitorItems, widgets, g, mode, width, height };
  }, [monitorItems, widgets, g, mode, width, height]);

  // Clear edit session UI when leaving Edit mode, and open detail view when an alert is opened.
  useEffect(
    () =>
      useLayer.subscribe((next, prev) => {
        if (prev.peek && !next.peek) {
          setContextMenu(null);
          setHovered(false);
        }
        if (prev.edit && !next.edit) {
          setSelectedIds(new Set());
          setPrimarySelectedId(null);
          setMarquee(null);
          setPickerOpen(false);
          setPresetsOpen(false);
          setThemeOpen(false);
          setLookOpen(false);
          setStackEditId(null);
          setContextMenu(null);
          setUndoToast(null);
          setHovered(false);
          cancelDrag();
          clearHistory();
        }
        if (next.alertRule && next.alertRule !== prev.alertRule) {
          const {
            monitorItems: items,
            widgets: ws,
            g: grid,
            mode: curMode,
            width: w,
            height: h,
          } = latestAlertCtx.current;
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
                origin: itemRectPx(match, curMode, grid, w, h),
              });
            }
          }
          useLayer.setState({ alertRule: null });
        }
      }),
    [clearHistory, cancelDrag],
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

  useEditKeyboard({
    active: edit && !openSettings && !pickerOpen && !stackEditId && !contextMenu,
    mode,
    items: monitorItems,
    selectedIds,
    primarySelectedId,
    setSelectedId: (id) => {
      setSingleSelection(id);
    },
    setSelectedIds: (ids) => {
      setSelectedIds(ids);
      setPrimarySelectedId([...ids][0] ?? null);
    },
    widgets,
    g,
    width,
    height,
    hasOpenPopover: presetsOpen || themeOpen || lookOpen,
    closePopovers: () => {
      setPresetsOpen(false);
      setThemeOpen(false);
      setLookOpen(false);
    },
    onUndo: handleUndo,
    onRedo: handleRedo,
    onDuplicate: () => {
      handleDuplicate();
    },
    onCopy: () => {
      handleCopy();
    },
    onPaste: handlePaste,
    onRemoveSelected: handleRemoveSelected,
    onOpen: (item) => {
      if (item.type === "stack") setStackEditId(item.id);
      else setOpenSettings(item.id);
    },
    onCommit: commitMonitorItems,
  });

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

  // Rubber-band marquee drag on empty backdrop in Edit mode.
  const handleBackdropPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!edit || e.button !== 0) return;
      const startX = e.clientX;
      const startY = e.clientY;
      let started = false;
      let latestBox: MarqueeState | null = null;

      const onMove = (ev: PointerEvent) => {
        if (!started && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 6) {
          started = true;
          setContextMenu(null);
          setPresetsOpen(false);
          setThemeOpen(false);
          setLookOpen(false);
        }
        if (started) {
          latestBox = { startX, startY, currentX: ev.clientX, currentY: ev.clientY };
          setMarquee(latestBox);
        }
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        if (started && latestBox) {
          suppressBackdropClick.current = true;
          setTimeout(() => {
            suppressBackdropClick.current = false;
          }, 80);
          const hits = itemsInMarquee(
            monitorItems,
            {
              x: latestBox.startX,
              y: latestBox.startY,
              width: latestBox.currentX - latestBox.startX,
              height: latestBox.currentY - latestBox.startY,
            },
            mode,
            g,
            width,
            height,
          );
          setSelectedIds(new Set(hits));
          setPrimarySelectedId(hits[0] ?? null);
        }
        setMarquee(null);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [edit, monitorItems, mode, g, width, height],
  );

  // Click widget: in Edit mode selects (Shift/Ctrl multi-select) or opens settings; outside opens DetailModal.
  const handleClickItem = useCallback(
    (item: LayoutItem, e: React.MouseEvent<HTMLDivElement>) => {
      if (isClickSuppressed() || isInteractiveTarget(e.target)) return;
      if (edit) {
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          justSelectedOnDown.current = null;
          handleSelectItem(item.id, true);
          return;
        }
        if (justSelectedOnDown.current === item.id) {
          justSelectedOnDown.current = null;
          return;
        }
        if (selectedIds.size === 1 && primarySelectedId === item.id) {
          if (item.type === "stack") setStackEditId(item.id);
          else setOpenSettings(item.id);
        } else {
          handleSelectItem(item.id, false);
        }
        return;
      }
      const rect = itemRectPx(item, mode, g, width, height);
      if (item.type === "widget") {
        setDetail({ widgetId: item.id, kind: item.kind, origin: rect });
      } else {
        const activeId = item.children[item.activeIndex ?? 0] ?? item.children[0];
        const kind = activeId ? widgets[activeId]?.kind : undefined;
        if (activeId && kind) setDetail({ widgetId: activeId, kind, origin: rect });
      }
    },
    [
      edit,
      selectedIds.size,
      primarySelectedId,
      mode,
      g,
      width,
      height,
      widgets,
      isClickSuppressed,
      handleSelectItem,
    ],
  );

  const handleContextItem = useCallback(
    (item: LayoutItem, e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const x = Math.min(e.clientX, Math.max(8, width - 220));
      const y = Math.min(e.clientY, Math.max(8, height - 320));
      setContextMenu({ item, x, y });
    },
    [width, height],
  );

  // Input region (ADR 0015): the whole window while Edit mode, Peek or an overlay is open;
  // otherwise only the widgets' interactive elements, so other clicks reach the desktop.
  const fullRegion =
    peek ||
    edit ||
    openSettings !== null ||
    detail !== null ||
    pickerOpen ||
    stackEditId !== null ||
    contextMenu !== null ||
    undoToast !== null;
  const applyRegion = useCallback((rects: Rect[]) => {
    if (!inTauri) return;
    setInputRegion(rects).catch((e: unknown) => {
      console.error("input region failed", e);
    });
  }, []);
  const regionSize = useMemo(() => ({ width, height }), [width, height]);
  useInputRegion(root, fullRegion, regionSize, applyRegion);

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
  const [needsSharp, setNeedsSharp] = useState(SPIKE_WANTS_SHARP);
  const sharpWallpaper = useImage(
    needsSharp && typeof entry?.sharp === "string" ? entry.sharp : null,
  );
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

  const themeChoices = useMemo(() => {
    const fromCore = storedThemeList(themesValue);
    if (fromCore.length > 0) return fromCore;
    return BUILTIN_LOOK_IDS.map((id) => ({
      id,
      name: LOOK_STARTER_LAYOUTS[id].name,
      description: LOOK_STARTER_LAYOUTS[id].tagline,
    }));
  }, [themesValue]);
  const activeThemeId = host.theme?.id ?? host.settings.theme ?? "opaline";

  const selectedItems = useMemo(
    () => monitorItems.filter((i) => selectedIds.has(i.id)),
    [monitorItems, selectedIds],
  );
  const allSelectedLocked =
    selectedItems.length > 0 && selectedItems.every((i) => Boolean(i.locked));
  const sharedGroup = selectedItems[0]?.groupId;
  const canUngroup =
    selectedItems.length >= 2 &&
    Boolean(sharedGroup) &&
    selectedItems.every((i) => i.groupId === sharedGroup);
  const canGroup = selectedItems.length >= 2 && !canUngroup;

  // Context menu items for right-clicked widget/stack.
  const contextItems = useMemo<MenuItem[]>(() => {
    if (!contextMenu) return [];
    const it = contextMenu.item;
    const list: MenuItem[] = [
      {
        id: "edit",
        label: edit ? t(locale, "action.doneEditing") : t(locale, "action.editWidgets"),
        icon: "edit",
      },
      { id: "settings", label: t(locale, "action.widgetSettings"), icon: "tune" },
    ];
    if (it.type === "stack") {
      list.push({ id: "stack", label: t(locale, "action.editStack"), icon: "stacks" });
    }
    if (edit) {
      list.push({ id: "duplicate", label: "Duplicate", icon: "content_copy" });
      list.push({ id: "copy", label: "Copy", icon: "content_copy" });
      list.push({ id: "lock", label: it.locked ? "Unlock" : "Lock", icon: "lock" });
      if (mode === "free") {
        list.push({ id: "z-front", label: "Bring to front", icon: "keyboard_arrow_up" });
        list.push({ id: "z-back", label: "Send to back", icon: "keyboard_arrow_down" });
      }
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
    if (!it.locked) {
      list.push({ id: "remove", label: t(locale, "action.remove"), icon: "delete", danger: true });
    }
    return list;
  }, [contextMenu, edit, mode, monitors, monitor, locale]);

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
    } else if (id === "duplicate") {
      handleDuplicate(item);
    } else if (id === "copy") {
      handleCopy(item);
    } else if (id === "lock") {
      handleToggleLock(item);
    } else if (id === "z-front") {
      handleZOrder(item, "front");
    } else if (id === "z-back") {
      handleZOrder(item, "back");
    } else if (id === "remove") {
      handleRemoveItem(item);
    } else if (id.startsWith("move:")) {
      const key = id.slice(5);
      const target = monitors.find((m) => m.key === key);
      if (target) handleMoveToDisplay(item, target);
    }
  };

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
          sharpWallpaper={sharpWallpaper}
          onNeedsSharp={setNeedsSharp}
          inks={inks}
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
          <div className={styles.surface} data-layout-mode={mode}>
            {peek || edit ? (
              <div
                className={styles.backdrop}
                role="button"
                tabIndex={-1}
                aria-label={edit ? "Done editing" : "Close Peek"}
                onPointerDown={handleBackdropPointerDown}
                onClick={() => {
                  if (suppressBackdropClick.current) return;
                  if (contextMenu) {
                    setContextMenu(null);
                    return;
                  }
                  if (presetsOpen || themeOpen || lookOpen) {
                    setPresetsOpen(false);
                    setThemeOpen(false);
                    setLookOpen(false);
                    return;
                  }
                  if (edit) void setEditActive(false);
                  else void setPeekActive(false);
                }}
              />
            ) : null}

            {edit && mode === "grid" ? (
              <div
                className={styles.dotGrid}
                aria-hidden="true"
                style={{
                  left: g.originX,
                  top: g.originY,
                  width: g.width,
                  height: g.height,
                  backgroundSize: `${String(g.step)}px ${String(g.step)}px`,
                }}
              />
            ) : null}

            <DragFeedback
              part="ghost"
              drag={drag}
              resize={resize}
              marquee={marquee}
              g={g}
              locale={locale}
              dir={contentDir}
            />

            <GridItems
              items={displayedItems}
              mode={mode}
              g={g}
              workW={width}
              workH={height}
              edit={edit}
              selectedIds={selectedIds}
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
              <EditToolbar
                locale={locale}
                dir={contentDir}
                mode={mode}
                selectedCount={selectedIds.size}
                allSelectedLocked={allSelectedLocked}
                canGroup={canGroup}
                canUngroup={canUngroup}
                canUndo={canUndo}
                canRedo={canRedo}
                onAdd={() => {
                  setPresetsOpen(false);
                  setThemeOpen(false);
                  setLookOpen(false);
                  setPickerOpen(true);
                }}
                onTogglePresets={() => {
                  setThemeOpen(false);
                  setLookOpen(false);
                  setPresetsOpen((p) => !p);
                }}
                onToggleTheme={() => {
                  setPresetsOpen(false);
                  setLookOpen(false);
                  setThemeOpen((o) => !o);
                }}
                onToggleLook={() => {
                  setPresetsOpen(false);
                  setThemeOpen(false);
                  setLookOpen((o) => !o);
                }}
                onToggleMode={handleToggleMode}
                onTidyUp={handleTidyUp}
                onAlign={handleAlign}
                onDistribute={handleDistribute}
                onDuplicate={() => {
                  handleDuplicate();
                }}
                onToggleLock={() => {
                  handleToggleLock();
                }}
                onGroupToggle={handleGroupToggle}
                onSettings={() => {
                  setPresetsOpen(false);
                  setThemeOpen(false);
                  setLookOpen(false);
                  void setEditActive(false);
                  void host.command({ cmd: "open-settings" });
                }}
                onUndo={handleUndo}
                onRedo={handleRedo}
                onDone={() => {
                  void setEditActive(false);
                }}
              />
            ) : null}

            <DragFeedback
              part="zones"
              drag={drag}
              resize={resize}
              g={g}
              locale={locale}
              dir={contentDir}
            />

            {presetsOpen && edit ? (
              <div
                className={styles.menuAnchor}
                style={{ bottom: 76, left: Math.max(16, width / 2 - 180) }}
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

            {themeOpen && edit ? (
              <div
                className={styles.menuAnchor}
                style={{ bottom: 76, left: Math.max(16, width / 2 - 90) }}
              >
                <ContextMenu
                  label="Theme"
                  items={themeChoices.map((th) => ({
                    id: th.id,
                    label: th.name,
                    icon: th.id === activeThemeId ? "check" : "palette",
                  }))}
                  onSelect={(id) => {
                    setThemeOpen(false);
                    void host.updateSettings({ theme: id });
                  }}
                  onClose={() => {
                    setThemeOpen(false);
                  }}
                />
              </div>
            ) : null}

            {lookOpen && edit ? (
              <div
                className={styles.menuAnchor}
                style={{ bottom: 76, left: Math.max(16, width / 2 - 20) }}
              >
                <ContextMenu
                  label={t(locale, "settings.appearance.look")}
                  items={DESKTOP_LOOKS.map((l) => ({
                    id: l,
                    label: t(locale, `look.${l}`),
                    icon: l === lookSettings.look ? "check" : "palette",
                  }))}
                  onSelect={(id) => {
                    setLookOpen(false);
                    void host.updateSettings({ appearance: { look: id } });
                  }}
                  onClose={() => {
                    setLookOpen(false);
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
            ) : visibleProblem ? (
              <div className={`${styles.snackbarWrap} ${edit ? styles.snackbarWrapEdit : ""}`}>
                <Snackbar
                  message={`${visibleProblem.file} (${visibleProblem.at}): ${visibleProblem.message}`}
                  onDismiss={() => {
                    setDismissedProblemsKey(problemsKey);
                  }}
                />
              </div>
            ) : null}

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

      <WidgetGallery
        open={pickerOpen}
        onClose={() => {
          setPickerOpen(false);
        }}
        onAdd={handleAddWidget}
        onDragStart={handlePickerDragStart}
        onOpenBuilder={(pkg) => {
          setBuilderPkg(pkg);
        }}
      />

      {builderPkg !== undefined ? (
        <Suspense fallback={null}>
          <LazyWidgetBuilder
            key={builderPkg?.id ?? "new-widget"}
            open
            initial={builderPkg}
            onClose={() => {
              setBuilderPkg(undefined);
            }}
            onSaved={(savedPkg, addToDesktop) => {
              if (addToDesktop) {
                handleAddWidget(`custom.${savedPkg.id}`, savedPkg.defaultSize);
                setBuilderPkg(undefined);
              }
            }}
          />
        </Suspense>
      ) : null}

      {editingStack ? (
        <LayerStackEditor
          stack={editingStack}
          items={monitorItems}
          widgets={widgets}
          g={g}
          onCommit={commitMonitorItems}
          onRemoveItem={handleRemoveItem}
          onClose={() => {
            setStackEditId(null);
          }}
          onOpenWidgetSettings={(childId) => {
            setStackEditId(null);
            setOpenSettings(childId);
          }}
        />
      ) : null}

      {openSettings && openDef ? (
        <Suspense fallback={null}>
          {(() => {
            const inspectedItem =
              monitorItems.find((it) =>
                it.type === "widget" ? it.id === openSettings : it.children.includes(openSettings),
              ) ?? null;
            const inspectedOrigin = inspectedItem
              ? itemRectPx(inspectedItem, mode, g, width, height)
              : null;
            return (
              <LazyInspector
                id={openSettings}
                def={openDef}
                open
                origin={inspectedOrigin}
                viewportW={width}
                viewportH={height}
                item={inspectedItem}
                mode={mode}
                onUpdateItem={(nextItem) => {
                  commitMonitorItems(
                    monitorItems.map((it) => (it.id === nextItem.id ? nextItem : it)),
                  );
                }}
                onCustomizeLayout={() => {
                  const existing = useCustomWidgets.getState().packages.map((p) => p.id);
                  const forked = forkWidgetToPackage(openDef, existing);
                  setOpenSettings(null);
                  setBuilderPkg(forked);
                }}
                onClose={() => {
                  setOpenSettings(null);
                }}
              />
            );
          })()}
        </Suspense>
      ) : null}
    </HostContext.Provider>
  );
}

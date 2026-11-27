// The widget layer of one monitor (Phase 5): per-monitor grid, Edit mode (move, resize, stack,
// remove with 5 s undo snackbar, undo/redo, keyboard navigation, cross-display moves, widget
// picker, presets), glass context menu, shared-element detail views, Peek, Automatic appearance,
// and tight WebGL2 canvas bounds outside Edit/Peek.
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { type SizeClass, sizes } from "../design-system/tokens/tokens";
import { applyDocumentLocale, isRtl, resolveLocale, t } from "../i18n";
import { HostContext } from "../widgets/host";
import { toJson } from "../widgets/json";
import {
  LAYOUTS_TOPIC,
  PROBLEMS_TOPIC,
  WALLPAPER_TOPIC,
  attachLayer,
  storedLayouts,
  storedProblems,
  updateLayouts,
  useCoreHost,
  useLiveCss,
} from "../widgets/layerHost";
import { widgetByKind } from "../widgets/registry";
import { WidgetSettings } from "../widgets/settings/WidgetSettings";
import { type Rect, inTauri, report, setInputRegion } from "./bridge";
import { useInputRegion } from "./interactiveRegion";
import { DetailModal } from "./DetailModal";
import {
  type LayoutItem,
  type LayoutsDoc,
  type StackLayoutItem,
  cellToPx,
  computeGrid,
  findNearestFree,
  matchMonitorKey,
  refitLayout,
  waitingMonitorKeys,
} from "./grid";
import {
  PRESETS,
  type PresetSpec,
  buildPreset,
  migrateWidgetsToGrid,
  newWidgetId,
} from "./presets";
import type { Monitor } from "./protocol";
import { LayerStackEditor } from "./LayerStackEditor";
import type { ContextMenuState, DetailState, UndoToast } from "./editTypes";
import { DragFeedback } from "./DragFeedback";
import { EditToolbar } from "./EditToolbar";
import { GridItems } from "./GridItems";
import { setEditActive, setPeekActive } from "./modes";
import { useEditHistory } from "./useEditHistory";
import { useDragController } from "./useDragController";
import { useEditKeyboard } from "./useEditKeyboard";
import { useLayerPrefs } from "./useLayerPrefs";
import { allowedSizesOf, isInteractiveTarget } from "./layoutRules";
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
  const problemsValue = useLayer((s) => s.values[PROBLEMS_TOPIC]);
  const host = useCoreHost(monitor?.key ?? null);
  useLiveCss(host.theme?.id);
  const configProblems = useMemo(() => storedProblems(problemsValue), [problemsValue]);
  const [dismissedProblemsKey, setDismissedProblemsKey] = useState("");
  const problemsKey = configProblems.map((p) => `${p.file}:${p.at}:${p.message}`).join("|");
  const visibleProblem =
    configProblems.length > 0 && problemsKey !== dismissedProblemsKey ? configProblems[0] : null;

  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [openSettings, setOpenSettings] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [lookOpen, setLookOpen] = useState(false);
  const [stackEditId, setStackEditId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [undoToast, setUndoToast] = useState<UndoToast | null>(null);

  const root = useRef<HTMLDivElement>(null);
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
  const layouts = useMemo(() => storedLayouts(layoutsValue), [layoutsValue]);

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

  // Commit a new LayoutsDoc with undo tracking inside the current Edit session.
  const {
    commit: commitLayouts,
    undo: handleUndo,
    redo: handleRedo,
    canUndo,
    canRedo,
    clear: clearHistory,
  } = useEditHistory(layouts);

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
    items: monitorItems,
    widgets,
    g,
    width,
    height,
    monitor,
    monitors,
    onSelect: setSelectedId,
    onDragStart: () => {
      setContextMenu(null);
      setPresetsOpen(false);
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
          setLookOpen(false);
          setStackEditId(null);
          setContextMenu(null);
          setUndoToast(null);
          setHovered(false);
          cancelDrag();
          clearHistory();
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
    items: monitorItems,
    selectedId,
    setSelectedId,
    widgets,
    cols: g.cols,
    rows: g.rows,
    presetsOpen,
    closePresets: () => {
      setPresetsOpen(false);
    },
    onUndo: handleUndo,
    onRedo: handleRedo,
    onRemove: handleRemoveItem,
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

  // Click widget: in Edit mode opens settings/stack editor; outside Edit mode opens shared-element DetailModal.
  const handleClickItem = useCallback(
    (item: LayoutItem, e: React.MouseEvent<HTMLDivElement>) => {
      if (isClickSuppressed() || isInteractiveTarget(e.target)) return;
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
    [edit, selectedId, g, widgets, isClickSuppressed],
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
  // The full-resolution wallpaper, loaded only while a widget's blur is below the 1.x level
  // (ADR 0012); GlassStage reports that.
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

            <DragFeedback
              part="ghost"
              drag={drag}
              resize={resize}
              g={g}
              locale={locale}
              dir={contentDir}
            />

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
              <EditToolbar
                locale={locale}
                dir={contentDir}
                canUndo={canUndo}
                canRedo={canRedo}
                onAdd={() => {
                  setPresetsOpen(false);
                  setPickerOpen(true);
                }}
                onTogglePresets={() => {
                  setLookOpen(false);
                  setPresetsOpen((p) => !p);
                }}
                onToggleLook={() => {
                  setPresetsOpen(false);
                  setLookOpen((o) => !o);
                }}
                onSettings={() => {
                  setPresetsOpen(false);
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

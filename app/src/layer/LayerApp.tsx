// The widget layer of one monitor: glass over this monitor's wallpaper, the widgets, Peek
// (raised above all windows over a blurred backdrop) and the Automatic appearance. Until the
// grid engine (Phase 5) widgets sit in a column at the top right of the primary monitor.
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cssVariables } from "../design-system/color/scheme";
import { GlassStage } from "../design-system/glass";
import { applyPalette, scheduler } from "../design-system/motion";
import { resolveStyle, rolesFor, sanitizeStyle } from "../design-system/style";
import { grid, sizes, spanPx, type SizeClass } from "../design-system/tokens/tokens";
import { luminance as lum } from "../design-system/glass/legibility";
import { HostContext, type StoredSettings } from "../widgets/host";
import { attachLayer, useCoreHost, WALLPAPER_TOPIC } from "../widgets/layerHost";
import { toJson } from "../widgets/json";
import { widgetByKind } from "../widgets/registry";
import { WidgetSettings } from "../widgets/settings/WidgetSettings";
import { WidgetFrame } from "../widgets/WidgetFrame";
import { inTauri, report, setInputRegion } from "./bridge";
import { useLayer } from "./store";
import styles from "./LayerApp.module.css";

/** Written to settings the first time, so editing one doesn't make the others disappear. */
const DEFAULT_WIDGETS = {
  "a-clock": { kind: "clock" },
  "b-cpu": { kind: "cpu" },
  "c-memory": { kind: "memory" },
  "d-network": { kind: "network" },
} as const;

/** Top bar height in Native mode, where the window covers the whole monitor (Phase 5 uses the
 * real work area from the helper). */
const NATIVE_TOP = 32;

interface Placed {
  id: string;
  kind: string;
  size: SizeClass;
  x: number;
  y: number;
}

/** A column from the top right, wrapping leftwards. */
function columnLayout(
  widgets: StoredSettings["widgets"],
  width: number,
  height: number,
  top: number,
): Placed[] {
  const m = grid.safeMargin;
  const out: Placed[] = [];
  let colRight = width - m;
  let y = top + m;
  let colWidth = 0;
  for (const [id, w] of Object.entries(widgets)) {
    const def = widgetByKind(w.kind);
    if (!def) continue;
    const size = def.defaultSize;
    const wpx = spanPx(sizes[size].w);
    const hpx = spanPx(sizes[size].h);
    if (y + hpx > height - m && y > top + m) {
      colRight -= colWidth + grid.gap;
      y = top + m;
      colWidth = 0;
    }
    out.push({ id, kind: w.kind, size, x: colRight - wpx, y });
    y += hpx + grid.gap;
    colWidth = Math.max(colWidth, wpx);
  }
  return out;
}

function useImage(url: string | null): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!url || !inTauri) return;
    let alive = true;
    // Wallpapers come from opaline-asset://, which WebKitGTK won't let a page read across origins.
    // The bytes come through the layer's command channel instead and load from a same-origin
    // blob: URL, so WebGL may upload them.
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

export function LayerApp() {
  const connection = useLayer((s) => s.connection);
  const monitor = useLayer((s) => s.monitor);
  const geometry = useLayer((s) => s.geometry);
  const desktopFocused = useLayer((s) => s.desktopFocused);
  const covered = useLayer((s) => s.covered);
  const peek = useLayer((s) => s.peek);
  const wallpapers = useLayer((s) => s.values[WALLPAPER_TOPIC]);
  const host = useCoreHost(monitor?.key ?? null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!inTauri) {
      useLayer.setState({ connection: { state: "standalone" } });
      return;
    }
    attachLayer().catch((e: unknown) => {
      console.error("layer_attach failed", e);
    });
  }, []);

  // Global style → page palette (the sheet and backdrop use it; widgets set their own).
  const global = useMemo(
    () => resolveStyle(sanitizeStyle(host.settings.style)).style,
    [host.settings.style],
  );
  const roles = rolesFor(global, host.colors);
  useEffect(() => {
    applyPalette(cssVariables(roles));
  }, [roles]);

  const connected = connection.state === "connected";
  const backend = connected ? connection.backend : "instant";
  const isHome = monitor?.primary ?? true;
  const widgets = host.settings.widgets;
  const settingsLoaded = useLayer((s) => s.values.settings !== undefined);

  // Startup diagnostics: page size vs. the window geometry core placed (layer log).
  useEffect(() => {
    if (!inTauri || !geometry) return;
    report("layer-size", {
      inner: [window.innerWidth, window.innerHeight],
      dpr: window.devicePixelRatio,
      geometry,
    }).catch(() => undefined);
  }, [geometry]);

  // First run: write the default widgets once (from the primary monitor's window).
  useEffect(() => {
    if (connected && isHome && settingsLoaded && Object.keys(widgets).length === 0) {
      void host.updateSettings({ widgets: DEFAULT_WIDGETS });
    }
  }, [connected, isHome, settingsLoaded, widgets, host]);

  // Peek is synced across all monitors by the layer bridge; Esc or backdrop closes it everywhere.
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

  // Native mode: pause the rAF scheduler while this monitor's layer is covered and not peeking.
  useEffect(() => {
    scheduler.setPaused(covered && !peek);
    return () => {
      scheduler.setPaused(false);
    };
  }, [covered, peek]);

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

  const width = geometry?.width ?? window.innerWidth;
  const height = geometry?.height ?? window.innerHeight;
  const top = backend === "native" ? NATIVE_TOP : 0;
  const placed = useMemo(
    () => (isHome ? columnLayout(widgets, width, height, top) : []),
    [isHome, widgets, width, height, top],
  );

  // Clicks reach the layer only on widgets, except in Peek or with the settings sheet open.
  useLayoutEffect(() => {
    if (!inTauri) return;
    const full = peek || open !== null;
    const rects = full
      ? [{ x: 0, y: 0, width, height }]
      : placed.map((p) => ({
          x: p.x,
          y: p.y,
          width: spanPx(sizes[p.size].w),
          height: spanPx(sizes[p.size].h),
        }));
    setInputRegion(rects).catch((e: unknown) => {
      console.error("input region failed", e);
    });
  }, [placed, peek, open, width, height]);

  // Automatic appearance: full while the desktop (Native) or the layer (Instant) has focus, on
  // hover, in Peek; dimmed otherwise.
  const desktopActive = backend === "native" ? (desktopFocused ?? true) : focused;
  const autoDimmed = !(peek || hovered || desktopActive || open !== null);

  const entry = useMemo(() => {
    const all = toJson(wallpapers);
    if (typeof all !== "object" || all === null || Array.isArray(all) || !monitor) return null;
    const e = all[monitor.key];
    return typeof e === "object" && e !== null && !Array.isArray(e) ? e : null;
  }, [wallpapers, monitor]);
  const wallpaper = useImage(typeof entry?.glass === "string" ? entry.glass : null);
  const luminance = Array.isArray(entry?.luminance)
    ? entry.luminance.filter((v): v is number => typeof v === "number")
    : undefined;
  const tint: [number, number, number] = [
    (roles.surfaceContainer >> 16) & 255,
    (roles.surfaceContainer >> 8) & 255,
    roles.surfaceContainer & 255,
  ];
  const text = roles.onSurface;
  const placement = {
    offsetX: geometry && monitor ? geometry.x - monitor.x : 0,
    offsetY: geometry && monitor ? geometry.y - monitor.y : 0,
    monitorWidth: monitor?.width ?? width,
    monitorHeight: monitor?.height ?? height,
  };
  const openDef = open ? widgetByKind(widgets[open]?.kind ?? "") : undefined;

  return (
    <HostContext.Provider value={host}>
      <div ref={root} className={styles.layer}>
        <GlassStage
          wallpaper={wallpaper}
          wallpaperUrl={typeof entry?.glass === "string" ? entry.glass : null}
          placement={placement}
          tint={tint}
          textLuminance={lum((text >> 16) & 255, (text >> 8) & 255, text & 255)}
          {...(luminance ? { luminance } : {})}
          slider={45}
          backdrop={peek ? 0.92 : 0}
        >
          <div className={styles.surface}>
            {peek ? (
              <div
                className={styles.backdrop}
                role="button"
                tabIndex={-1}
                aria-label="Close Peek"
                onClick={() => {
                  void setPeekActive(false);
                }}
              />
            ) : null}
            {placed.map((p) => {
              const def = widgetByKind(p.kind);
              return def ? (
                <div
                  key={p.id}
                  className={styles.widget}
                  style={{ left: p.x, top: p.y }}
                  onPointerEnter={() => {
                    setHovered(true);
                  }}
                  onPointerLeave={() => {
                    setHovered(false);
                  }}
                >
                  <WidgetFrame
                    id={p.id}
                    def={def}
                    size={p.size}
                    autoDimmed={autoDimmed}
                    onOpenSettings={() => {
                      setOpen(p.id);
                    }}
                  />
                </div>
              ) : null;
            })}
            {/* Inside the stage's content layer: as a layer of its own, WebKitGTK stretched the
                pill's background over the whole window. */}
            {peek ? <div className={styles.hint}>Peek · Esc to close</div> : null}
          </div>
        </GlassStage>
      </div>
      {open && openDef ? (
        <WidgetSettings
          id={open}
          def={openDef}
          open
          onClose={() => {
            setOpen(null);
          }}
        />
      ) : null}
    </HostContext.Provider>
  );
}

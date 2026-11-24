// React glue for the compositor: a GlassStage owns the canvas, Glass elements register
// themselves, and the stage turns their boxes into surfaces (with adaptive legibility). In
// Phase 5 the layout springs feed positions directly; here boxes are measured after layout.
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useId,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type Surface,
  type SurfaceLook,
  GlassCompositor,
  type WallpaperPlacement,
} from "./compositor";
import { legibleAlpha, luminanceUnder, sliderAlpha } from "./legibility";
import styles from "./Glass.module.css";

export interface GlassOptions {
  radius: number;
  dimmed?: number;
  lifted?: number;
  /** This surface's tint as 0–255 RGB (a widget's own scheme or custom color); default: the stage's. */
  tint?: readonly [number, number, number] | undefined;
  /** Base tint alpha 0–1 (the widget's transparency); default: from the stage's slider. */
  alpha?: number | undefined;
  /** Frameless transparent mode: skip drawing the glass background card completely. */
  frameless?: boolean | undefined;
  /** Adaptive legibility (default on): raise the tint until text keeps 4.5 : 1. */
  legibility?: boolean | undefined;
  /** Luminance of this widget's text, when its colors differ from the stage's. */
  textLuminance?: number | undefined;
  look?: SurfaceLook | undefined;
}

function relLum(c: readonly [number, number, number]): number {
  const lin = (v: number) =>
    v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4;
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

interface Registration {
  el: HTMLElement;
  options: GlassOptions;
  hovered: boolean;
  pointer: [number, number] | null;
}

interface StageContext {
  register(id: string, reg: Registration): () => void;
  update(id: string, patch: Partial<Registration>): void;
  /** Re-measures every registered surface right now (called from spring animation ticks). */
  sync(): void;
  /** `null` when WebGL2 isn't available: Glass draws its CSS fallback. */
  compositor: GlassCompositor | null;
  fallback: {
    wallpaperUrl: string | null;
    placement: WallpaperPlacement;
    tintCss: string;
    alpha: number;
    opaque: boolean;
  };
}

const Ctx = createContext<StageContext | null>(null);

/** Returns a callback that re-syncs glass surface boxes with moving DOM elements on the same tick. */
export function useGlassSync(): () => void {
  const stage = useContext(Ctx);
  return useCallback(() => {
    stage?.sync();
  }, [stage]);
}

export interface GlassStageProps {
  children: ReactNode;
  /** Blurred wallpaper for the glass (quarter res is plenty). */
  wallpaper: TexImageSource | null;
  /** The same image as a URL, for the CSS fallback. */
  wallpaperUrl: string | null;
  placement: WallpaperPlacement;
  /** surface-container as 0–255 RGB. */
  tint: readonly [number, number, number];
  /** Primary text color luminance (on-surface), for the 4.5 : 1 rule. */
  textLuminance: number;
  /** Core's 8 × 8 luminance grid of the blurred wallpaper. */
  luminance?: readonly number[];
  /** Glass slider 0 (clear) … 100 (tinted). */
  slider: number;
  opaque?: boolean;
  backdrop?: number;
  /** Shrink the WebGL2 canvas tightly to surfaces when `backdrop === 0` (PLAN 5.10 / ADR 0009). */
  tightCanvas?: boolean;
  /** Called with the compositor once it exists (`null`: CSS fallback). Diagnostics only. */
  onCompositor?: (compositor: GlassCompositor | null) => void;
}

export function GlassStage(props: GlassStageProps) {
  const {
    children,
    wallpaper,
    wallpaperUrl,
    placement,
    tint,
    textLuminance,
    luminance,
    slider,
    opaque = false,
    backdrop = 0,
    tightCanvas = false,
    onCompositor,
  } = props;
  const stageRef = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [compositor, setCompositor] = useState<GlassCompositor | null>(null);
  const regs = useRef(new Map<string, Registration>());

  useLayoutEffect(() => {
    if (!canvas.current) return;
    const c = GlassCompositor.create(canvas.current);
    setCompositor(c);
    return () => c?.dispose();
  }, []);

  useEffect(() => onCompositor?.(compositor), [onCompositor, compositor]);

  useEffect(() => compositor?.setWallpaper(wallpaper), [compositor, wallpaper]);
  useEffect(() => compositor?.setWallpaper(wallpaper, "backdrop"), [compositor, wallpaper]);
  useEffect(() => compositor?.setOpaque(opaque), [compositor, opaque]);
  useEffect(() => compositor?.setBackdropOpacity(backdrop), [compositor, backdrop]);

  const base = sliderAlpha(slider);
  const tintLum = useMemo(() => relLum(tint), [tint]);

  const sync = useCallback(() => {
    if (!compositor || !canvas.current || !stageRef.current) return;
    const stageRect = stageRef.current.getBoundingClientRect();
    const raw: { reg: Registration; x: number; y: number; w: number; h: number }[] = [];
    for (const r of regs.current.values()) {
      if (r.options.frameless) continue;
      const b = r.el.getBoundingClientRect();
      raw.push({
        reg: r,
        x: b.left - stageRect.left,
        y: b.top - stageRect.top,
        w: b.width,
        h: b.height,
      });
    }

    // Outside Peek/Edit (`backdrop === 0`), shrink the WebGL2 canvas to the tight bounding box
    // of the surfaces (+ 48 px shadow margin) so empty monitors allocate a 1×1 canvas and
    // sparse desktops avoid full-screen HiDPI framebuffers (ADR 0009 / PLAN 5.10).
    let cx = 0;
    let cy = 0;
    let cw = stageRect.width;
    let ch = stageRect.height;
    if (tightCanvas && backdrop <= 0.001) {
      if (raw.length === 0) {
        cw = 1;
        ch = 1;
      } else {
        const pad = 48;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const item of raw) {
          minX = Math.min(minX, item.x);
          minY = Math.min(minY, item.y);
          maxX = Math.max(maxX, item.x + item.w);
          maxY = Math.max(maxY, item.y + item.h);
        }
        cx = Math.max(0, Math.floor(minX - pad));
        cy = Math.max(0, Math.floor(minY - pad));
        const right = Math.min(stageRect.width, Math.ceil(maxX + pad));
        const bottom = Math.min(stageRect.height, Math.ceil(maxY + pad));
        cw = Math.max(1, right - cx);
        ch = Math.max(1, bottom - cy);
      }
    }
    const cEl = canvas.current;
    const leftPx = `${String(cx)}px`;
    const topPx = `${String(cy)}px`;
    const widthPx = `${String(cw)}px`;
    const heightPx = `${String(ch)}px`;
    const vis = tightCanvas && backdrop <= 0.001 && raw.length === 0 ? "hidden" : "visible";
    if (cEl.style.left !== leftPx) cEl.style.left = leftPx;
    if (cEl.style.top !== topPx) cEl.style.top = topPx;
    if (cEl.style.width !== widthPx) cEl.style.width = widthPx;
    if (cEl.style.height !== heightPx) cEl.style.height = heightPx;
    if (cEl.style.visibility !== vis) cEl.style.visibility = vis;

    compositor.setPlacement({
      offsetX: placement.offsetX + cx,
      offsetY: placement.offsetY + cy,
      monitorWidth: placement.monitorWidth,
      monitorHeight: placement.monitorHeight,
    });

    const surfaces: Surface[] = [];
    for (const item of raw) {
      const r = item.reg;
      const bgLum = luminance
        ? luminanceUnder(
            luminance,
            (item.x + placement.offsetX) / placement.monitorWidth,
            (item.y + placement.offsetY) / placement.monitorHeight,
            item.w / placement.monitorWidth,
            item.h / placement.monitorHeight,
          )
        : 0.05;
      const o = r.options;
      const t = o.tint ?? tint;
      const a = o.alpha ?? base;
      surfaces.push({
        x: item.x - cx,
        y: item.y - cy,
        w: item.w,
        h: item.h,
        radius: o.radius,
        tint: [t[0] / 255, t[1] / 255, t[2] / 255],
        tintAlpha:
          o.legibility === false
            ? a
            : legibleAlpha(
                a,
                bgLum,
                o.tint ? relLum(o.tint) : tintLum,
                o.textLuminance ?? textLuminance,
              ),
        dimmed: o.dimmed ?? 0,
        hovered: r.hovered,
        lifted: o.lifted ?? 0,
        ...(r.pointer ? { pointer: [r.pointer[0] - cx, r.pointer[1] - cy] as const } : {}),
        ...(o.look ? { look: o.look } : {}),
      });
    }
    compositor.setSurfaces(surfaces);
  }, [compositor, luminance, placement, tint, base, tintLum, textLuminance, backdrop, tightCanvas]);

  useLayoutEffect(() => {
    sync();
    const ro = new ResizeObserver(sync);
    for (const r of regs.current.values()) ro.observe(r.el);
    if (stageRef.current) ro.observe(stageRef.current);
    window.addEventListener("resize", sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [sync, children]);

  const ctx = useMemo<StageContext>(
    () => ({
      register(id, reg) {
        regs.current.set(id, reg);
        sync();
        return () => {
          regs.current.delete(id);
          sync();
        };
      },
      update(id, patch) {
        const r = regs.current.get(id);
        if (!r) return;
        Object.assign(r, patch);
        sync();
      },
      sync,
      compositor,
      fallback: {
        wallpaperUrl,
        placement,
        tintCss: `${tint[0]} ${tint[1]} ${tint[2]}`,
        alpha: base,
        opaque,
      },
    }),
    [compositor, sync, wallpaperUrl, placement, tint, base, opaque],
  );

  return (
    <Ctx.Provider value={ctx}>
      <div ref={stageRef} className={styles.stage} data-glass={compositor ? "webgl2" : "css"}>
        <canvas ref={canvas} className={styles.canvas} aria-hidden="true" />
        <div className={styles.content}>{children}</div>
      </div>
    </Ctx.Provider>
  );
}

export interface GlassProps extends GlassOptions {
  children?: ReactNode;
  className?: string | undefined;
  style?: React.CSSProperties;
  /** Accessible name of the surface (a widget's name). */
  label?: string;
  /** Don't light the rim toward the pointer (style: hover lift off). */
  noHover?: boolean;
}

/** A glass surface: drawn by the compositor, or by CSS when WebGL2 is missing. */
export function Glass(props: GlassProps) {
  const { children, className, style, label, radius, dimmed, lifted } = props;
  const { tint, alpha, frameless, legibility, textLuminance, look, noHover = false } = props;
  const stage = useContext(Ctx);
  const el = useRef<HTMLDivElement>(null);
  const id = useId();
  // Style objects are new on every render; register again only when their values change.
  const key = JSON.stringify([tint, alpha, frameless, legibility, textLuminance, look]);
  const options = useMemo<GlassOptions>(
    () => ({
      radius,
      dimmed: dimmed ?? 0,
      lifted: lifted ?? 0,
      tint,
      alpha,
      frameless,
      legibility,
      textLuminance,
      look,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for the style objects
    [radius, dimmed, lifted, key],
  );

  useLayoutEffect(() => {
    if (!stage?.compositor || !el.current) return;
    return stage.register(id, {
      el: el.current,
      options,
      hovered: false,
      pointer: null,
    });
  }, [stage, id, options]);

  const onMove = (e: React.PointerEvent) => {
    if (noHover) return;
    stage?.update(id, { hovered: true, pointer: [e.clientX, e.clientY] });
  };
  const onLeave = () => {
    stage?.update(id, { hovered: false, pointer: null });
  };

  const fb = stage && !stage.compositor && !frameless ? stage.fallback : null;
  const framelessBorder: React.CSSProperties | undefined =
    frameless && look?.borderWidth && look.borderWidth > 0 && look.borderColor
      ? {
          border: `${String(look.borderWidth)}px solid rgb(${String(Math.round(look.borderColor[0] * 255))} ${String(Math.round(look.borderColor[1] * 255))} ${String(Math.round(look.borderColor[2] * 255))} / ${String(look.borderColor[3])})`,
        }
      : undefined;
  const fallbackStyle: React.CSSProperties | undefined = fb
    ? {
        ["--glass-tint" as string]: tint ? `${tint[0]} ${tint[1]} ${tint[2]}` : fb.tintCss,
        ["--glass-alpha" as string]: fb.opaque || look?.opaque ? 1 : (alpha ?? fb.alpha),
        ...(fb.wallpaperUrl
          ? {
              backgroundImage: `url("${fb.wallpaperUrl}")`,
              backgroundSize: `${fb.placement.monitorWidth}px ${fb.placement.monitorHeight}px`,
            }
          : {}),
      }
    : framelessBorder;

  return (
    <div
      ref={el}
      role="group"
      aria-label={label}
      className={`${styles.glass} ${fb ? styles.fallback : ""} ${className ?? ""}`}
      style={{ borderRadius: radius, ...fallbackStyle, ...style }}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
    >
      {children}
    </div>
  );
}

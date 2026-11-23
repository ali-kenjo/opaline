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
    onCompositor,
  } = props;
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
  useEffect(() => compositor?.setPlacement(placement), [compositor, placement]);
  useEffect(() => compositor?.setOpaque(opaque), [compositor, opaque]);
  useEffect(() => compositor?.setBackdropOpacity(backdrop), [compositor, backdrop]);

  const base = sliderAlpha(slider);
  const tintLum = useMemo(() => relLum(tint), [tint]);

  const sync = useCallback(() => {
    if (!compositor || !canvas.current) return;
    const origin = canvas.current.getBoundingClientRect();
    const surfaces: Surface[] = [];
    for (const r of regs.current.values()) {
      const b = r.el.getBoundingClientRect();
      const x = b.left - origin.left;
      const y = b.top - origin.top;
      const bgLum = luminance
        ? luminanceUnder(
            luminance,
            (x + placement.offsetX) / placement.monitorWidth,
            (y + placement.offsetY) / placement.monitorHeight,
            b.width / placement.monitorWidth,
            b.height / placement.monitorHeight,
          )
        : 0.05;
      const o = r.options;
      const t = o.tint ?? tint;
      const a = o.alpha ?? base;
      surfaces.push({
        x,
        y,
        w: b.width,
        h: b.height,
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
        ...(r.pointer ? { pointer: r.pointer } : {}),
        ...(o.look ? { look: o.look } : {}),
      });
    }
    compositor.setSurfaces(surfaces);
  }, [compositor, luminance, placement, tint, base, tintLum, textLuminance]);

  useLayoutEffect(() => {
    sync();
    const ro = new ResizeObserver(sync);
    for (const r of regs.current.values()) ro.observe(r.el);
    if (canvas.current) ro.observe(canvas.current);
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
      <div className={styles.stage} data-glass={compositor ? "webgl2" : "css"}>
        <canvas ref={canvas} className={styles.canvas} aria-hidden="true" />
        {children}
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
}

/** A glass surface: drawn by the compositor, or by CSS when WebGL2 is missing. */
export function Glass(props: GlassProps) {
  const { children, className, style, label, radius, dimmed, lifted } = props;
  const { tint, alpha, legibility, textLuminance, look } = props;
  const stage = useContext(Ctx);
  const el = useRef<HTMLDivElement>(null);
  const id = useId();
  // Style objects are new on every render; register again only when their values change.
  const key = JSON.stringify([tint, alpha, legibility, textLuminance, look]);
  const options = useMemo<GlassOptions>(
    () => ({
      radius,
      dimmed: dimmed ?? 0,
      lifted: lifted ?? 0,
      tint,
      alpha,
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
    stage?.update(id, { hovered: true, pointer: [e.clientX, e.clientY] });
  };
  const onLeave = () => {
    stage?.update(id, { hovered: false, pointer: null });
  };

  const fb = stage && !stage.compositor ? stage.fallback : null;
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
    : undefined;

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

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
import { type Surface, GlassCompositor, type WallpaperPlacement } from "./compositor";
import { legibleAlpha, luminanceUnder, sliderAlpha } from "./legibility";
import styles from "./Glass.module.css";

export interface GlassOptions {
  radius: number;
  dimmed?: number;
  lifted?: number;
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

  useEffect(() => compositor?.setWallpaper(wallpaper), [compositor, wallpaper]);
  useEffect(() => compositor?.setWallpaper(wallpaper, "backdrop"), [compositor, wallpaper]);
  useEffect(() => compositor?.setPlacement(placement), [compositor, placement]);
  useEffect(() => compositor?.setOpaque(opaque), [compositor, opaque]);
  useEffect(() => compositor?.setBackdropOpacity(backdrop), [compositor, backdrop]);

  const base = sliderAlpha(slider);
  const tintLum = useMemo(() => {
    const lin = (c: number) =>
      c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4;
    return 0.2126 * lin(tint[0]) + 0.7152 * lin(tint[1]) + 0.0722 * lin(tint[2]);
  }, [tint]);

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
      surfaces.push({
        x,
        y,
        w: b.width,
        h: b.height,
        radius: r.options.radius,
        tint: [tint[0] / 255, tint[1] / 255, tint[2] / 255],
        tintAlpha: legibleAlpha(base, bgLum, tintLum, textLuminance),
        dimmed: r.options.dimmed ?? 0,
        hovered: r.hovered,
        lifted: r.options.lifted ?? 0,
        ...(r.pointer ? { pointer: r.pointer } : {}),
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
      <div className={styles.stage}>
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
export function Glass({ children, className, style, label, radius, dimmed, lifted }: GlassProps) {
  const stage = useContext(Ctx);
  const el = useRef<HTMLDivElement>(null);
  const id = useId();

  useLayoutEffect(() => {
    if (!stage?.compositor || !el.current) return;
    return stage.register(id, {
      el: el.current,
      options: { radius, dimmed: dimmed ?? 0, lifted: lifted ?? 0 },
      hovered: false,
      pointer: null,
    });
  }, [stage, id, radius, dimmed, lifted]);

  const onMove = (e: React.PointerEvent) => {
    stage?.update(id, { hovered: true, pointer: [e.clientX, e.clientY] });
  };
  const onLeave = () => {
    stage?.update(id, { hovered: false, pointer: null });
  };

  const fb = stage && !stage.compositor ? stage.fallback : null;
  const fallbackStyle: React.CSSProperties | undefined = fb
    ? {
        ["--glass-tint" as string]: fb.tintCss,
        ["--glass-alpha" as string]: fb.opaque ? 1 : fb.alpha,
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

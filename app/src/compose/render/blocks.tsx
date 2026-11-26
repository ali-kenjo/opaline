// The renderer's richer blocks (PLAN-2 2.6): ring/gauge, chart, heatmap, shape, image and the
// controls. Each draws from the runtime's values; animations go through the shared scheduler.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { makeRamp } from "../../design-system/color/ramps";
import { DEFAULT_SOURCE } from "../../design-system/color/scheme";
import { Button, HeatStrip, Slider, Switch } from "../../design-system/components";
import { ICONS, type IconName } from "../../design-system/icons";
import { type Animator, reducedMotion, scheduler } from "../../design-system/motion/scheduler";
import { Spring } from "../../design-system/motion/spring";
import {
  MATERIAL_SHAPES,
  type MaterialShapeName,
  Morph,
  cubicsToPath,
  materialShape,
} from "../../design-system/shapes";
import type { Value } from "../../expr";
import { durationSecs } from "../../expr/funcs";
import { buildCommand } from "../commands";
import type { Node } from "../model.gen";
import { type Attrs, asString, cssColor, numbers, ratio, useField, useView, vars } from "./context";
import styles from "./View.module.css";

interface BlockProps<T extends Node["type"]> {
  node: Extract<Node, { type: T }>;
  at: string;
  attrs: Attrs;
}

/** The box a block is given (rings, charts and shapes fill it). */
export function useBoxSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      setBox((b) => (b.w === w && b.h === h ? b : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);
  return [ref, box] as const;
}

/** Points along an arc (degrees, 0 at the top, clockwise), optionally wavy, as path data. */
export function arcPath(
  cx: number,
  cy: number,
  r: number,
  from: number,
  to: number,
  wave = 0,
): string {
  if (to - from <= 0.01) return "";
  const steps = Math.max(2, Math.ceil((to - from) / 3));
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps;
    const rr = wave ? r + wave * Math.sin((a / 12) * 2 * Math.PI) : r;
    const t = (a * Math.PI) / 180;
    d += `${i === 0 ? "M" : "L"}${(cx + rr * Math.sin(t)).toFixed(2)} ${(cy - rr * Math.cos(t)).toFixed(2)}`;
  }
  return d;
}

const SEGMENT_GAP = 4;

/** The arcs of a ring (all segments, or one), filled up to `v` (0 … 1). */
function ringArcs(
  size: number,
  thickness: number,
  sweep: number,
  segments: number,
  v: number,
  wave: number,
): { track: string; value: string } {
  const c = size / 2;
  const r = c - thickness / 2 - wave;
  const start = -sweep / 2;
  if (segments <= 1) {
    return {
      track: arcPath(c, c, r, start, start + sweep, wave),
      value: arcPath(c, c, r, start, start + sweep * v, wave),
    };
  }
  // The gap must outlast the round caps, which reach thickness / 2 into it on both sides.
  const capDeg = ((thickness * 1.25) / Math.max(1, r)) * (180 / Math.PI);
  const base = Math.max(SEGMENT_GAP, capDeg);
  const gap = sweep >= 360 ? base : (base * segments) / (segments - 1);
  const seg = (sweep - gap * (sweep >= 360 ? segments : segments - 1)) / segments;
  let track = "";
  let value = "";
  for (let i = 0; i < segments; i++) {
    const a = start + i * (seg + gap);
    track += arcPath(c, c, r, a, a + seg, wave);
    const fill = Math.min(1, Math.max(0, v * segments - i));
    value += arcPath(c, c, r, a, a + seg * fill, wave);
  }
  return { track, value };
}

export function RingBlock({ node, at, attrs }: BlockProps<"ring">) {
  const { animate } = useView();
  const field = useField(at);
  const value = field("value");
  const color = node.color !== undefined ? cssColor(field("color").value) : undefined;
  const [ref, box] = useBoxSize<HTMLDivElement>();
  const size = Math.min(box.w, box.h);
  const v = ratio(value.value);
  const sweep = Math.min(360, Math.max(1, node.sweep ?? 360));
  const thickness = node.thickness ?? Math.max(4, Math.round(size / 10));
  const wave = node.wavy ? Math.max(1, thickness / 4) : 0;
  const segments = node.segments ?? 0;
  const valuePath = useRef<SVGPathElement>(null);
  const needle = useRef<SVGLineElement>(null);
  const anim = useRef<{ spring: Spring; animator: Animator } | null>(null);

  useLayoutEffect(() => {
    if (size <= 0) return;
    const target = v ?? 0;
    const draw = (x: number) => {
      valuePath.current?.setAttribute(
        "d",
        ringArcs(size, thickness, sweep, segments, x, wave).value,
      );
      const n = needle.current;
      if (n) {
        const t = ((-sweep / 2 + sweep * x) * Math.PI) / 180;
        const len = size / 2 - thickness - 4;
        n.setAttribute("x2", String(size / 2 + len * Math.sin(t)));
        n.setAttribute("y2", String(size / 2 - len * Math.cos(t)));
      }
    };
    if (!anim.current) {
      const spring = new Spring(target, "spatialDefault");
      anim.current = {
        spring,
        animator: {
          step(dt) {
            const moving = spring.step(dt);
            draw(Math.min(1, Math.max(0, spring.value)));
            return moving;
          },
        },
      };
    }
    const a = anim.current;
    if (!animate || reducedMotion()) a.spring.snap(target);
    else a.spring.setTarget(target);
    a.animator.step(0);
    scheduler.add(a.animator);
  }, [v, size, thickness, sweep, segments, wave, animate]);

  const track = size > 0 ? ringArcs(size, thickness, sweep, segments, 1, wave).track : "";
  const ticks = node.ticks ?? 0;
  const label = attrs["aria-label"] ?? `${String(Math.round((v ?? 0) * 100))} %`;
  return (
    <div
      ref={ref}
      className={`${styles.block ?? ""} ${styles.fill ?? ""} ${styles.grow ?? ""}`}
      data-state={value.failed || v === null ? "unavailable" : undefined}
      {...attrs}
    >
      {size > 0 ? (
        <svg width={size} height={size} role="meter" aria-label={label} aria-valuenow={v ?? 0}>
          <g fill="none" strokeWidth={thickness} strokeLinecap={node.caps ?? "round"}>
            <path d={track} className={styles.ringTrack} />
            <path
              ref={valuePath}
              className={styles.ringValue}
              style={color ? { stroke: color } : undefined}
            />
          </g>
          {Array.from({ length: ticks }, (_, i) => {
            const a =
              ((-sweep / 2 + (sweep * i) / Math.max(1, sweep >= 360 ? ticks : ticks - 1)) *
                Math.PI) /
              180;
            const r1 = size / 2 - thickness - 3;
            const r2 = r1 - Math.max(3, thickness / 2);
            const c = size / 2;
            return (
              <line
                key={i}
                className={styles.ringTick}
                x1={c + r1 * Math.sin(a)}
                y1={c - r1 * Math.cos(a)}
                x2={c + r2 * Math.sin(a)}
                y2={c - r2 * Math.cos(a)}
              />
            );
          })}
          {node.needle ? (
            <>
              <line
                ref={needle}
                className={styles.ringNeedle}
                x1={size / 2}
                y1={size / 2}
                x2={size / 2}
                y2={size / 2}
              />
              <circle
                className={styles.ringPin}
                cx={size / 2}
                cy={size / 2}
                r={Math.max(2, thickness / 3)}
              />
            </>
          ) : null}
        </svg>
      ) : null}
    </div>
  );
}

/** Path data for a chart in a w × h box. */
export function chartPaths(
  values: readonly number[],
  w: number,
  h: number,
  plot: "line" | "area" | "bars" | "step" | "dots",
  smooth: boolean,
  min?: number,
  max?: number,
): {
  line: string;
  area: string;
  bars: { x: number; y: number; w: number; h: number }[];
  dots: { x: number; y: number }[];
} {
  const empty = { line: "", area: "", bars: [], dots: [] };
  if (values.length === 0 || w <= 0 || h <= 0) return empty;
  const lo = min ?? Math.min(...values);
  const hi = max ?? Math.max(...values);
  const span = hi - lo || 1;
  const pad = 2;
  const y = (v: number) => h - pad - ((Math.min(hi, Math.max(lo, v)) - lo) / span) * (h - 2 * pad);
  if (plot === "bars") {
    const bw = w / values.length;
    return {
      ...empty,
      bars: values.map((v, i) => ({
        x: i * bw + bw * 0.15,
        y: y(v),
        w: bw * 0.7,
        h: h - pad - y(v),
      })),
    };
  }
  const n = values.length;
  const x = (i: number) => (n === 1 ? w / 2 : (i / (n - 1)) * w);
  const pts = values.map((v, i) => ({ x: x(i), y: y(v) }));
  if (plot === "dots") return { ...empty, dots: pts };
  let line = "";
  pts.forEach((p, i) => {
    const prev = pts[i - 1];
    if (!prev) line += `M${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
    else if (plot === "step") line += `H${p.x.toFixed(2)}V${p.y.toFixed(2)}`;
    else if (smooth) {
      // Catmull-Rom through the neighbours, as a cubic Bézier.
      const p0 = pts[i - 2] ?? prev;
      const p3 = pts[i + 1] ?? p;
      const c1x = prev.x + (p.x - p0.x) / 6;
      const c1y = prev.y + (p.y - p0.y) / 6;
      const c2x = p.x - (p3.x - prev.x) / 6;
      const c2y = p.y - (p3.y - prev.y) / 6;
      line += `C${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
    } else line += `L${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  });
  const first = pts[0];
  const last = pts[pts.length - 1];
  const area =
    plot === "area" && first && last
      ? `${line}L${last.x.toFixed(2)} ${String(h)}L${first.x.toFixed(2)} ${String(h)}Z`
      : "";
  return { line, area, bars: [], dots: [] };
}

const MAX_POINTS = 600;

/** Live points since the last history fetch (pushed in an effect, read on the next render). */
class LivePoints {
  private points: number[] = [];

  push(v: number): void {
    this.points.push(v);
    if (this.points.length > MAX_POINTS) this.points.splice(0, this.points.length - MAX_POINTS);
  }

  clear(): void {
    this.points = [];
  }

  after(history: readonly number[]): number[] {
    return [...history, ...this.points].slice(-MAX_POINTS);
  }
}
const HISTORY_REFRESH_MS = 60_000;

export function ChartBlock({ node, at, attrs }: BlockProps<"chart">) {
  const { rt, services } = useView();
  const field = useField(at);
  const values = node.values !== undefined ? field("values") : null;
  const [ref, box] = useBoxSize<HTMLDivElement>();
  const [history, setHistory] = useState<number[]>([]);
  const [livePoints] = useState(() => new LivePoints());
  const path = node.history?.path;
  const seconds = node.history ? (durationSecs(node.history.window) ?? 300) : 0;
  const live = path ? rt.value(path) : null;
  const liveNumber = typeof live === "number" ? live : null;

  // Core's history once, then live values appended; refreshed every minute while shown.
  useEffect(() => {
    if (!path || !services) return;
    let alive = true;
    const load = () => {
      services
        .history(path, seconds)
        .then((v) => {
          if (!alive) return;
          livePoints.clear();
          setHistory(v.slice(-MAX_POINTS));
        })
        .catch(() => undefined);
    };
    load();
    const t = setInterval(load, HISTORY_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [path, seconds, services, livePoints]);
  useEffect(() => {
    if (liveNumber !== null) livePoints.push(liveNumber);
  }, [liveNumber, livePoints]);

  const series = values ? numbers(values.value) : livePoints.after(history);
  const plot = node.plot ?? "area";
  const p = useMemo(
    () => chartPaths(series, box.w, box.h, plot, node.smooth ?? false, node.min, node.max),
    [series, box.w, box.h, plot, node.smooth, node.min, node.max],
  );
  return (
    <div
      ref={ref}
      className={`${styles.block ?? ""} ${styles.grow ?? ""} ${styles.chart ?? ""}`}
      data-state={values?.failed ? "unavailable" : undefined}
      {...attrs}
    >
      {box.w > 0 && box.h > 0 ? (
        <svg width={box.w} height={box.h} role="img" aria-label={attrs["aria-label"] ?? "Chart"}>
          {p.area ? <path d={p.area} className={styles.chartArea} /> : null}
          {p.line ? <path d={p.line} className={styles.chartLine} /> : null}
          {p.bars.map((b, i) => (
            <rect
              key={i}
              x={b.x}
              y={b.y}
              width={b.w}
              height={Math.max(0, b.h)}
              rx={2}
              className={styles.chartBar}
            />
          ))}
          {p.dots.map((d, i) => (
            <circle key={i} cx={d.x} cy={d.y} r={2} className={styles.chartBar} />
          ))}
        </svg>
      ) : null}
    </div>
  );
}

export function HeatmapBlock({ node, at, attrs }: BlockProps<"heatmap">) {
  const { services } = useView();
  const field = useField(at);
  const values = field("values");
  const ramp = useMemo(
    () => services?.ramp("load") ?? makeRamp("load", DEFAULT_SOURCE, true),
    [services],
  );
  const max = node.max ?? 1;
  const list = numbers(values.value).map((v) => Math.min(1, Math.max(0, v / max)));
  return (
    <div className={styles.block} data-state={values.failed ? "unavailable" : undefined} {...attrs}>
      <HeatStrip
        values={list}
        ramp={ramp}
        columns={node.columns}
        label={attrs["aria-label"] ?? "Heatmap"}
        format={(v) => `${String(Math.round(v * 100))} %`}
      />
    </div>
  );
}

const isShape = (s: string): s is MaterialShapeName =>
  (MATERIAL_SHAPES as readonly string[]).includes(s);

export function ShapeBlock({ node, at, attrs }: BlockProps<"shape">) {
  const { animate } = useView();
  const field = useField(at);
  const name = asString(field("shape").value);
  const color = node.color !== undefined ? cssColor(field("color").value) : undefined;
  const [ref, box] = useBoxSize<HTMLDivElement>();
  const size = Math.min(box.w, box.h);
  const path = useRef<SVGPathElement>(null);
  const state = useRef<{ shape: MaterialShapeName; spring: Spring; morph: Morph | null } | null>(
    null,
  );
  const shape = isShape(name) ? name : null;

  useLayoutEffect(() => {
    const el = path.current;
    if (!el || !shape || size <= 0) return;
    const s = state.current;
    if (!s || !animate || reducedMotion() || s.shape === shape) {
      state.current = { shape, spring: new Spring(1, "spatialDefault"), morph: null };
      el.setAttribute("d", cubicsToPath(materialShape(shape).cubics, size));
      return;
    }
    // A new shape: morph from the old one.
    const morph = new Morph(materialShape(s.shape), materialShape(shape));
    const spring = new Spring(0, "spatialDefault");
    spring.setTarget(1);
    state.current = { shape, spring, morph };
    scheduler.add({
      step(dt) {
        const moving = spring.step(dt);
        el.setAttribute("d", cubicsToPath(morph.asCubics(spring.value), size));
        return moving;
      },
    });
  }, [shape, size, animate]);

  return (
    <div
      ref={ref}
      className={`${styles.block ?? ""} ${styles.fill ?? ""} ${styles.grow ?? ""}`}
      {...attrs}
    >
      {shape && size > 0 ? (
        <svg width={size} height={size} aria-hidden>
          <path ref={path} className={styles.shape} style={color ? { fill: color } : undefined} />
        </svg>
      ) : null}
    </div>
  );
}

/** Images come from core (`opaline-asset://`) or inline data; nothing else is fetched. */
export const safeImage = (v: Value): string | null =>
  typeof v === "string" &&
  (v.startsWith("opaline-asset://") || /^data:image\/(png|jpeg|webp|gif);/.test(v))
    ? v
    : null;

export function ImageBlock({ node, at, attrs }: BlockProps<"image">) {
  const field = useField(at);
  const src = safeImage(field("src").value);
  return (
    <div className={`${styles.block ?? ""} ${styles.grow ?? ""}`} {...attrs}>
      {src ? (
        <img
          className={styles.image}
          src={src}
          alt={attrs["aria-label"] ?? ""}
          style={{ objectFit: node.fit ?? "cover" }}
        />
      ) : null}
    </div>
  );
}

/** Evaluates a control's command arguments (with `$value`) and sends it. */
function useSend(at: string, command: { cmd: string; args?: Record<string, string> }) {
  const { rt, scope, services } = useView();
  return async (value: Value, confirmed: boolean): Promise<string | null> => {
    const args: Record<string, Value> = {};
    for (const k of Object.keys(command.args ?? {})) {
      args[k] = rt.read(`${at}/command/args/${k}`, { ...scope, value }).value;
    }
    const cmd = buildCommand(command.cmd, args, confirmed);
    if (!cmd) return "not allowed";
    if (!services) return null;
    const r = await services.command(cmd);
    return r.result === "err" ? r.reason : null;
  };
}

export function ButtonBlock({ node, at, attrs }: BlockProps<"button">) {
  const field = useField(at);
  const send = useSend(at, node.command);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const text = asString(field("text").value);
  const iconName = node.icon !== undefined ? asString(field("icon").value) : "";
  const icon = Object.hasOwn(ICONS, iconName) ? (iconName as IconName) : undefined;
  const enabled = node.enabled === undefined || field("enabled").value === true;
  const confirm = node.confirm !== undefined ? asString(field("confirm").value) : null;
  return (
    <div className={styles.block} {...attrs} data-state={error ? "error" : undefined}>
      <Button
        variant="tonal"
        disabled={!enabled}
        {...(icon ? { icon } : {})}
        label={text}
        onClick={() => {
          if (confirm && !asking) {
            setAsking(true);
            return;
          }
          setAsking(false);
          void send(null, confirm !== null).then(setError);
        }}
      >
        {asking && confirm ? confirm : text}
      </Button>
      {error ? (
        <span className={styles.controlError} role="status">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function ToggleBlock({ node, at, attrs }: BlockProps<"toggle">) {
  const field = useField(at);
  const send = useSend(at, node.command);
  const on = field("value").value === true;
  const text =
    node.text !== undefined ? asString(field("text").value) : (attrs["aria-label"] ?? "");
  return (
    <div className={`${styles.block ?? ""} ${styles.control ?? ""}`} {...attrs}>
      {node.text !== undefined ? <span className={styles.controlLabel}>{text}</span> : null}
      <Switch
        checked={on}
        label={text}
        onChange={(next) => {
          void send(next, false);
        }}
      />
    </div>
  );
}

const SLIDER_SEND_MS = 150;

export function SliderBlock({ node, at, attrs }: BlockProps<"slider">) {
  const field = useField(at);
  const send = useSend(at, node.command);
  const current = field("value").value;
  const data = typeof current === "number" ? current : node.min;
  // While dragging, show the hand's value; send at most every 150 ms.
  const [held, setHeld] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <div className={`${styles.block ?? ""} ${styles.control ?? ""}`} {...attrs}>
      <Slider
        value={held ?? data}
        min={node.min}
        max={node.max}
        step={node.step}
        label={attrs["aria-label"] ?? "Value"}
        onChange={(v) => {
          setHeld(v);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            void send(v, false).finally(() => {
              setHeld(null);
            });
          }, SLIDER_SEND_MS);
        }}
      />
    </div>
  );
}

export function InputBlock({ node, at, attrs }: BlockProps<"input">) {
  const field = useField(at);
  const send = useSend(at, node.command);
  const current = asString(field("value").value);
  const placeholder = node.placeholder !== undefined ? asString(field("placeholder").value) : "";
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <form
      className={`${styles.block ?? ""} ${styles.control ?? ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        void send(draft ?? current, false).then(() => {
          setDraft(null);
        });
      }}
      {...attrs}
    >
      <input
        className={styles.input}
        value={draft ?? current}
        maxLength={node.maxLength}
        placeholder={placeholder}
        aria-label={attrs["aria-label"] ?? placeholder}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
      />
    </form>
  );
}

export function PluginBlock({ attrs }: BlockProps<"plugin">) {
  // Plugins arrive in P9; until then the block keeps its place and says so to screen readers.
  return <div className={styles.block} data-state="unavailable" {...attrs} style={vars({})} />;
}

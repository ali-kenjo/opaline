// Visualizer widget: the audio spectrum of what's playing, drawn on a canvas from core's 60 Hz
// frames (only while it's visible; core captures only then). Supports 10 distinct visualizer
// styles, multiple color palettes, optional glow and peak caps, and interpolated band counts.
import { useEffect, useRef } from "react";
import { makeRamp } from "../design-system/color/ramps";
import { Icon } from "../design-system/icons";
import { type Animator, scheduler } from "../design-system/motion";
import { isDark, sourceColor } from "../design-system/style";
import { map, text } from "./format";
import { useHost } from "./host";
import type { CardStatus, RenderCtx, WidgetDef } from "./types";
import styles from "./media.module.css";

const SPECTRUM = "audio.spectrum";
const STATE = "audio.state";

type Look =
  | "bars"
  | "mirror"
  | "blocks"
  | "wave"
  | "mirror-wave"
  | "horizon"
  | "dots"
  | "ring"
  | "orbit"
  | "sparks";

type ColorMode = "theme" | "gradient" | "spectrum" | "fire" | "ocean";

function css(argb: number, alpha = 1): string {
  return `rgb(${String((argb >> 16) & 255)} ${String((argb >> 8) & 255)} ${String(argb & 255)} / ${String(alpha)})`;
}

function hsl(h: number, s: number, l: number, a = 1): string {
  return `hsl(${String(Math.round(h))} ${String(Math.round(s))}% ${String(Math.round(l))}% / ${String(a)})`;
}

/** Samples `n` smoothly interpolated values from `total` raw spectrum bytes. */
function sampleBands(
  latest: readonly number[],
  total: number,
  n: number,
  off: number,
  gain: number,
): number[] {
  const out = new Array<number>(n);
  if (total <= 0) {
    out.fill(0);
    return out;
  }
  if (n <= total) {
    const step = total / n;
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * step);
      const b = Math.max(a + 1, Math.floor((i + 1) * step));
      let m = 0;
      for (let k = a; k < b && k < total; k++) m = Math.max(m, latest[off + k] ?? 0);
      out[i] = Math.min(1, (m / 255) * gain);
    }
    return out;
  }
  // Upsample cleanly with linear interpolation for 48/64-band wide visualizers.
  for (let i = 0; i < n; i++) {
    const pos = (i / (n - 1)) * (total - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(total - 1, lo + 1);
    const frac = pos - lo;
    const v = (latest[off + lo] ?? 0) * (1 - frac) + (latest[off + hi] ?? 0) * frac;
    out[i] = Math.min(1, (v / 255) * gain);
  }
  return out;
}

/** Traces a smooth quadratic curve through `(xs[i], ys[i])`. */
function traceSmooth(g: CanvasRenderingContext2D, xs: readonly number[], ys: readonly number[]) {
  if (xs.length === 0) return;
  g.moveTo(xs[0] ?? 0, ys[0] ?? 0);
  for (let i = 1; i < xs.length - 1; i++) {
    const cx = xs[i] ?? 0;
    const cy = ys[i] ?? 0;
    const nx = ((xs[i] ?? 0) + (xs[i + 1] ?? 0)) * 0.5;
    const ny = ((ys[i] ?? 0) + (ys[i + 1] ?? 0)) * 0.5;
    g.quadraticCurveTo(cx, cy, nx, ny);
  }
  const last = xs.length - 1;
  if (last > 0) g.lineTo(xs[last] ?? 0, ys[last] ?? 0);
}

function Visualizer({ ctx }: { ctx: RenderCtx }) {
  const host = useHost();
  const canvas = useRef<HTMLCanvasElement>(null);
  const { content, style } = ctx;
  const capturing = map(ctx.get(STATE))?.capturing;
  const active = capturing?.kind === "bool" ? capturing.v : true;
  const reason = text(map(ctx.get(STATE))?.reason);
  const look = content.opt<Look>("look");
  const colorMode = content.opt<ColorMode>("colorMode");
  const bands = Number(content.opt<string>("bands"));
  const peaks = content.opt<boolean>("peaks");
  const glow = content.opt<boolean>("glow");
  const gain = content.opt<number>("sensitivity") / 100;
  const byLevel = style.heroColor === "ramp";
  const dark = isDark(style, host.colors);
  const ramp = makeRamp("load", sourceColor(style, host.colors), dark);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let latest: readonly number[] = [];
    const draw = () => {
      const g = el.getContext("2d");
      if (!g) return;
      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w <= 0 || h <= 0) return;
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);

      const cs = getComputedStyle(el);
      const fixed = cs.color;
      const total = Math.floor(latest.length / 2);
      const n = Math.max(4, bands);
      const vals = sampleBands(latest, total, n, 0, gain);
      const peakVals = sampleBands(latest, total, n, total, gain);

      const bandColor = (i: number, v: number, a = 1): string => {
        const t = n > 1 ? i / (n - 1) : 0;
        switch (colorMode) {
          case "spectrum":
            return hsl(265 - t * 240, 88, dark ? 64 : 46, a);
          case "fire":
            return hsl(10 + v * 36 + t * 14, 94, dark ? 52 + v * 20 : 44 + v * 12, a);
          case "ocean":
            return hsl(182 + t * 76, 86, dark ? 56 + v * 16 : 42 + v * 12, a);
          case "gradient":
            return hsl(210 + t * 105, 80, dark ? 64 : 46, a);
          case "theme":
            if (byLevel) return css(ramp.at(v), a);
            return a >= 0.999 ? fixed : fixed.replace(/\)$/, ` / ${String(a)})`);
        }
      };

      const makeGrad = (x0: number, y0: number, x1: number, y1: number, alpha = 1) => {
        const grad = g.createLinearGradient(x0, y0, x1, y1);
        grad.addColorStop(0, bandColor(0, 0.7, alpha));
        grad.addColorStop(0.5, bandColor(Math.floor(n / 2), 0.85, alpha));
        grad.addColorStop(1, bandColor(n - 1, 0.7, alpha));
        return grad;
      };

      if (glow) {
        g.shadowBlur = 12;
        g.shadowColor = bandColor(Math.floor(n / 2), 0.8, 0.7);
      } else {
        g.shadowBlur = 0;
        g.shadowColor = "transparent";
      }

      const gap = Math.max(1, (w / n) * 0.24);
      const bw = Math.max(1.5, w / n - gap);

      if (look === "ring") {
        const cx = w / 2;
        const cy = h / 2;
        const r0 = Math.min(w, h) * 0.22;
        const r1 = Math.min(w, h) * 0.47;
        g.lineCap = "round";
        g.lineWidth = Math.max(2, (2 * Math.PI * r0) / n - 2.5);
        for (let i = 0; i < n; i++) {
          const v = vals[i] ?? 0;
          const a = (i / n) * Math.PI * 2 - Math.PI / 2;
          g.strokeStyle = bandColor(i, v);
          g.beginPath();
          g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
          g.lineTo(
            cx + Math.cos(a) * (r0 + (r1 - r0) * Math.max(0.05, v)),
            cy + Math.sin(a) * (r0 + (r1 - r0) * Math.max(0.05, v)),
          );
          g.stroke();
        }
        return;
      }

      if (look === "orbit") {
        const cx = w / 2;
        const cy = h / 2;
        const rBase = Math.min(w, h) * 0.24;
        const rAmp = Math.min(w, h) * 0.23;
        const pts: [number, number][] = [];
        for (let i = 0; i < n; i++) {
          const v = vals[i] ?? 0;
          const a = (i / n) * Math.PI * 2 - Math.PI / 2;
          const r = rBase + rAmp * v;
          pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        }
        g.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const cur = pts[i] ?? [cx, cy];
          const next = pts[(i + 1) % pts.length] ?? [cx, cy];
          const midX = (cur[0] + next[0]) * 0.5;
          const midY = (cur[1] + next[1]) * 0.5;
          if (i === 0) {
            const prev = pts[pts.length - 1] ?? [cx, cy];
            g.moveTo((prev[0] + cur[0]) * 0.5, (prev[1] + cur[1]) * 0.5);
          }
          g.quadraticCurveTo(cur[0], cur[1], midX, midY);
        }
        g.closePath();
        g.fillStyle = makeGrad(cx - rBase, cy - rBase, cx + rBase, cy + rBase, 0.28);
        g.fill();
        g.lineWidth = 2.5;
        g.strokeStyle = makeGrad(cx - rBase, cy - rBase, cx + rBase, cy + rBase, 0.95);
        g.stroke();

        // Subtle inner halo ring.
        g.beginPath();
        g.arc(cx, cy, rBase * 0.72, 0, Math.PI * 2);
        g.lineWidth = 1.5;
        g.strokeStyle = bandColor(Math.floor(n / 2), 0.5, 0.35);
        g.stroke();
        return;
      }

      if (look === "wave" || look === "mirror-wave" || look === "horizon") {
        const xs = vals.map((_, i) => (n > 1 ? (i / (n - 1)) * w : w / 2));
        if (look === "wave") {
          const ys = vals.map((v) => h - v * h * 0.88 - 3);
          g.beginPath();
          g.moveTo(0, h);
          traceSmooth(g, xs, ys);
          g.lineTo(w, h);
          g.closePath();
          const fill = g.createLinearGradient(0, 0, 0, h);
          fill.addColorStop(0, bandColor(Math.floor(n / 2), 0.85, 0.42));
          fill.addColorStop(1, bandColor(Math.floor(n / 2), 0.2, 0.02));
          g.fillStyle = fill;
          g.fill();

          g.beginPath();
          traceSmooth(g, xs, ys);
          g.lineWidth = 2.5;
          g.lineJoin = "round";
          g.strokeStyle = makeGrad(0, 0, w, 0, 1);
          g.stroke();
          return;
        }
        if (look === "mirror-wave") {
          const mid = h * 0.5;
          const topY = vals.map((v) => mid - Math.max(1.5, v * mid * 0.9));
          const botY = vals.map((v) => mid + Math.max(1.5, v * mid * 0.9));
          g.beginPath();
          traceSmooth(g, xs, topY);
          const revX = [...xs].reverse();
          const revY = [...botY].reverse();
          g.lineTo(revX[0] ?? w, revY[0] ?? mid);
          traceSmooth(g, revX, revY);
          g.closePath();
          g.fillStyle = makeGrad(0, 0, w, 0, 0.36);
          g.fill();

          g.lineWidth = 2.2;
          g.strokeStyle = makeGrad(0, 0, w, 0, 0.96);
          g.beginPath();
          traceSmooth(g, xs, topY);
          g.stroke();
          g.beginPath();
          traceSmooth(g, xs, botY);
          g.stroke();
          return;
        }
        // Horizon: layered dual-depth peaks + soft lower reflection.
        const horizonY = h * 0.72;
        const backYs = vals.map((v, i) => {
          const smooth =
            ((vals[Math.max(0, i - 1)] ?? v) + v + (vals[Math.min(n - 1, i + 1)] ?? v)) / 3;
          return horizonY - smooth * horizonY * 0.92;
        });
        const frontYs = vals.map((v) => horizonY - v * horizonY * 0.74);
        const reflYs = vals.map((v) => horizonY + v * (h - horizonY) * 0.85);

        g.beginPath();
        g.moveTo(0, horizonY);
        traceSmooth(g, xs, backYs);
        g.lineTo(w, horizonY);
        g.closePath();
        g.fillStyle = makeGrad(0, 0, w, 0, 0.25);
        g.fill();

        g.beginPath();
        g.moveTo(0, horizonY);
        traceSmooth(g, xs, frontYs);
        g.lineTo(w, horizonY);
        g.closePath();
        g.fillStyle = makeGrad(0, 0, w, 0, 0.62);
        g.fill();

        g.beginPath();
        g.moveTo(0, horizonY);
        traceSmooth(g, xs, reflYs);
        g.lineTo(w, horizonY);
        g.closePath();
        g.fillStyle = makeGrad(0, 0, w, 0, 0.18);
        g.fill();

        g.beginPath();
        g.moveTo(0, horizonY);
        g.lineTo(w, horizonY);
        g.lineWidth = 1;
        g.strokeStyle = makeGrad(0, 0, w, 0, 0.45);
        g.stroke();
        return;
      }

      for (let i = 0; i < n; i++) {
        const v = vals[i] ?? 0;
        const p = peakVals[i] ?? v;
        const x = i * (w / n) + gap / 2;

        if (look === "dots") {
          const rows = Math.max(6, Math.min(14, Math.floor(h / 10)));
          const activeDots = Math.max(1, Math.round(v * rows));
          const size = Math.min(bw, (h / rows) * 0.74);
          for (let d = 0; d < activeDots; d++) {
            const frac = (d + 1) / rows;
            g.fillStyle = bandColor(i, frac);
            g.beginPath();
            g.arc(x + bw / 2, h - size / 2 - d * (h / rows), size / 2, 0, Math.PI * 2);
            g.fill();
          }
          continue;
        }

        if (look === "blocks") {
          const rows = Math.max(6, Math.min(16, Math.floor(h / 9)));
          const cellH = h / rows;
          const blockH = Math.max(2, cellH - 2.5);
          const lit = Math.round(v * rows);
          for (let r = 0; r < lit; r++) {
            const frac = (r + 1) / rows;
            g.fillStyle = bandColor(i, frac);
            g.beginPath();
            g.roundRect(x, h - (r + 1) * cellH + 1, bw, blockH, 2);
            g.fill();
          }
          if (peaks && p > 0.02) {
            const pr = Math.min(rows - 1, Math.max(0, Math.round(p * rows) - 1));
            g.fillStyle = bandColor(i, 1, 0.92);
            g.beginPath();
            g.roundRect(x, h - (pr + 1) * cellH + 1, bw, blockH, 2);
            g.fill();
          }
          continue;
        }

        if (look === "sparks") {
          const bh = Math.max(3, v * (h - 10));
          const topY = h - bh - 4;
          const trail = g.createLinearGradient(0, topY, 0, h);
          trail.addColorStop(0, bandColor(i, v, 0.85));
          trail.addColorStop(1, bandColor(i, v * 0.3, 0.04));
          g.fillStyle = trail;
          const beamW = Math.max(1.5, bw * 0.42);
          g.fillRect(x + (bw - beamW) / 2, topY, beamW, h - topY);
          const orbR = Math.max(2.2, Math.min(bw * 0.48, 5.5));
          g.fillStyle = bandColor(i, Math.min(1, v + 0.2), 1);
          g.beginPath();
          g.arc(x + bw / 2, topY, orbR, 0, Math.PI * 2);
          g.fill();
          continue;
        }

        // Classic bars & mirrored bars.
        g.fillStyle = bandColor(i, v);
        const bh = Math.max(2, v * h * (look === "mirror" ? 0.48 : 0.96));
        const y = look === "mirror" ? h / 2 - bh : h - bh;
        g.beginPath();
        g.roundRect(x, y, bw, look === "mirror" ? bh * 2 : bh, Math.min(bw / 2, 4));
        g.fill();
        if (peaks) {
          if (look === "bars") {
            g.fillStyle = bandColor(i, p, 0.9);
            g.fillRect(x, Math.max(0, h - p * h * 0.96 - 3), bw, 2.5);
          } else {
            const ph = p * h * 0.48;
            g.fillStyle = bandColor(i, p, 0.85);
            g.fillRect(x, Math.max(0, h / 2 - ph - 3), bw, 2);
            g.fillRect(x, Math.min(h - 2, h / 2 + ph + 1), bw, 2);
          }
        }
      }
    };
    const animator: Animator = {
      ambient: true,
      step() {
        draw();
        return false;
      },
    };
    const off = host.onSpectrum((levels) => {
      latest = levels;
      scheduler.add(animator);
    });
    draw();
    return off;
  }, [host, look, colorMode, bands, peaks, glow, gain, byLevel, dark, ramp]);

  return (
    <>
      <canvas
        ref={canvas}
        className={styles.viz}
        style={{
          color: style.heroColor === "custom" ? "rgb(var(--w-hero))" : "rgb(var(--md-primary))",
        }}
        role="img"
        aria-label={active ? "Audio spectrum" : "Audio spectrum: nothing playing"}
      />
      {!active && content.opt<boolean>("idleText") ? (
        <div
          className={styles.idle}
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        >
          <span>
            <Icon name="graphic_eq" size={18} />{" "}
            {reason === "unavailable" ? "No audio device" : "Nothing playing"}
          </span>
        </div>
      ) : null}
    </>
  );
}

export const visualizer: WidgetDef = {
  kind: "visualizer",
  name: "Visualizer",
  icon: "graphic_eq",
  category: "media",
  sizes: ["2x1", "4x1", "S", "M", "L", "XL"],
  defaultSize: "M",
  topics: [SPECTRUM, STATE],
  activity: "interactive",
  defaultFields: [],
  fields: [],
  options: [
    {
      kind: "enum",
      key: "look",
      label: "Visualizer style",
      options: [
        { value: "bars", label: "Bars" },
        { value: "mirror", label: "Mirrored bars" },
        { value: "blocks", label: "LED equalizer" },
        { value: "wave", label: "Smooth wave" },
        { value: "mirror-wave", label: "Symmetrical ribbon" },
        { value: "horizon", label: "Horizon peaks" },
        { value: "dots", label: "Dot matrix" },
        { value: "ring", label: "Radial ring" },
        { value: "orbit", label: "Orbital pulse" },
        { value: "sparks", label: "Rising sparks" },
      ],
      default: "bars",
    },
    {
      kind: "enum",
      key: "colorMode",
      label: "Color palette",
      options: [
        { value: "theme", label: "Follow widget style" },
        { value: "gradient", label: "Dual gradient" },
        { value: "spectrum", label: "Rainbow spectrum" },
        { value: "fire", label: "Warm ember" },
        { value: "ocean", label: "Cool ocean" },
      ],
      default: "theme",
    },
    {
      kind: "enum",
      key: "bands",
      label: "Bands",
      options: [
        { value: "8", label: "8" },
        { value: "16", label: "16" },
        { value: "24", label: "24" },
        { value: "32", label: "32" },
        { value: "48", label: "48" },
        { value: "64", label: "64" },
      ],
      default: "32",
    },
    { kind: "bool", key: "peaks", label: "Peak hold caps", default: true },
    { kind: "bool", key: "glow", label: "Soft glow", default: false },
    {
      kind: "range",
      key: "sensitivity",
      label: "Sensitivity",
      min: 50,
      max: 250,
      step: 5,
      unit: "%",
      default: 100,
    },
    { kind: "bool", key: "idleText", label: "Say when nothing plays", default: true },
  ],
  status(c): CardStatus {
    return c.get(STATE) === undefined ? { kind: "loading" } : { kind: "ready" };
  },
  render: (ctx) => <Visualizer ctx={ctx} />,
};

// Visualizer widget (4.11, brief §8.1): audio spectrum, waveform, and stereo levels drawn from
// core's 60 Hz binary frames (only while visible; core captures only then). Supports 17 styles
// including WebGL2-accelerated spectrogram & bass particles (with clean 2D fallback), circular
// spectrum around album art, analog VU needles, LED segments, oscilloscope, and stereo split.
import { useEffect, useRef } from "react";
import { makeRamp } from "../design-system/color/ramps";
import { Icon } from "../design-system/icons";
import { type Animator, scheduler } from "../design-system/motion";
import { isDark, sourceColor } from "../design-system/style";
import { map, text } from "./format";
import { useHost } from "./host";
import type { StereoFrame } from "./spectrum";
import type { CardStatus, RenderCtx, WidgetDef } from "./types";
import { type GlColorMode, type VisualizerGl, createVisualizerGl } from "./visualizerGl";
import styles from "./media.module.css";

const SPECTRUM = "audio.spectrum";
const STATE = "audio.state";
const MEDIA_PLAYER = "media.player";

export type VisualizerLook =
  | "bars"
  | "mirror"
  | "blocks"
  | "led"
  | "wave"
  | "mirror-wave"
  | "horizon"
  | "dots"
  | "ring"
  | "album-ring"
  | "orbit"
  | "sparks"
  | "spectrogram"
  | "vu"
  | "particles"
  | "oscilloscope"
  | "stereo-split";

type ColorMode = GlColorMode;

function css(argb: number, alpha = 1): string {
  return `rgb(${String((argb >> 16) & 255)} ${String((argb >> 8) & 255)} ${String(argb & 255)} / ${String(alpha)})`;
}

function hsl(h: number, s: number, l: number, a = 1): string {
  return `hsl(${String(Math.round(h))} ${String(Math.round(s))}% ${String(Math.round(l))}% / ${String(a)})`;
}

function parseRgb(color: string): [number, number, number] {
  const m = /(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/.exec(color);
  if (!m) return [0.42, 0.66, 1.0];
  return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255];
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

/** Synthesizes a clean PCM-like waveform from spectrum bands when no raw waveform frame arrived. */
export function synthesizeWaveform(bands: readonly number[], count = 128): number[] {
  const out = new Array<number>(count);
  const b0 = bands[1] ?? 0.3;
  const b1 = bands[5] ?? 0.2;
  const b2 = bands[12] ?? 0.12;
  const b3 = bands[20] ?? 0.08;
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2;
    const s =
      Math.sin(t * 2) * b0 * 0.55 +
      Math.sin(t * 5 + 0.7) * b1 * 0.35 +
      Math.sin(t * 11 + 1.4) * b2 * 0.22 +
      Math.sin(t * 19 + 2.1) * b3 * 0.14;
    out[i] = Math.round((Math.max(-1, Math.min(1, s)) * 0.5 + 0.5) * 255);
  }
  return out;
}

/** Synthesizes stereo RMS + L/R bands from mono spectrum when no StereoFrame arrived (Lab mocks). */
export function synthesizeStereo(vals: readonly number[]): StereoFrame {
  const n = Math.max(1, vals.length);
  let sumL = 0;
  let sumR = 0;
  const left = new Array<number>(n);
  const right = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const v = vals[i] ?? 0;
    const skew = Math.sin(i * 0.55) * 0.14;
    const l = Math.min(1, Math.max(0, v * (1 + skew)));
    const r = Math.min(1, Math.max(0, v * (1 - skew)));
    left[i] = Math.round(l * 255);
    right[i] = Math.round(r * 255);
    sumL += l * l;
    sumR += r * r;
  }
  return {
    leftRms: Math.round(Math.min(1, Math.sqrt(sumL / n) * 1.25) * 255),
    rightRms: Math.round(Math.min(1, Math.sqrt(sumR / n) * 1.25) * 255),
    left,
    right,
  };
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

function drawVuDial(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  level: number,
  channel: "L" | "R",
  accent: string,
  dark: boolean,
) {
  const startA = -Math.PI * 0.82;
  const endA = -Math.PI * 0.18;
  const redStart = startA + (endA - startA) * 0.74;

  // Dial arc track
  g.save();
  g.lineWidth = Math.max(2, radius * 0.06);
  g.lineCap = "round";
  g.strokeStyle = dark ? "rgb(255 255 255 / 0.18)" : "rgb(0 0 0 / 0.16)";
  g.beginPath();
  g.arc(cx, cy, radius, startA, redStart);
  g.stroke();

  // Red overload zone (+0 to +3 dB)
  g.strokeStyle = "rgb(239 83 80 / 0.9)";
  g.beginPath();
  g.arc(cx, cy, radius, redStart, endA);
  g.stroke();

  // Scale ticks
  const ticks = 9;
  for (let t = 0; t <= ticks; t++) {
    const f = t / ticks;
    const a = startA + (endA - startA) * f;
    const inner = radius * (t % 2 === 0 ? 0.82 : 0.88);
    g.strokeStyle =
      f >= 0.74 ? "rgb(239 83 80 / 0.9)" : dark ? "rgb(255 255 255 / 0.48)" : "rgb(0 0 0 / 0.42)";
    g.lineWidth = t % 2 === 0 ? 1.5 : 1;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    g.lineTo(cx + Math.cos(a) * (radius * 0.96), cy + Math.sin(a) * (radius * 0.96));
    g.stroke();
  }

  // Channel label
  g.fillStyle = dark ? "rgb(255 255 255 / 0.65)" : "rgb(0 0 0 / 0.6)";
  g.font = `600 ${String(Math.max(9, Math.round(radius * 0.22)))}px system-ui, sans-serif`;
  g.textAlign = "center";
  g.fillText(`VU ${channel}`, cx, cy - radius * 0.34);

  // Needle
  const clamped = Math.min(1, Math.max(0, level));
  const needleA = startA + (endA - startA) * clamped;
  g.strokeStyle = clamped >= 0.78 ? "rgb(239 83 80)" : accent;
  g.lineWidth = Math.max(2, radius * 0.045);
  g.beginPath();
  g.moveTo(cx, cy);
  g.lineTo(cx + Math.cos(needleA) * (radius * 0.92), cy + Math.sin(needleA) * (radius * 0.92));
  g.stroke();

  // Pivot cap
  g.fillStyle = dark ? "rgb(240 242 248)" : "rgb(32 34 40)";
  g.beginPath();
  g.arc(cx, cy, Math.max(3, radius * 0.08), 0, Math.PI * 2);
  g.fill();
  g.restore();
}

const GL_LOOKS = new Set<VisualizerLook>(["spectrogram", "particles"]);

function Visualizer({ ctx }: { ctx: RenderCtx }) {
  const host = useHost();
  const canvas = useRef<HTMLCanvasElement>(null);
  const artImgRef = useRef<HTMLImageElement | null>(null);
  const { content, style } = ctx;
  const capturing = map(ctx.get(STATE))?.capturing;
  const active = capturing?.kind === "bool" ? capturing.v : true;
  const reason = text(map(ctx.get(STATE))?.reason);
  const look = content.opt<VisualizerLook>("look");
  const colorMode = content.opt<ColorMode>("colorMode");
  const bands = Number(content.opt<string>("bands"));
  const peaks = content.opt<boolean>("peaks");
  const glow = content.opt<boolean>("glow");
  const gain = content.opt<number>("sensitivity") / 100;
  const byLevel = style.heroColor === "ramp";
  const dark = isDark(style, host.colors);
  const ramp = makeRamp("load", sourceColor(style, host.colors), dark);
  const artUrl = look === "album-ring" ? text(map(ctx.get(MEDIA_PLAYER))?.art) : undefined;
  const still = Boolean(host.now);
  const isGlLook = GL_LOOKS.has(look);

  // Preload album art for `album-ring` without blocking render.
  useEffect(() => {
    if (!artUrl) {
      artImgRef.current = null;
      return;
    }
    let alive = true;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (alive) artImgRef.current = img;
    };
    img.src = artUrl;
    return () => {
      alive = false;
    };
  }, [artUrl]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;

    const glRenderer: VisualizerGl | null = isGlLook ? createVisualizerGl(el) : null;
    let latest: readonly number[] = [];
    let latestWave: readonly number[] | null = null;
    let latestStereo: StereoFrame | null = null;

    // Persistent 2D spectrogram waterfall history (used only when WebGL2 is unavailable).
    const specHistory: number[][] = [];
    const MAX_SPEC_COLS = 96;
    // Persistent 2D particles fallback pool.
    const fallbackParticles = Array.from({ length: 48 }, (_, i) => ({
      a: (i / 48) * Math.PI * 2,
      r: 0.14 + ((i * 29) % 100) / 130,
      band: i % 32,
    }));

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w <= 0 || h <= 0) return;

      const cs = getComputedStyle(el);
      const fixed = cs.color;
      const total = Math.floor(latest.length / 2);
      const n = Math.max(4, bands);
      const vals = sampleBands(latest, total, n, 0, gain);
      const peakVals = sampleBands(latest, total, n, total, gain);

      // WebGL2 fast path for spectrogram & bass particles.
      if (glRenderer && (look === "spectrogram" || look === "particles")) {
        const accent = parseRgb(fixed);
        if (look === "spectrogram") {
          glRenderer.drawSpectrogram(vals, w, h, dpr, colorMode, accent, still);
        } else {
          glRenderer.drawParticles(vals, w, h, dpr, colorMode, accent, still);
        }
        return;
      }

      const g = el.getContext("2d");
      if (!g) return;
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);

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

      // ── 2D fallback for spectrogram ────────────────────────────────────────
      if (look === "spectrogram") {
        if (still && specHistory.length === 0) {
          for (let c = 0; c < MAX_SPEC_COLS; c++) {
            const mod = 0.65 + 0.35 * Math.sin(c * 0.16);
            specHistory.push(vals.map((v) => Math.min(1, v * mod)));
          }
        } else {
          specHistory.push(vals);
          if (specHistory.length > MAX_SPEC_COLS) specHistory.shift();
        }
        const cols = specHistory.length;
        const cw = w / Math.max(1, MAX_SPEC_COLS);
        const rh = h / n;
        for (let c = 0; c < cols; c++) {
          const col = specHistory[c];
          if (!col) continue;
          const x = (MAX_SPEC_COLS - cols + c) * cw;
          for (let r = 0; r < n; r++) {
            const v = col[r] ?? 0;
            if (v < 0.04) continue;
            g.fillStyle = bandColor(r, v, 0.25 + v * 0.75);
            g.fillRect(x, h - (r + 1) * rh, cw + 0.6, rh + 0.6);
          }
        }
        return;
      }

      // ── 2D fallback for particles ──────────────────────────────────────────
      if (look === "particles") {
        const cx = w / 2;
        const cy = h / 2;
        const scaleR = Math.min(w, h) * 0.48;
        const bass = ((vals[0] ?? 0) + (vals[1] ?? 0) + (vals[2] ?? 0)) / 3;
        for (const p of fallbackParticles) {
          const energy = vals[p.band % n] ?? 0;
          if (!still) {
            p.r += 0.008 * (1 + bass * 3 + energy * 1.5);
            p.a += 0.012;
            if (p.r > 1.05) p.r = 0.08;
          }
          const x = cx + Math.cos(p.a) * p.r * scaleR;
          const y = cy + Math.sin(p.a) * p.r * scaleR;
          const rad = 2.5 + energy * 7 + bass * 3;
          g.fillStyle = bandColor(p.band % n, energy, 0.35 + energy * 0.65);
          g.beginPath();
          g.arc(x, y, rad, 0, Math.PI * 2);
          g.fill();
        }
        return;
      }

      // ── Circular spectrum around album art ─────────────────────────────────
      if (look === "album-ring") {
        const cx = w / 2;
        const cy = h / 2;
        const rArt = Math.min(w, h) * 0.25;
        const rInner = rArt + 5;
        const rOuter = Math.min(w, h) * 0.48;

        g.lineCap = "round";
        g.lineWidth = Math.max(2, (2 * Math.PI * rInner) / n - 2.4);
        for (let i = 0; i < n; i++) {
          const v = vals[i] ?? 0;
          const a = (i / n) * Math.PI * 2 - Math.PI / 2;
          const len = Math.max(3, (rOuter - rInner) * v);
          g.strokeStyle = bandColor(i, v);
          g.beginPath();
          g.moveTo(cx + Math.cos(a) * rInner, cy + Math.sin(a) * rInner);
          g.lineTo(cx + Math.cos(a) * (rInner + len), cy + Math.sin(a) * (rInner + len));
          g.stroke();
        }

        // Circular album art disc in center (or subtle vinyl disc fallback)
        g.save();
        g.beginPath();
        g.arc(cx, cy, rArt, 0, Math.PI * 2);
        g.closePath();
        g.clip();
        const img = artImgRef.current;
        if (img && img.complete && img.naturalWidth > 0) {
          g.drawImage(img, cx - rArt, cy - rArt, rArt * 2, rArt * 2);
        } else {
          g.fillStyle = dark ? "rgb(28 30 38)" : "rgb(228 232 242)";
          g.fillRect(cx - rArt, cy - rArt, rArt * 2, rArt * 2);
          g.strokeStyle = bandColor(Math.floor(n / 2), 0.7, 0.55);
          g.lineWidth = 2;
          g.beginPath();
          g.arc(cx, cy, rArt * 0.55, 0, Math.PI * 2);
          g.stroke();
          g.beginPath();
          g.arc(cx, cy, rArt * 0.18, 0, Math.PI * 2);
          g.stroke();
        }
        g.restore();

        // Crisp rim ring around the art disc
        g.beginPath();
        g.arc(cx, cy, rArt, 0, Math.PI * 2);
        g.lineWidth = 1.5;
        g.strokeStyle = dark ? "rgb(255 255 255 / 0.28)" : "rgb(0 0 0 / 0.18)";
        g.stroke();
        return;
      }

      // ── Analog VU needles (L / R) ──────────────────────────────────────────
      if (look === "vu") {
        const stereo = latestStereo ?? synthesizeStereo(vals);
        const lLvl = Math.min(1, (stereo.leftRms / 255) * gain);
        const rLvl = Math.min(1, (stereo.rightRms / 255) * gain);
        const accent = bandColor(Math.floor(n / 2), 0.85);
        const sideBySide = w >= h * 1.25;
        if (sideBySide) {
          const r = Math.min(w * 0.22, h * 0.72);
          const cy = h * 0.82;
          drawVuDial(g, w * 0.27, cy, r, lLvl, "L", accent, dark);
          drawVuDial(g, w * 0.73, cy, r, rLvl, "R", accent, dark);
        } else {
          const r = Math.min(w * 0.36, h * 0.38);
          drawVuDial(g, w * 0.5, h * 0.44, r, lLvl, "L", accent, dark);
          drawVuDial(g, w * 0.5, h * 0.92, r, rLvl, "R", accent, dark);
        }
        return;
      }

      // ── Oscilloscope (PCM waveform) ────────────────────────────────────────
      if (look === "oscilloscope") {
        const samples =
          latestWave && latestWave.length > 0 ? latestWave : synthesizeWaveform(vals, 128);
        // Subtle graticule grid
        g.strokeStyle = dark ? "rgb(255 255 255 / 0.08)" : "rgb(0 0 0 / 0.08)";
        g.lineWidth = 1;
        for (let row = 1; row < 4; row++) {
          const y = (h / 4) * row;
          g.beginPath();
          g.moveTo(0, y);
          g.lineTo(w, y);
          g.stroke();
        }
        for (let col = 1; col < 6; col++) {
          const x = (w / 6) * col;
          g.beginPath();
          g.moveTo(x, 0);
          g.lineTo(x, h);
          g.stroke();
        }
        // Phosphor trace
        const xs = samples.map((_, i) => (samples.length > 1 ? (i / (samples.length - 1)) * w : 0));
        const ys = samples.map((b) => {
          const norm = ((b - 128) / 128) * gain;
          return h * 0.5 - Math.max(-1, Math.min(1, norm)) * (h * 0.44);
        });
        g.beginPath();
        traceSmooth(g, xs, ys);
        g.lineWidth = 2.4;
        g.lineJoin = "round";
        g.strokeStyle = makeGrad(0, 0, w, 0, 1);
        g.stroke();
        return;
      }

      // ── Stereo split (mirrored L / R spectrum) ─────────────────────────────
      if (look === "stereo-split") {
        const stereo = latestStereo ?? synthesizeStereo(vals);
        const lBands = sampleBands(stereo.left, stereo.left.length, n, 0, gain);
        const rBands = sampleBands(stereo.right, stereo.right.length, n, 0, gain);
        const mid = h * 0.5;
        const maxH = mid - 5;

        // Center divider + L/R channel tags
        g.strokeStyle = dark ? "rgb(255 255 255 / 0.16)" : "rgb(0 0 0 / 0.14)";
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(0, mid);
        g.lineTo(w, mid);
        g.stroke();

        for (let i = 0; i < n; i++) {
          const x = i * (w / n) + gap / 2;
          const lh = Math.max(2, (lBands[i] ?? 0) * maxH);
          const rh = Math.max(2, (rBands[i] ?? 0) * maxH);
          g.fillStyle = bandColor(i, lBands[i] ?? 0, 0.95);
          g.beginPath();
          g.roundRect(x, mid - lh - 1.5, bw, lh, Math.min(bw / 2, 3));
          g.fill();

          g.fillStyle = bandColor(n - 1 - i, rBands[i] ?? 0, 0.78);
          g.beginPath();
          g.roundRect(x, mid + 1.5, bw, rh, Math.min(bw / 2, 3));
          g.fill();
        }

        g.fillStyle = dark ? "rgb(255 255 255 / 0.65)" : "rgb(0 0 0 / 0.55)";
        g.font = "600 10px system-ui, sans-serif";
        g.fillText("L", 4, 12);
        g.fillText("R", 4, h - 5);
        return;
      }

      // ── Segmented LED meter (green → amber → red) ──────────────────────────
      if (look === "led") {
        const rows = Math.max(8, Math.min(18, Math.floor(h / 8)));
        const cellH = h / rows;
        const segH = Math.max(2, cellH - 2.5);
        const unlit = dark ? "rgb(255 255 255 / 0.07)" : "rgb(0 0 0 / 0.07)";
        const ledColor = (frac: number) => {
          if (frac > 0.84) return "rgb(242 82 78)";
          if (frac > 0.62) return "rgb(247 192 64)";
          return "rgb(74 214 128)";
        };
        for (let i = 0; i < n; i++) {
          const v = vals[i] ?? 0;
          const p = peakVals[i] ?? v;
          const x = i * (w / n) + gap / 2;
          const lit = Math.round(v * rows);
          const peakRow =
            peaks && p > 0.02 ? Math.min(rows - 1, Math.max(0, Math.round(p * rows) - 1)) : -1;
          for (let r = 0; r < rows; r++) {
            const frac = (r + 1) / rows;
            const y = h - (r + 1) * cellH + 1;
            if (r < lit || r === peakRow) {
              g.fillStyle = colorMode === "theme" ? ledColor(frac) : bandColor(i, frac);
            } else {
              g.fillStyle = unlit;
            }
            g.beginPath();
            g.roundRect(x, y, bw, segH, 1.5);
            g.fill();
          }
        }
        return;
      }

      // ── Classic 1.1 looks (preserved identically) ──────────────────────────
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
    const offSpectrum = host.onSpectrum((levels) => {
      latest = levels;
      scheduler.add(animator);
    });
    const offWave =
      look === "oscilloscope" && host.onWaveform
        ? host.onWaveform((samples) => {
            latestWave = samples;
            scheduler.add(animator);
          })
        : undefined;
    const offStereo =
      (look === "vu" || look === "stereo-split") && host.onStereo
        ? host.onStereo((frame) => {
            latestStereo = frame;
            scheduler.add(animator);
          })
        : undefined;

    draw();
    return () => {
      offSpectrum();
      offWave?.();
      offStereo?.();
      scheduler.remove(animator);
      glRenderer?.dispose();
    };
  }, [
    host,
    look,
    colorMode,
    bands,
    peaks,
    glow,
    gain,
    byLevel,
    dark,
    ramp,
    isGlLook,
    still,
    artUrl,
  ]);

  return (
    <>
      <canvas
        key={isGlLook ? "gl" : "2d"}
        ref={canvas}
        className={styles.viz}
        data-look={look}
        style={{
          color: style.heroColor === "custom" ? "rgb(var(--w-hero))" : "rgb(var(--md-primary))",
        }}
        role="img"
        aria-label={active ? `Audio visualizer (${look})` : "Audio spectrum: nothing playing"}
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
  extraTopics: (c) => (c.content.opt<string>("look") === "album-ring" ? [MEDIA_PLAYER] : []),
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
        { value: "blocks", label: "Block equalizer" },
        { value: "led", label: "LED segments" },
        { value: "wave", label: "Smooth wave" },
        { value: "mirror-wave", label: "Symmetrical ribbon" },
        { value: "horizon", label: "Horizon peaks" },
        { value: "dots", label: "Dot matrix" },
        { value: "ring", label: "Radial ring" },
        { value: "album-ring", label: "Circular around album art" },
        { value: "orbit", label: "Orbital pulse" },
        { value: "sparks", label: "Rising sparks" },
        { value: "spectrogram", label: "Spectrogram waterfall" },
        { value: "vu", label: "Analog VU needles" },
        { value: "particles", label: "Bass particles" },
        { value: "oscilloscope", label: "Oscilloscope" },
        { value: "stereo-split", label: "Stereo L/R split" },
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

// Visualizer widget: the audio spectrum of what's playing, drawn on a canvas from core's 60 Hz
// frames (only while it's visible; core captures only then). Bars, mirrored bars, a wave, dots
// or a ring; peaks; colors by level or a fixed accent.
import { useEffect, useRef } from "react";
import { makeRamp } from "../design-system/color/ramps";
import { Icon } from "../design-system/icons";
import { type Animator, scheduler } from "../design-system/motion";
import { sourceColor, isDark } from "../design-system/style";
import { map, text } from "./format";
import { useHost } from "./host";
import type { CardStatus, RenderCtx, WidgetDef } from "./types";
import styles from "./media.module.css";

const SPECTRUM = "audio.spectrum";
const STATE = "audio.state";

type Look = "bars" | "mirror" | "wave" | "dots" | "ring";

function css(argb: number, alpha = 1): string {
  return `rgb(${String((argb >> 16) & 255)} ${String((argb >> 8) & 255)} ${String(argb & 255)} / ${String(alpha)})`;
}

function Visualizer({ ctx }: { ctx: RenderCtx }) {
  const host = useHost();
  const canvas = useRef<HTMLCanvasElement>(null);
  const { content, style } = ctx;
  const capturing = map(ctx.get(STATE))?.capturing;
  const active = capturing?.kind === "bool" ? capturing.v : true;
  const reason = text(map(ctx.get(STATE))?.reason);
  const look = content.opt<Look>("look");
  const bands = Number(content.opt<string>("bands"));
  const peaks = content.opt<boolean>("peaks");
  const gain = content.opt<number>("sensitivity") / 100;
  const byLevel = style.heroColor === "ramp";
  const ramp = makeRamp("load", sourceColor(style, host.colors), isDark(style, host.colors));

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
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const fixed = getComputedStyle(el).color;
      const total = latest.length / 2;
      const step = Math.max(1, Math.round(total / bands));
      const n = Math.max(1, Math.floor(total / step));
      const level = (i: number, off = 0) => {
        let m = 0;
        for (let k = 0; k < step; k++) m = Math.max(m, latest[off + i * step + k] ?? 0);
        return Math.min(1, (m / 255) * gain);
      };
      const color = (v: number, a = 1) => (byLevel ? css(ramp.at(v), a) : fixed);
      const gap = Math.max(1, (w / n) * 0.25);
      const bw = w / n - gap;
      if (look === "ring") {
        const cx = w / 2;
        const cy = h / 2;
        const r0 = Math.min(w, h) * 0.22;
        const r1 = Math.min(w, h) * 0.48;
        g.lineCap = "round";
        g.lineWidth = Math.max(2, (2 * Math.PI * r0) / n - 3);
        for (let i = 0; i < n; i++) {
          const v = level(i);
          const a = (i / n) * Math.PI * 2 - Math.PI / 2;
          g.strokeStyle = color(v);
          g.beginPath();
          g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
          g.lineTo(
            cx + Math.cos(a) * (r0 + (r1 - r0) * Math.max(0.04, v)),
            cy + Math.sin(a) * (r0 + (r1 - r0) * Math.max(0.04, v)),
          );
          g.stroke();
        }
        return;
      }
      if (look === "wave") {
        g.lineWidth = 2.5;
        g.lineJoin = "round";
        g.strokeStyle = fixed;
        g.beginPath();
        for (let i = 0; i < n; i++) {
          const x = (i + 0.5) * (w / n);
          const y = h - level(i) * h * 0.92 - 2;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
        return;
      }
      for (let i = 0; i < n; i++) {
        const v = level(i);
        const x = i * (w / n) + gap / 2;
        g.fillStyle = color(v);
        if (look === "dots") {
          const dots = Math.max(1, Math.round(v * 10));
          const size = Math.min(bw, h / 12);
          for (let d = 0; d < dots; d++) {
            g.beginPath();
            g.arc(x + bw / 2, h - size / 2 - d * (h / 10), size / 2, 0, Math.PI * 2);
            g.fill();
          }
          continue;
        }
        const bh = Math.max(2, v * h * (look === "mirror" ? 0.5 : 1));
        const y = look === "mirror" ? h / 2 - bh / 2 : h - bh;
        g.beginPath();
        g.roundRect(x, y, Math.max(1, bw), bh, Math.min(bw / 2, 4));
        g.fill();
        if (peaks && look === "bars") {
          const p = level(i, total);
          g.fillStyle = color(p, 0.85);
          g.fillRect(x, h - p * h - 3, Math.max(1, bw), 2);
        }
      }
    };
    const animator: Animator = {
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
  }, [host, look, bands, peaks, gain, byLevel, ramp]);

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
      label: "Look",
      options: [
        { value: "bars", label: "Bars" },
        { value: "mirror", label: "Mirrored" },
        { value: "wave", label: "Wave" },
        { value: "dots", label: "Dots" },
        { value: "ring", label: "Ring" },
      ],
      default: "bars",
    },
    {
      kind: "enum",
      key: "bands",
      label: "Bands",
      options: [
        { value: "8", label: "8" },
        { value: "16", label: "16" },
        { value: "32", label: "32" },
      ],
      default: "32",
    },
    { kind: "bool", key: "peaks", label: "Peaks", default: true },
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

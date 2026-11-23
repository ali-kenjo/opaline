// A Canvas2D sparkline (docs/DESIGN.md §5.2): redraws when data arrives, and slides one sample
// to the left on an effects spring so live data scrolls smoothly instead of jumping.
import { useLayoutEffect, useRef } from "react";
import { type Animator, reducedMotion, scheduler } from "../motion/scheduler";
import { Spring } from "../motion/spring";
import styles from "./data.module.css";

export interface SparklineProps {
  values: readonly number[];
  /** Fixed range; defaults to the data's min/max. */
  min?: number;
  max?: number;
  height?: number;
  color?: string;
  label: string;
}

export function Sparkline({ values, min, max, height = 40, color, label }: SparklineProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const shift = useRef(new Spring(0, "effectsDefault"));
  const latest = useRef(values);

  useLayoutEffect(() => {
    latest.current = values;
    const el = canvas.current;
    if (!el) return;
    const draw = () => {
      const ctx = el.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth;
      el.width = Math.round(w * dpr);
      el.height = Math.round(height * dpr);
      ctx.scale(dpr, dpr);
      const v = latest.current;
      if (v.length < 2) return;
      const lo = min ?? Math.min(...v);
      const hi = max ?? Math.max(...v);
      const span = hi - lo || 1;
      const step = w / (v.length - 2);
      const offset = shift.current.value * step;
      const stroke =
        color ??
        (getComputedStyle(el).getPropertyValue("--spark-color").trim() || "rgb(200 200 220)");
      ctx.beginPath();
      v.forEach((y, i) => {
        const px = (i - 1) * step + offset;
        const py = height - 2 - ((y - lo) / span) * (height - 4);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.strokeStyle = stroke;
      ctx.stroke();
      ctx.lineTo(w, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
      ctx.globalAlpha = 1;
    };
    const s = shift.current;
    const animator: Animator = {
      step(dt) {
        const moving = s.step(dt);
        draw();
        return moving;
      },
    };
    // New sample: start one step to the right and slide into place.
    if (reducedMotion()) s.snap(0);
    else {
      s.snap(1);
      s.setTarget(0);
    }
    animator.step(0);
    scheduler.add(animator);
  }, [values, min, max, height, color]);

  return (
    <canvas
      ref={canvas}
      className={styles.sparkline}
      style={{ height }}
      role="img"
      aria-label={label}
    />
  );
}

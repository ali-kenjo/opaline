// Built-in monitor visuals for Phase 4 Round 1 (CPU, Memory, GPU — PLAN-2 4.2–4.4, brief §8.1):
// - `thermal-badge`: Material shape badge that shifts shape by temperature (<45 circle →
//   <65 cookie7Sided → <80 softBurst → >=80 burst) with centered temperature readout.
// - `liquid-fill`: Memory liquid fill whose surface choppiness follows memory pressure;
//   static under reduced motion or still mode (0 frames idle; uses shared scheduler when moving).
// - `stacked-bar`: Segmented horizontal bar with compact legend (Memory composition: apps,
//   cache, buffers, shared, swap, zram/zswap, free).
// - `core-bars`: Per-core vertical load bars for CPU.
// - `app-list`: Top processes/apps with real XDG app icons (opaline-asset://icons/...) and clean
//   letter-badge fallback (never ⠿).
// - `gpu-engines`: Per-engine busyness bars (3D, Video, Copy, Compute).
import { useEffect, useRef } from "react";
import { reducedMotion, scheduler } from "../../design-system/motion/scheduler";
import { cubicsToPath, materialShape, type MaterialShapeName } from "../../design-system/shapes";
import type { Value } from "../../expr";
import { safeImage } from "./blocks";
import type { VisualProps } from "./clockVisuals";
import { cssColor } from "./context";
import styles from "./visuals.module.css";

const num = (v: Value | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: Value | undefined): string => (typeof v === "string" ? v : "");

/** Temperature (°C) → expressive Material shape (DESIGN-2 §7.2). */
export function thermalShapeFor(tempC: number): MaterialShapeName {
  if (tempC >= 80) return "burst";
  if (tempC >= 65) return "softBurst";
  if (tempC >= 45) return "cookie7Sided";
  return "circle";
}

export function ThermalBadgeVisual({ params, label }: VisualProps) {
  const tempC = num(params.tempC);
  const text = str(params.text) || (tempC !== null ? `${String(Math.round(tempC))}°` : "—");
  const shapeName = tempC !== null ? thermalShapeFor(tempC) : "circle";
  const path = cubicsToPath(materialShape(shapeName).cubics, 100);
  const hot = tempC !== null && tempC >= 80;
  const warm = tempC !== null && tempC >= 65 && tempC < 80;
  const fill =
    cssColor(params.color ?? null) ??
    (hot
      ? "rgb(var(--md-error-container))"
      : warm
        ? "rgb(var(--md-tertiary-container))"
        : "rgb(var(--md-secondary-container))");
  const fg = hot
    ? "rgb(var(--md-on-error-container))"
    : warm
      ? "rgb(var(--md-on-tertiary-container))"
      : "rgb(var(--md-on-secondary-container))";
  return (
    <div className={styles.thermalWrap} role="img" aria-label={label ?? `Temperature ${text}`}>
      <svg viewBox="0 0 100 100" className={styles.thermalSvg} aria-hidden>
        <path d={path} fill={fill} />
      </svg>
      <span className={styles.thermalText} style={{ color: fg }}>
        {text}
      </span>
    </div>
  );
}

/** Builds a smooth closed SVG wave path in a 200 × 100 viewBox filled up to `level` (0..1). */
export function liquidWavePath(level: number, amplitude: number, phase: number): string {
  const clamped = Math.max(0.04, Math.min(0.96, level));
  const baseY = 100 - clamped * 100;
  const steps = 24;
  let d = `M 0 100 L 0 ${(baseY + Math.sin(phase) * amplitude).toFixed(2)}`;
  for (let i = 1; i <= steps; i++) {
    const x = (i / steps) * 200;
    const t = (i / steps) * Math.PI * 2.5 + phase;
    const y = baseY + Math.sin(t) * amplitude + Math.cos(t * 1.7) * (amplitude * 0.35);
    d += ` L ${x.toFixed(1)} ${y.toFixed(2)}`;
  }
  d += " L 200 100 Z";
  return d;
}

export function LiquidFillVisual({ params, label, animate = false }: VisualProps) {
  const pct = num(params.percent) ?? 0;
  const pressure = num(params.pressure) ?? 0;
  const sub = str(params.sub);
  const text = str(params.text) || `${String(Math.round(pct))}%`;
  const level = Math.max(0, Math.min(1, pct / 100));
  // Choppiness scales with memory pressure (1.8 px calm → up to 8 px under pressure).
  const amp = 1.8 + Math.min(6.2, Math.max(0, pressure) * 0.6);
  const color = cssColor(params.color ?? null) ?? "rgb(var(--md-primary))";
  const wave1 = useRef<SVGPathElement>(null);
  const wave2 = useRef<SVGPathElement>(null);

  const shouldMove = animate && !reducedMotion() && pressure > 0.05;
  useEffect(() => {
    if (!shouldMove) return;
    let phase = 0;
    const speed = 1.4 + Math.min(4.0, pressure * 0.35);
    const animator = {
      ambient: true,
      step(dt: number) {
        phase += dt * speed;
        wave1.current?.setAttribute("d", liquidWavePath(level, amp, phase));
        wave2.current?.setAttribute("d", liquidWavePath(level, amp * 0.7, -phase * 0.75 + 1.4));
        return true;
      },
    };
    scheduler.add(animator);
    return () => {
      scheduler.remove(animator);
    };
  }, [shouldMove, level, amp, pressure]);

  return (
    <div
      className={styles.liquidWrap}
      role="meter"
      aria-label={label ?? `Memory ${text}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <svg
        viewBox="0 0 200 100"
        preserveAspectRatio="none"
        className={styles.liquidSvg}
        aria-hidden
      >
        <path
          ref={wave2}
          d={liquidWavePath(level, amp * 0.7, 1.4)}
          fill={color}
          fillOpacity={0.22}
        />
        <path ref={wave1} d={liquidWavePath(level, amp, 0)} fill={color} fillOpacity={0.42} />
      </svg>
      <div className={styles.liquidOverlay}>
        <span className={styles.liquidPct}>{text}</span>
        {sub ? <span className={styles.liquidSub}>{sub}</span> : null}
      </div>
    </div>
  );
}

interface BarSegment {
  label: string;
  value: number;
  color: string;
}

export function StackedBarVisual({ params, label }: VisualProps) {
  const total = num(params.total) ?? 0;
  const used = num(params.used) ?? 0;
  const cached = num(params.cached) ?? 0;
  const buffers = num(params.buffers) ?? 0;
  const shared = num(params.shared) ?? 0;
  const swapUsed = num(params.swapUsed) ?? 0;
  const compressed = num(params.compressed) ?? 0;
  const showLegend = params.legend !== false;

  const apps = Math.max(0, used - shared);
  const free = Math.max(0, total - used - cached - buffers);
  const raw: BarSegment[] = [
    { label: "Apps", value: apps, color: "rgb(var(--md-primary))" },
    { label: "Shared", value: shared, color: "rgb(var(--md-tertiary))" },
    { label: "Cache", value: cached, color: "rgb(var(--md-secondary))" },
    { label: "Buffers", value: buffers, color: "rgb(var(--md-primary) / 0.5)" },
    { label: "Compressed", value: compressed, color: "rgb(var(--md-tertiary) / 0.65)" },
    { label: "Swap", value: swapUsed, color: "rgb(var(--md-error) / 0.75)" },
    { label: "Free", value: free, color: "rgb(var(--md-on-surface) / 0.16)" },
  ];
  const segments = raw.filter((s) => s.value > 0);
  const sum = segments.reduce((acc, s) => acc + s.value, 0) || 1;

  return (
    <div className={styles.stackedBarWrap} role="img" aria-label={label ?? "Memory composition"}>
      <div className={styles.stackedBarTrack}>
        {segments.map((s) => (
          <div
            key={s.label}
            className={styles.stackedSeg}
            style={{ width: `${((s.value / sum) * 100).toFixed(2)}%`, background: s.color }}
            title={s.label}
          />
        ))}
      </div>
      {showLegend ? (
        <div className={styles.stackedLegend}>
          {segments
            .filter((s) => s.label !== "Free" && s.value / sum >= 0.02)
            .slice(0, 5)
            .map((s) => (
              <span key={s.label} className={styles.legendItem}>
                <span className={styles.legendDot} style={{ background: s.color }} />
                {s.label}
              </span>
            ))}
        </div>
      ) : null}
    </div>
  );
}

export function CoreBarsVisual({ params, label }: VisualProps) {
  const raw = Array.isArray(params.values) ? params.values : [];
  const values = raw.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const max = num(params.max) ?? 100;
  if (values.length === 0) return null;
  return (
    <div className={styles.coreBarsWrap} role="img" aria-label={label ?? "Per-core load"}>
      {values.map((v, i) => {
        const pct = Math.max(4, Math.min(100, (v / max) * 100));
        const hot = pct >= 85;
        return (
          <div
            key={i}
            className={styles.coreBarCol}
            title={`Core ${String(i)}: ${String(Math.round(v))}%`}
          >
            <div
              className={styles.coreBarFill}
              style={{
                height: `${pct.toFixed(1)}%`,
                background: hot ? "rgb(var(--md-error))" : undefined,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

function fmtBytesCompact(b: number, binary: boolean): string {
  const base = binary ? 1024 : 1000;
  const units = binary ? ["B", "KiB", "MiB", "GiB"] : ["B", "KB", "MB", "GB"];
  let v = b;
  let i = 0;
  while (v >= base && i < units.length - 1) {
    v /= base;
    i++;
  }
  return `${v >= 10 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i] ?? "B"}`;
}

export function AppListVisual({ params, label }: VisualProps) {
  const list = Array.isArray(params.apps) ? params.apps : [];
  const metric = str(params.metric) || "cpu";
  const binary = params.binary === true;
  const max = num(params.max) ?? 4;

  const entries = list
    .filter(
      (x): x is Record<string, Value> => typeof x === "object" && x !== null && !Array.isArray(x),
    )
    .map((item) => ({
      name: str(item.name) || str(item.id) || "App",
      iconUrl: safeImage(item.iconUrl ?? null),
      cpu: num(item.cpu) ?? 0,
      memB: num(item.memB) ?? 0,
      vramB: num(item.vramB),
      percent: num(item.percent),
    }));

  entries.sort((a, b) => {
    if (metric === "mem") return b.memB - a.memB;
    if (metric === "gpu")
      return (b.percent ?? 0) - (a.percent ?? 0) || (b.vramB ?? 0) - (a.vramB ?? 0);
    return b.cpu - a.cpu;
  });

  const shown = entries.slice(0, max);
  if (shown.length === 0) return null;

  return (
    <div className={styles.appListWrap} role="list" aria-label={label ?? "Top apps"}>
      {shown.map((app, i) => {
        const stat =
          metric === "mem"
            ? fmtBytesCompact(app.memB, binary)
            : metric === "gpu"
              ? app.vramB !== null
                ? fmtBytesCompact(app.vramB, binary)
                : app.percent !== null
                  ? `${String(Math.round(app.percent))}%`
                  : ""
              : `${app.cpu >= 10 ? app.cpu.toFixed(0) : app.cpu.toFixed(1)}%`;
        return (
          <div key={`${app.name}-${String(i)}`} className={styles.appRow} role="listitem">
            {app.iconUrl ? (
              <img src={app.iconUrl} alt="" className={styles.appIconImg} />
            ) : (
              <span className={styles.appIconFallback} aria-hidden>
                {app.name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className={styles.appName}>{app.name}</span>
            {stat ? <span className={styles.appStat}>{stat}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

export function GpuEnginesVisual({ params, label }: VisualProps) {
  const render3d = num(params.render3d);
  const video = num(params.video);
  const copy = num(params.copy);
  const compute = num(params.compute);
  const rows = [
    { name: "3D", value: render3d },
    { name: "Video", value: video },
    { name: "Copy", value: copy },
    { name: "Compute", value: compute },
  ].filter((r): r is { name: string; value: number } => r.value !== null);

  if (rows.length === 0) return null;
  return (
    <div className={styles.enginesWrap} role="img" aria-label={label ?? "GPU engines"}>
      {rows.map((r) => {
        const clamped = Math.max(0, Math.min(100, r.value));
        return (
          <div key={r.name} className={styles.engineRow}>
            <span className={styles.engineLabel}>{r.name}</span>
            <div className={styles.engineTrack}>
              <div className={styles.engineFill} style={{ width: `${clamped.toFixed(1)}%` }} />
            </div>
            <span className={styles.engineVal}>{Math.round(clamped)}%</span>
          </div>
        );
      })}
    </div>
  );
}

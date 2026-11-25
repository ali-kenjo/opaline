// Small building blocks shared by the three directions: the card on glass, a Material shape as
// SVG, and the procedural album art (original artwork, no files).
import type { CSSProperties, ReactNode } from "react";
import { Glass } from "../../design-system/glass";
import type { SurfaceLook } from "../../design-system/glass/compositor";
import { cubicsToPath, type MaterialShapeName, materialShape } from "../../design-system/shapes";
import styles from "./Directions.module.css";

export type CardSize = "S" | "M";

export const CARD = {
  S: { w: 180, h: 180, radius: 28 },
  M: { w: 372, h: 180, radius: 32 },
} as const;

export interface CardProps {
  size: CardSize;
  label: string;
  alpha: number;
  tint?: readonly [number, number, number] | undefined;
  look?: SurfaceLook;
  className?: string | undefined;
  style?: CSSProperties;
  children: ReactNode;
}

export function Card({ size, label, alpha, tint, look, className, style, children }: CardProps) {
  const c = CARD[size];
  return (
    <Glass
      radius={c.radius}
      alpha={alpha}
      tint={tint}
      look={look}
      legibility={false}
      label={label}
      className={`${styles.card} ${className ?? ""}`}
      style={{ width: c.w, height: c.h, ...style }}
    >
      {children}
    </Glass>
  );
}

export interface ShapeProps {
  name: MaterialShapeName;
  size: number;
  fill: string;
  rotate?: number;
  className?: string | undefined;
  style?: CSSProperties;
  children?: ReactNode;
}

/** A Material shape with optional centered content (a number inside a badge). */
export function Shape({ name, size, fill, rotate = 0, className, style, children }: ShapeProps) {
  const d = cubicsToPath(materialShape(name).cubics, size);
  return (
    <div
      className={`${styles.shape} ${className ?? ""}`}
      style={{ width: size, height: size, ...style }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${String(size)} ${String(size)}`} aria-hidden>
        <path
          d={d}
          fill={fill}
          transform={
            rotate ? `rotate(${String(rotate)} ${String(size / 2)} ${String(size / 2)})` : undefined
          }
        />
      </svg>
      {children ? <div className={styles.shapeContent}>{children}</div> : null}
    </div>
  );
}

/** Original procedural cover art: warm rings on a deep field. */
export const ART_BACKGROUND =
  "radial-gradient(circle at 30% 28%, #ffd38a 0 12%, transparent 13%)," +
  "radial-gradient(circle at 64% 70%, #ff6fa5 0 22%, transparent 23%)," +
  "conic-gradient(from 210deg at 50% 50%, #3b1d6e, #8a2f8f, #e2557a, #ff9a5a, #3b1d6e)";

export function Art({
  size,
  radius = 16,
  style,
}: {
  size: number;
  radius?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      className={styles.art}
      role="img"
      aria-label="Album art"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: ART_BACKGROUND,
        ...style,
      }}
    />
  );
}

/** An SVG path through `values`, scaled into w × h (min/max from the data, with padding). */
export function linePath(values: readonly number[], w: number, h: number, pad = 4): string {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const step = w / (values.length - 1);
  return values
    .map((v, i) => {
      const x = i * step;
      const y = pad + (1 - (v - lo) / span) * (h - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

/** A smooth (Catmull-Rom) version of `linePath`. */
export function smoothPath(values: readonly number[], w: number, h: number, pad = 4): string {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const step = w / (values.length - 1);
  const pts = values.map(
    (v, i) => [i * step, pad + (1 - (v - lo) / span) * (h - pad * 2)] as const,
  );
  let d = `M${pts[0]?.[0].toFixed(1) ?? "0"} ${pts[0]?.[1].toFixed(1) ?? "0"}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)] ?? p2;
    if (!p0 || !p1 || !p2 || !p3) continue;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

/** Point on a circle, angle in degrees clockwise from 12 o'clock. */
export function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

/** An SVG arc from `from` to `to` degrees (clockwise from 12 o'clock). */
export function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const [x0, y0] = polar(cx, cy, r, from);
  const [x1, y1] = polar(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${String(r)} ${String(r)} 0 ${String(large)} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

// A row/grid of cells colored along a semantic ramp (per-thread load, per-core heat). The
// values are also exposed as text for screen readers.
import { Hct } from "@material/material-color-utilities";
import type { Ramp } from "../color/ramps";
import styles from "./data.module.css";

export interface HeatStripProps {
  /** 0 … 1 per cell. */
  values: readonly number[];
  ramp: Ramp;
  columns?: number;
  label: string;
  /** How each value reads aloud, e.g. (v) => `${Math.round(v * 100)} %`. */
  format: (v: number) => string;
}

const css = (argb: number) => {
  const h = Hct.fromInt(argb).toInt();
  return `rgb(${(h >> 16) & 255} ${(h >> 8) & 255} ${h & 255})`;
};

export function HeatStrip({ values, ramp, columns, label, format }: HeatStripProps) {
  return (
    <div
      className={styles.heat}
      style={{ gridTemplateColumns: `repeat(${columns ?? values.length}, 1fr)` }}
      role="img"
      aria-label={`${label}: ${values.map(format).join(", ")}`}
    >
      {values.map((v, i) => (
        <span
          key={i}
          className={styles.heatCell}
          style={{
            background: css(ramp.at(v)),
            opacity: 0.35 + 0.65 * Math.min(1, Math.max(0, v)),
          }}
        />
      ))}
    </div>
  );
}

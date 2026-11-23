// Material 3 Expressive wavy linear progress: the filled part is a sine wave, the rest a flat
// track; the wave flattens near 0 and 1 and in reduced motion.
import styles from "./data.module.css";

export interface WavyProgressProps {
  /** 0 … 1 */
  value: number;
  width?: number;
  amplitude?: number;
  wavelength?: number;
  label: string;
}

export function WavyProgress({
  value,
  width = 240,
  amplitude = 3,
  wavelength = 24,
  label,
}: WavyProgressProps) {
  const v = Math.min(1, Math.max(0, value));
  const h = amplitude * 2 + 6;
  const mid = h / 2;
  const end = v * width;
  // Damp the amplitude at the ends so it starts and finishes flat.
  const amp = amplitude * Math.min(1, v * 8, (1 - v) * 8 + 0.25);
  let d = `M0 ${mid}`;
  for (let x = 2; x <= end; x += 2)
    d += `L${x.toFixed(1)} ${(mid + Math.sin((x / wavelength) * Math.PI * 2) * amp).toFixed(2)}`;
  const gap = 6;
  return (
    <svg
      className={styles.wavy}
      viewBox={`0 0 ${width} ${h}`}
      height={h}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
    >
      <path
        d={d}
        fill="none"
        stroke="rgb(var(--md-primary))"
        strokeWidth={4}
        strokeLinecap="round"
      />
      {end + gap < width ? (
        <line
          x1={end + gap}
          y1={mid}
          x2={width}
          y2={mid}
          stroke="rgb(var(--md-secondary-container))"
          strokeWidth={4}
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  );
}

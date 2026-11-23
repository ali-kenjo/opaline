import styles from "./controls.module.css";

export interface SliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  label: string;
  /** Spoken value, e.g. "45 %". */
  valueText?: string;
}

/** Material 3 Expressive slider: a thick track with a gap around a thin handle. */
export function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  label,
  valueText,
}: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      className={styles.slider}
      style={{ ["--pct" as string]: `${pct}%` }}
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      aria-valuetext={valueText}
      onChange={(e) => {
        onChange(Number(e.target.value));
      }}
    />
  );
}

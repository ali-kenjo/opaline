// Built-in visuals for the `canvas` block (docs/COMPOSITION.md §3): things a tree of blocks
// can't express. Each takes its evaluated params.
import type { ReactNode } from "react";
import type { Value } from "../../expr";
import styles from "./visuals.module.css";

export interface VisualProps {
  params: Readonly<Record<string, Value>>;
  label: string | undefined;
}

const str = (v: Value | undefined) => (typeof v === "string" ? v : undefined);

/** Hour, minute and second of `ms` in a zone (`undefined` = the system's). */
function clockParts(ms: number, zone: string | undefined) {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hourCycle: "h23",
    }).formatToParts(ms);
  } catch {
    parts = new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hourCycle: "h23",
    }).formatToParts(ms);
  }
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { h: get("hour"), m: get("minute"), s: get("second") };
}

function AnalogClock({ params, label }: VisualProps) {
  // The time comes from the composition (`now()`), so the runtime schedules the redraws.
  const ms = params.ms;
  if (typeof ms !== "number") return null;
  const seconds = params.seconds === true;
  const { h, m, s } = clockParts(ms, str(params.zone));
  const hand = (deg: number, len: number, w: number, cls: string | undefined) => (
    <line
      x1="50"
      y1="50"
      x2={50 + len * Math.sin((deg * Math.PI) / 180)}
      y2={50 - len * Math.cos((deg * Math.PI) / 180)}
      strokeWidth={w}
      strokeLinecap="round"
      className={cls}
    />
  );
  return (
    <svg viewBox="0 0 100 100" className={styles.analog} role="img" aria-label={label}>
      <circle cx="50" cy="50" r="47" className={styles.face} />
      {Array.from({ length: 12 }, (_, i) => (
        <circle
          key={i}
          cx={50 + 40 * Math.sin((i * Math.PI) / 6)}
          cy={50 - 40 * Math.cos((i * Math.PI) / 6)}
          r={i % 3 === 0 ? 2.2 : 1.2}
          className={styles.tick}
        />
      ))}
      {hand(((h % 12) + m / 60) * 30, 24, 5, styles.hourHand)}
      {hand((m + s / 60) * 6, 34, 3.5, styles.minuteHand)}
      {seconds ? hand(s * 6, 38, 1.5, styles.secondHand) : null}
      <circle cx="50" cy="50" r="3" className={styles.pin} />
    </svg>
  );
}

export const VISUALS: Readonly<Record<string, (p: VisualProps) => ReactNode>> = {
  "analog-clock": AnalogClock,
};

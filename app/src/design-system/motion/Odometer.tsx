// Numbers that roll like an odometer (docs/DESIGN.md §6): each digit is a vertical strip
// 0–9 moved by its own spatial spring; other characters stay put. Tabular figures keep the
// width steady. Screen readers get the plain text.
import { useLayoutEffect, useRef } from "react";
import { type Animator, reducedMotion, scheduler } from "./scheduler";
import { Spring } from "./spring";
import styles from "./Odometer.module.css";

const DIGITS = "0123456789".split("");

class Column implements Animator {
  readonly spring = new Spring(0, "spatialFast");

  constructor(private readonly strip: HTMLElement) {}

  step(dt: number): boolean {
    const moving = this.spring.step(dt);
    this.strip.style.transform = `translateY(${-this.spring.value}em)`;
    return moving;
  }
}

export interface OdometerProps {
  /** The formatted text, e.g. "42.5 °C"; digits roll, the rest is static. */
  text: string;
  className?: string;
}

export function Odometer({ text, className }: OdometerProps) {
  const root = useRef<HTMLSpanElement>(null);
  const columns = useRef(new Map<number, Column>());

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    el.querySelectorAll<HTMLElement>("[data-digit]").forEach((strip) => {
      // Columns are keyed from the right, so "9" → "10" rolls the ones and adds a ten.
      const key = Number(strip.dataset.pos);
      const digit = Number(strip.dataset.digit);
      let col = columns.current.get(key);
      if (!col) {
        col = new Column(strip);
        col.spring.snap(digit);
        columns.current.set(key, col);
      }
      if (reducedMotion()) col.spring.snap(digit);
      else col.spring.setTarget(digit);
      col.step(0);
      scheduler.add(col);
    });
  }, [text]);

  const chars = text.split("");
  return (
    <span
      ref={root}
      className={`${styles.odometer} ${className ?? ""}`}
      aria-label={text}
      role="text"
    >
      {chars.map((ch, i) => {
        const pos = chars.length - i;
        return /\d/.test(ch) ? (
          <span key={`d${pos}`} className={styles.window} aria-hidden="true">
            <span className={styles.strip} data-digit={ch} data-pos={pos}>
              {DIGITS.map((d) => (
                <span key={d}>{d}</span>
              ))}
            </span>
          </span>
        ) : (
          <span key={`c${pos}`} aria-hidden="true">
            {ch}
          </span>
        );
      })}
    </span>
  );
}

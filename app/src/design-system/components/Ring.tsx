// A progress ring whose arc moves on a spatial spring (docs/DESIGN.md §6).
import { useLayoutEffect, useRef } from "react";
import { type Animator, reducedMotion, scheduler } from "../motion/scheduler";
import { Spring } from "../motion/spring";
import type { SpringToken } from "../tokens/tokens";
import styles from "./data.module.css";

export interface RingProps {
  /** 0 … 1 */
  value: number;
  size?: number;
  thickness?: number;
  /** CSS color of the arc (a ramp color for load/thermal). */
  color?: string;
  label: string;
  /** Jump to the value without animating (the widget's animations are off). */
  instant?: boolean;
  spring?: SpringToken;
}

export function Ring({
  value,
  size = 72,
  thickness = 8,
  color = "rgb(var(--md-primary))",
  label,
  instant = false,
  spring: token = "spatialDefault",
}: RingProps) {
  const arc = useRef<SVGCircleElement>(null);
  const anim = useRef<(Animator & { spring: Spring }) | null>(null);
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;

  useLayoutEffect(() => {
    const el = arc.current;
    if (!el) return;
    if (!anim.current) {
      const spring = new Spring(value, token);
      anim.current = {
        spring,
        step(dt: number) {
          const moving = spring.step(dt);
          el.style.strokeDashoffset = String(
            circumference * (1 - Math.min(1, Math.max(0, spring.value))),
          );
          return moving;
        },
      };
    }
    const a = anim.current;
    if (instant || reducedMotion()) a.spring.snap(value);
    else a.spring.setTarget(value);
    a.step(0);
    scheduler.add(a);
  }, [value, circumference, instant, token]);

  return (
    <svg className={styles.ring} width={size} height={size} role="img" aria-label={label}>
      <circle
        className={styles.track}
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={thickness}
      />
      <circle
        ref={arc}
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={thickness}
        strokeLinecap="round"
        strokeDasharray={circumference}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

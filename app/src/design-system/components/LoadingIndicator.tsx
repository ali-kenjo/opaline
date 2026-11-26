// The Material 3 Expressive loading indicator: morphs through its shape sequence while turning
// (docs/DESIGN.md §2). Reduced motion shows the first shape, gently pulsing in opacity.
import { useEffect, useMemo, useRef } from "react";
import { type Animator, reducedMotion, scheduler } from "../motion/scheduler";
import { Spring } from "../motion/spring";
import { LOADING_SEQUENCE, Morph, cubicsToPath, materialShape } from "../shapes";
import styles from "./data.module.css";

const HOLD = 0.65;

export function LoadingIndicator({
  size = 48,
  label = "Loading",
}: {
  size?: number;
  label?: string;
}) {
  const path = useRef<SVGPathElement>(null);
  const morphs = useMemo(
    () =>
      LOADING_SEQUENCE.map(
        (name, i) =>
          new Morph(
            materialShape(name),
            materialShape(LOADING_SEQUENCE[(i + 1) % LOADING_SEQUENCE.length] ?? name),
          ),
      ),
    [],
  );

  useEffect(() => {
    const el = path.current;
    if (!el) return;
    if (reducedMotion()) {
      el.setAttribute("d", cubicsToPath(materialShape(LOADING_SEQUENCE[0] ?? "oval").cubics, size));
      return;
    }
    let index = 0;
    let wait = 0;
    let rotation = 0;
    const spring = new Spring(0, "spatialFast");
    let alive = true;
    const animator: Animator = {
      ambient: true,
      step(dt) {
        const morph = morphs[index];
        if (!morph) return false;
        if (spring.atRest && spring.target === 1) {
          wait += dt;
          if (wait >= HOLD) {
            wait = 0;
            index = (index + 1) % morphs.length;
            spring.snap(0);
            spring.setTarget(1);
          }
        } else spring.step(dt);
        rotation = (rotation + dt * 140) % 360;
        el.setAttribute("d", cubicsToPath((morphs[index] ?? morph).asCubics(spring.value), size));
        el.setAttribute("transform", `rotate(${rotation.toFixed(1)} ${size / 2} ${size / 2})`);
        return alive;
      },
    };
    spring.setTarget(1);
    scheduler.add(animator);
    return () => {
      alive = false;
    };
  }, [morphs, size]);

  return (
    <svg
      className={styles.loading}
      width={size}
      height={size}
      role="progressbar"
      aria-label={label}
      aria-busy="true"
    >
      <path ref={path} fill="rgb(var(--md-primary))" />
    </svg>
  );
}

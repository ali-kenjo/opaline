// A bottom sheet (the widget picker, settings sheets): slides in on a spatial spring, closes
// with Esc or the scrim. Focus moves into the sheet when it opens.
import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import { type Animator, reducedMotion, scheduler } from "../motion/scheduler";
import { Spring } from "../motion/spring";
import styles from "./overlays.module.css";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
}

export function Sheet({ open, onClose, label, children }: SheetProps) {
  const el = useRef<HTMLDivElement>(null);
  const spring = useRef(new Spring(1, "spatialDefault"));

  useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    const s = spring.current;
    const animator: Animator = {
      step(dt) {
        const moving = s.step(dt);
        node.style.transform = `translateY(${(s.value * 105).toFixed(2)}%)`;
        // Fully closed: out of the layout and the accessibility tree.
        node.style.visibility = !moving && s.value > 0.99 ? "hidden" : "visible";
        return moving;
      },
    };
    if (reducedMotion()) s.snap(open ? 0 : 1);
    else s.setTarget(open ? 0 : 1);
    animator.step(0);
    scheduler.add(animator);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    el.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <div
      ref={el}
      className={styles.sheet}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      aria-hidden={!open}
      tabIndex={-1}
    >
      <div className={styles.handle} />
      {children}
    </div>
  );
}

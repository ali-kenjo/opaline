// Animates a grid item's `(x, y)` position on M3 Expressive spatial springs (`spatialDefault`)
// outside React, driven by the shared rAF scheduler, notifying the glass stage on every tick so
// glass and DOM move together without drifting (brief §4.4, PLAN 5.4).
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { type Animator, reducedMotion, scheduler } from "../design-system/motion/scheduler";
import { Spring } from "../design-system/motion/spring";

export interface SpringSlotProps {
  x: number;
  y: number;
  /** When true (actively dragged), snap immediately to `(x, y)` with scale 1.04. */
  dragging: boolean;
  zIndex?: number | undefined;
  className?: string;
  children: ReactNode;
  onTick?: () => void;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  tabIndex?: number | undefined;
  ariaLabel?: string | undefined;
  dataItemId?: string | undefined;
  dir?: "ltr" | "rtl";
}

export function SpringSlot({
  x,
  y,
  dragging,
  zIndex,
  className,
  children,
  onTick,
  onPointerDown,
  onPointerEnter,
  onPointerLeave,
  onContextMenu,
  onClick,
  tabIndex,
  ariaLabel,
  dataItemId,
  dir,
}: SpringSlotProps) {
  const el = useRef<HTMLDivElement>(null);
  const springsRef = useRef<{ sx: Spring; sy: Spring; initialized: boolean } | null>(null);
  const tickRef = useRef(onTick);

  useLayoutEffect(() => {
    tickRef.current = onTick;
  }, [onTick]);

  useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    springsRef.current ??= {
      sx: new Spring(x, "spatialDefault"),
      sy: new Spring(y, "spatialDefault"),
      initialized: false,
    };
    const st = springsRef.current;
    const apply = (px: number, py: number) => {
      node.style.transform = dragging
        ? `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) scale(1.04)`
        : `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0)`;
    };
    if (!st.initialized || dragging || reducedMotion()) {
      st.initialized = true;
      st.sx.snap(x);
      st.sy.snap(y);
      apply(x, y);
      tickRef.current?.();
      return;
    }
    st.sx.setTarget(x);
    st.sy.setTarget(y);
    const anim: Animator = {
      step(dt) {
        const mx = st.sx.step(dt);
        const my = st.sy.step(dt);
        apply(st.sx.value, st.sy.value);
        tickRef.current?.();
        return mx || my;
      },
    };
    scheduler.add(anim);
    return () => {
      scheduler.remove(anim);
    };
  }, [x, y, dragging]);

  return (
    <div
      ref={el}
      className={className}
      style={{ left: 0, top: 0, zIndex: dragging ? 20 : zIndex }}
      tabIndex={tabIndex}
      aria-label={ariaLabel}
      data-item-id={dataItemId}
      dir={dir}
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onContextMenu={onContextMenu}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

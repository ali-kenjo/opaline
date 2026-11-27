// What a drag/selection shows besides the lifted widget: landing ghost (Grid or Free),
// Free-mode smart alignment guides, rubber-band marquee, remove zone at top center, and
// cross-monitor edge handoff glow (split out of LayerApp.tsx).
import { Icon } from "../design-system/icons";
import { type Locale, t } from "../i18n";
import type { DragState, MarqueeState, ResizeState } from "./editTypes";
import { type GridMetrics, cellToPx } from "./grid";
import styles from "./LayerApp.module.css";

export interface DragFeedbackProps {
  part: "ghost" | "zones";
  drag: DragState | null;
  resize: ResizeState | null;
  marquee?: MarqueeState | null;
  g: GridMetrics;
  locale: Locale;
  dir: "ltr" | "rtl";
}

const EDGE_CLASS = {
  left: styles.edgeLeft,
  right: styles.edgeRight,
  top: styles.edgeTop,
  bottom: styles.edgeBottom,
} as const;

export function DragFeedback({ part, drag, resize, marquee, g, locale, dir }: DragFeedbackProps) {
  if (part === "ghost") {
    const guides = drag?.guides ?? resize?.guides ?? [];
    const rect = drag
      ? drag.stackTarget
        ? cellToPx(
            g,
            drag.stackTarget.x,
            drag.stackTarget.y,
            drag.stackTarget.w,
            drag.stackTarget.h,
          )
        : !drag.overRemove
          ? drag.mode === "free" && drag.freeRect
            ? drag.freeRect
            : cellToPx(g, drag.landing.x, drag.landing.y, drag.landing.w, drag.landing.h)
          : null
      : resize
        ? resize.mode === "free" && resize.freeRect
          ? resize.freeRect
          : cellToPx(g, resize.current.x, resize.current.y, resize.current.w, resize.current.h)
        : null;

    return (
      <>
        {rect ? (
          <div
            className={`${styles.ghost} ${drag?.stackTarget ? styles.ghostStack : ""}`}
            style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
          >
            {drag?.stackTarget ? "Drop to stack" : null}
          </div>
        ) : null}
        {guides.map((line, i) =>
          line.axis === "x" ? (
            <div
              key={`gx-${String(i)}`}
              data-guide="x"
              className={`${styles.guideX} ${line.kind === "center" ? styles.guideCenter : ""}`}
              style={{ left: line.pos, top: line.from, height: Math.max(1, line.to - line.from) }}
            />
          ) : (
            <div
              key={`gy-${String(i)}`}
              data-guide="y"
              className={`${styles.guideY} ${line.kind === "center" ? styles.guideCenter : ""}`}
              style={{ top: line.pos, left: line.from, width: Math.max(1, line.to - line.from) }}
            />
          ),
        )}
        {marquee ? (
          <div
            data-testid="edit-marquee"
            className={styles.marquee}
            style={{
              left: Math.min(marquee.startX, marquee.currentX),
              top: Math.min(marquee.startY, marquee.currentY),
              width: Math.abs(marquee.currentX - marquee.startX),
              height: Math.abs(marquee.currentY - marquee.startY),
            }}
          />
        ) : null}
      </>
    );
  }
  if (!drag) return null;
  return (
    <>
      {!drag.fromPicker ? (
        <div
          dir={dir}
          className={`${styles.removeZone} ${drag.overRemove ? styles.removeZoneHot : ""}`}
        >
          <Icon name="delete" size={18} />
          <span>
            {drag.overRemove ? t(locale, "edit.releaseToRemove") : t(locale, "edit.dropToRemove")}
          </span>
        </div>
      ) : null}
      {drag.edge && drag.edgeTarget ? (
        <div className={`${styles.edgeGlow} ${EDGE_CLASS[drag.edge]}`}>
          {drag.edgeTarget.connector}
        </div>
      ) : null}
    </>
  );
}

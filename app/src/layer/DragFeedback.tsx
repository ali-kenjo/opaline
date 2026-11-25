// What a drag shows besides the lifted widget: the landing ghost (or "Drop to stack"), the
// remove zone at the top, and the glow at a monitor edge that hands the widget to the next
// monitor (split out of LayerApp.tsx). The ghost sits below the widgets, the zones above them.
import { Icon } from "../design-system/icons";
import { type Locale, t } from "../i18n";
import type { DragState, ResizeState } from "./editTypes";
import { type GridMetrics, cellToPx } from "./grid";
import styles from "./LayerApp.module.css";

export interface DragFeedbackProps {
  part: "ghost" | "zones";
  drag: DragState | null;
  resize: ResizeState | null;
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

export function DragFeedback({ part, drag, resize, g, locale, dir }: DragFeedbackProps) {
  if (part === "ghost") {
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
          ? cellToPx(g, drag.landing.x, drag.landing.y, drag.landing.w, drag.landing.h)
          : null
      : resize
        ? cellToPx(g, resize.current.x, resize.current.y, resize.current.w, resize.current.h)
        : null;
    if (!rect) return null;
    return (
      <div
        className={`${styles.ghost} ${drag?.stackTarget ? styles.ghostStack : ""}`}
        style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      >
        {drag?.stackTarget ? "Drop to stack" : null}
      </div>
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

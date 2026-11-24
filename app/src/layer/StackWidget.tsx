// Widget stack (brief §2.2, PLAN 5.5): renders one child widget at a time with wheel/swipe
// flipping, dots indicator, optional Smart Rotate, and a stack editor bottom sheet.
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Sheet, Switch } from "../design-system/components";
import { Icon } from "../design-system/icons";
import type { SizeClass } from "../design-system/tokens/tokens";
import { useHost } from "../widgets/host";
import { toJson } from "../widgets/json";
import { widgetByKind } from "../widgets/registry";
import { WidgetFrame } from "../widgets/WidgetFrame";
import type { StackLayoutItem } from "./grid";
import { useLayer } from "./store";
import styles from "./StackWidget.module.css";

/** Picks the highest-priority child index when Smart Rotate is on. */
function smartRotateIndex(
  children: readonly string[],
  widgets: Readonly<Record<string, { kind: string }>>,
  values: Readonly<Record<string, import("./protocol").Value>>,
): number | null {
  // 1. Battery <= 20% and discharging.
  const battPct = toJson(values["battery.percent"]);
  const battState = toJson(values["battery.state"]);
  if (typeof battPct === "number" && battPct <= 20 && battState === "discharging") {
    const idx = children.findIndex((id) => widgets[id]?.kind === "battery");
    if (idx >= 0) return idx;
  }
  // 2. Storage drive >= 90% full.
  const drives = toJson(values["storage.drives"]);
  if (Array.isArray(drives)) {
    const nearlyFull = drives.some((d) => {
      if (typeof d !== "object" || d === null || Array.isArray(d)) return false;
      const used = Number(d.usedBytes);
      const total = Number(d.totalBytes);
      return total > 0 && used / total >= 0.9;
    });
    if (nearlyFull) {
      const idx = children.findIndex((id) => widgets[id]?.kind === "storage");
      if (idx >= 0) return idx;
    }
  }
  // 3. Now Playing active.
  const players = toJson(values["media.players"]);
  if (Array.isArray(players)) {
    const playing = players.some(
      (p) => typeof p === "object" && p !== null && !Array.isArray(p) && p.status === "Playing",
    );
    if (playing) {
      const idx = children.findIndex((id) => widgets[id]?.kind === "media");
      if (idx >= 0) return idx;
    }
  }
  return null;
}

export interface StackWidgetProps {
  item: StackLayoutItem;
  size: SizeClass;
  autoDimmed: boolean;
  lifted?: boolean;
  editMode: boolean;
  onActiveChange: (index: number) => void;
  onOpenSettings: (widgetId: string) => void;
}

export function StackWidget({
  item,
  size,
  autoDimmed,
  lifted = false,
  editMode,
  onActiveChange,
  onOpenSettings,
}: StackWidgetProps) {
  const host = useHost();
  const values = useLayer((s) => s.values);
  const [manualUntil, setManualUntil] = useState(0);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const lastWheel = useRef(0);

  const count = item.children.length;
  const smart = useMemo(
    () =>
      item.smartRotate ? smartRotateIndex(item.children, host.settings.widgets, values) : null,
    [item.smartRotate, item.children, host.settings.widgets, values],
  );
  const baseIdx = Math.max(0, Math.min(count - 1, item.activeIndex ?? 0));
  const [nowTs, setNowTs] = useState(0);
  useEffect(() => {
    if (manualUntil <= 0) return;
    const wait = Math.max(0, manualUntil - Date.now());
    const t = setTimeout(() => {
      setNowTs(Date.now());
    }, wait + 20);
    return () => {
      clearTimeout(t);
    };
  }, [manualUntil]);

  const activeIndex = smart !== null && nowTs >= manualUntil ? smart : baseIdx;
  const activeId = item.children[activeIndex] ?? item.children[0];
  const stored = activeId ? host.settings.widgets[activeId] : undefined;
  const def = stored ? widgetByKind(stored.kind) : undefined;

  const step = (delta: number) => {
    if (count <= 1) return;
    const next = (activeIndex + delta + count) % count;
    setManualUntil(Date.now() + 30_000);
    onActiveChange(next);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (editMode || count <= 1) return;
    const now = performance.now();
    if (now - lastWheel.current < 180) return;
    if (Math.abs(e.deltaY) < 6 && Math.abs(e.deltaX) < 6) return;
    lastWheel.current = now;
    e.stopPropagation();
    step((e.deltaY || e.deltaX) > 0 ? 1 : -1);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (editMode || count <= 1) return;
    swipeStart.current = { x: e.clientX, y: e.clientY };
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!swipeStart.current || editMode || count <= 1) return;
    const dx = e.clientX - swipeStart.current.x;
    const dy = e.clientY - swipeStart.current.y;
    swipeStart.current = null;
    if (Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      step(dx < 0 ? 1 : -1);
    }
  };

  if (!activeId || !def) return null;

  return (
    <div
      className={styles.stack}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      <WidgetFrame
        id={activeId}
        def={def}
        size={size}
        autoDimmed={autoDimmed}
        lifted={lifted}
        onOpenSettings={() => {
          onOpenSettings(activeId);
        }}
      />
      {count > 1 ? (
        <div className={styles.dots} role="tablist" aria-label="Stack pages">
          {item.children.map((cid, i) => (
            <button
              key={cid}
              type="button"
              role="tab"
              aria-selected={i === activeIndex}
              aria-label={`Widget ${String(i + 1)} of ${String(count)}`}
              className={`${styles.dot} ${i === activeIndex ? styles.dotActive : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                setManualUntil(Date.now() + 30_000);
                onActiveChange(i);
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export interface StackEditorProps {
  stack: StackLayoutItem;
  open: boolean;
  onClose: () => void;
  onReorder: (children: string[]) => void;
  onRemoveChild: (childId: string) => void;
  onUnstackChild: (childId: string) => void;
  onToggleSmartRotate: (enabled: boolean) => void;
  onOpenWidgetSettings: (childId: string) => void;
}

export function StackEditor({
  stack,
  open,
  onClose,
  onReorder,
  onRemoveChild,
  onUnstackChild,
  onToggleSmartRotate,
  onOpenWidgetSettings,
}: StackEditorProps) {
  const host = useHost();

  const move = (index: number, delta: number) => {
    const next = [...stack.children];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [entry] = next.splice(index, 1);
    if (entry) next.splice(target, 0, entry);
    onReorder(next);
  };

  return (
    <Sheet open={open} onClose={onClose} label="Edit widget stack">
      <div className={styles.editor}>
        <div className={styles.editorHeader}>
          <div className={styles.editorTitle}>
            <Icon name="stacks" size={20} />
            <span>Widget stack ({stack.children.length})</span>
          </div>
          <Button variant="text" onClick={onClose}>
            Done
          </Button>
        </div>

        <div className={styles.smartRow}>
          <div>
            <div className={styles.smartLabel}>Smart Rotate</div>
            <div className={styles.smartDesc}>
              Shows Now Playing during playback, Battery when low, or Storage when nearly full.
            </div>
          </div>
          <Switch
            checked={Boolean(stack.smartRotate)}
            onChange={onToggleSmartRotate}
            label="Smart Rotate"
          />
        </div>

        <div className={styles.childList}>
          {stack.children.map((cid, idx) => {
            const w = host.settings.widgets[cid];
            const def = w ? widgetByKind(w.kind) : undefined;
            const title =
              typeof w?.content?.title === "string" && w.content.title.trim()
                ? w.content.title
                : (def?.name ?? cid);
            return (
              <div key={cid} className={styles.childRow}>
                {def ? <Icon name={def.icon} size={20} /> : null}
                <span className={styles.childName}>{title}</span>
                <div className={styles.childActions}>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    aria-label="Move up"
                    disabled={idx === 0}
                    onClick={() => {
                      move(idx, -1);
                    }}
                  >
                    <Icon name="keyboard_arrow_up" size={18} />
                  </button>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    aria-label="Move down"
                    disabled={idx === stack.children.length - 1}
                    onClick={() => {
                      move(idx, 1);
                    }}
                  >
                    <Icon name="keyboard_arrow_down" size={18} />
                  </button>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    aria-label="Widget settings"
                    onClick={() => {
                      onOpenWidgetSettings(cid);
                    }}
                  >
                    <Icon name="tune" size={18} />
                  </button>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    aria-label="Move out of stack"
                    title="Move out of stack"
                    onClick={() => {
                      onUnstackChild(cid);
                    }}
                  >
                    <Icon name="open_in_full" size={16} />
                  </button>
                  <button
                    type="button"
                    className={`${styles.iconBtn} ${styles.dangerBtn}`}
                    aria-label="Remove from stack"
                    onClick={() => {
                      onRemoveChild(cid);
                    }}
                  >
                    <Icon name="delete" size={18} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Sheet>
  );
}

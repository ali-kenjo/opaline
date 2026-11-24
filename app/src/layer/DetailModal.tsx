// Shared-element detail view (brief §2.7, PLAN 5.9): clicking a widget outside edit mode (or
// opening an alert notification) morphs it into an expanded glass panel up to 8×6 cells with
// 15 min / 24 h core history, all widget fields, actions, and settings access.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, Sparkline } from "../design-system/components";
import { Icon } from "../design-system/icons";
import { type Animator, reducedMotion, scheduler } from "../design-system/motion/scheduler";
import { Spring } from "../design-system/motion/spring";
import { spanPx } from "../design-system/tokens/tokens";
import { resolveContent } from "../widgets/content";
import { useHost } from "../widgets/host";
import { toJson } from "../widgets/json";
import type { FieldDef, ReadCtx, WidgetAction, WidgetDef } from "../widgets/types";
import type { PxRect } from "./grid";
import { useLayer } from "./store";
import styles from "./DetailModal.module.css";

export interface DetailModalProps {
  id: string;
  def: WidgetDef;
  origin: PxRect | null;
  viewportW: number;
  viewportH: number;
  onClose: () => void;
  onOpenSettings: () => void;
}

const RANGES = [
  { label: "15 min", seconds: 900 },
  { label: "24 hours", seconds: 86_400 },
] as const;

export function DetailModal({
  id,
  def,
  origin,
  viewportW,
  viewportH,
  onClose,
  onOpenSettings,
}: DetailModalProps) {
  const host = useHost();
  const values = useLayer((s) => s.values);
  const stored = host.settings.widgets[id];
  const content = useMemo(() => resolveContent(def, stored?.content), [def, stored?.content]);
  const [rangeSec, setRangeSec] = useState<number>(900);
  const [seriesValues, setSeriesValues] = useState<number[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  const targetW = Math.min(spanPx(8), Math.max(360, viewportW - 48));
  const targetH = Math.min(spanPx(6), Math.max(320, viewportH - 48));

  // Shared-element spring morph from the widget's card rectangle into the centered detail panel.
  useLayoutEffect(() => {
    const node = panelRef.current;
    if (!node) return;
    const dstX = (viewportW - targetW) / 2;
    const dstY = (viewportH - targetH) / 2;
    const startDx = origin ? origin.x + origin.width / 2 - (dstX + targetW / 2) : 0;
    const startDy = origin ? origin.y + origin.height / 2 - (dstY + targetH / 2) : 24;
    const startScale = origin ? Math.max(0.35, Math.min(0.95, origin.width / targetW)) : 0.92;
    if (reducedMotion()) {
      node.style.transform = "translate3d(0, 0, 0) scale(1)";
      node.style.opacity = "1";
      return;
    }
    const s = new Spring(0, "spatialDefault");
    s.setTarget(1);
    const anim: Animator = {
      step(dt) {
        const moving = s.step(dt);
        const t = s.value;
        const dx = startDx * (1 - t);
        const dy = startDy * (1 - t);
        const sc = startScale + (1 - startScale) * t;
        node.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0) scale(${sc.toFixed(4)})`;
        node.style.opacity = String(Math.min(1, Math.max(0, t * 1.4)));
        return moving;
      },
    };
    anim.step(0);
    scheduler.add(anim);
    return () => {
      scheduler.remove(anim);
    };
  }, [origin, targetW, targetH, viewportW, viewportH]);

  // Subscribe to all fields of this widget while the detail panel is open.
  const ctx: ReadCtx = useMemo(() => ({ get: (t) => values[t], content }), [values, content]);
  const allTopics = useMemo(() => {
    const set = new Set<string>(def.topics ?? []);
    for (const f of def.fields) {
      const ts = typeof f.topics === "function" ? f.topics(ctx) : f.topics;
      for (const t of ts) set.add(t);
    }
    for (const t of def.extraTopics?.(ctx) ?? []) set.add(t);
    return [...set].sort();
  }, [def, ctx]);

  useEffect(() => {
    host.subscribe(allTopics, "interactive");
  }, [host, allTopics]);

  const heroField: FieldDef | undefined =
    def.fields.find((f) => f.id === content.hero && f.series) ??
    def.fields.find((f) => Boolean(f.series));
  const series = heroField?.series ?? null;

  useEffect(() => {
    if (!series) return;
    let alive = true;
    const load = () => {
      void host.command({ cmd: "history", series, seconds: rangeSec }).then((res) => {
        if (!alive || res.result !== "data") return;
        const j = toJson(res.value);
        if (typeof j === "object" && j !== null && !Array.isArray(j) && Array.isArray(j.values)) {
          setSeriesValues(j.values.filter((n): n is number => typeof n === "number"));
        }
      });
    };
    load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [host, series, rangeSec]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const readings = useMemo(
    () =>
      def.fields.map((field) => {
        let reading;
        try {
          reading = field.read(ctx);
        } catch {
          reading = null;
        }
        return { field, label: content.label(field.id, field.label), reading };
      }),
    [def.fields, ctx, content],
  );

  const actions: readonly WidgetAction[] = useMemo(() => {
    try {
      return def.actions?.(ctx) ?? [];
    } catch {
      return [];
    }
  }, [def, ctx]);

  const stats = useMemo(() => {
    if (seriesValues.length === 0) return null;
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (const v of seriesValues) {
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }
    return { min, max, avg: sum / seriesValues.length };
  }, [seriesValues]);

  return (
    <div
      className={styles.scrim}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={`${content.title || def.name} details`}
        style={{ width: targetW, maxHeight: targetH }}
      >
        <div className={styles.header}>
          <div className={styles.title}>
            <Icon name={def.icon} size={22} />
            <span>{content.title || def.name}</span>
          </div>
          <div className={styles.headerActions}>
            <Button variant="tonal" icon="tune" onClick={onOpenSettings}>
              Customize
            </Button>
            <Button variant="text" icon="close" label="Close detail view" onClick={onClose} />
          </div>
        </div>

        {series ? (
          <div className={styles.chartCard}>
            <div className={styles.chartTop}>
              <div className={styles.chartLabel}>
                <Icon name="show_chart" size={16} />
                <span>{heroField?.label ?? "History"}</span>
              </div>
              <div className={styles.ranges}>
                {RANGES.map((r) => (
                  <button
                    key={r.seconds}
                    type="button"
                    className={`${styles.rangeBtn} ${rangeSec === r.seconds ? styles.rangeActive : ""}`}
                    onClick={() => {
                      setRangeSec(r.seconds);
                    }}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            {seriesValues.length >= 2 ? (
              <div className={styles.chartWrap}>
                <Sparkline
                  values={seriesValues}
                  color="rgb(var(--md-primary))"
                  height={110}
                  label={`${heroField?.label ?? "History"} chart`}
                />
              </div>
            ) : (
              <div className={styles.chartEmpty}>Collecting history…</div>
            )}
            {stats ? (
              <div className={styles.chartStats}>
                <span>Min {stats.min.toFixed(1)}</span>
                <span>Avg {stats.avg.toFixed(1)}</span>
                <span>Max {stats.max.toFixed(1)}</span>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className={styles.fields}>
          {readings.map(({ field, label, reading }) => (
            <div key={field.id} className={styles.field}>
              <div className={styles.fieldLabel}>
                {field.icon ? <Icon name={field.icon} size={16} /> : null}
                <span>{label}</span>
              </div>
              <div className={styles.fieldValue}>{reading?.text ?? "—"}</div>
              {reading?.sub ? <div className={styles.fieldSub}>{reading.sub}</div> : null}
            </div>
          ))}
        </div>

        {actions.length > 0 ? (
          <div className={styles.actions}>
            {actions.map((a) => (
              <Button
                key={a.id}
                variant={a.active ? "filled" : "tonal"}
                icon={a.icon}
                onClick={() => {
                  void host.command(a.command);
                }}
              >
                {a.label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

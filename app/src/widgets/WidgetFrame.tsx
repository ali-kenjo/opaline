// One placed widget: resolves its style (default → global → own) and content, subscribes to the
// topics of the fields it shows, works out its state, and draws the card with the standard
// hero + rows layout or the widget's own.
import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { makeRamp } from "../design-system/color/ramps";
import { triple } from "../design-system/color/scheme";
import { Glass } from "../design-system/glass";
import { Icon } from "../design-system/icons";
import { LoadingIndicator } from "../design-system/components/LoadingIndicator";
import {
  type ResolvedStyle,
  glassOptions,
  isDark,
  radiusFor,
  resolveStyle,
  rolesFor,
  sanitizeStyle,
  sourceColor,
  styleVariables,
} from "../design-system/style";
import { type SizeClass, sizes, spanPx } from "../design-system/tokens/tokens";
import type { ActivityClass, Value } from "../layer/protocol";
import { type ResolvedContent, resolveContent } from "./content";
import { useHost } from "./host";
import { StatLayout } from "./StatLayout";
import type { CardStatus, FieldDef, ReadCtx, Reading, RenderCtx, WidgetDef } from "./types";
import styles from "./WidgetFrame.module.css";

export interface WidgetFrameProps {
  id: string;
  def: WidgetDef;
  size: SizeClass;
  /** The layer's Automatic appearance currently dims widgets (Phase 4 drives this). */
  autoDimmed?: boolean;
  lifted?: boolean;
  onOpenSettings?: () => void;
}

const RELAXED_MS = 5000;
const MAX_HISTORY = 1800;

const reasonIcon = { unavailable: "block", asleep: "bedtime", "needs-permission": "lock" } as const;

function activityFor(content: ResolvedContent, def: WidgetDef): ActivityClass {
  return content.updateRate === "fast" ? "interactive" : (def.activity ?? "ambient");
}

/** In Relaxed mode, take new values at most every 5 s. */
function useRelaxed<T>(value: T, relaxed: boolean): T {
  const [held, setHeld] = useState(value);
  const last = useRef(0);
  useEffect(() => {
    if (!relaxed) return;
    const wait = Math.max(0, last.current + RELAXED_MS - Date.now());
    const t = setTimeout(() => {
      last.current = Date.now();
      setHeld(value);
    }, wait);
    return () => {
      clearTimeout(t);
    };
  }, [value, relaxed]);
  return relaxed ? held : value;
}

class HeroHistory {
  private hero = "";
  private values: number[] = [];

  push(hero: string, value: number): void {
    if (hero !== this.hero) {
      this.hero = hero;
      this.values = [];
    }
    this.values.push(value);
    if (this.values.length > MAX_HISTORY) this.values.splice(0, this.values.length - MAX_HISTORY);
  }

  of(hero: string): readonly number[] {
    return hero === this.hero ? this.values : [];
  }
}

function safeRead(field: FieldDef, ctx: ReadCtx): Reading | null {
  try {
    return field.read(ctx);
  } catch {
    // A broken reading must never take the card down; it shows "—".
    return null;
  }
}

/** Hero color: by value (ramp), accent, or the user's color; thresholds override. */
export function heroColor(
  style: ResolvedStyle,
  reading: Reading | null,
  source: number,
  dark: boolean,
  level: "ok" | "warn" | "crit",
): string {
  if (level === "crit") return "rgb(var(--md-error))";
  if (level === "warn") return "rgb(var(--md-tertiary))";
  if (style.heroColor === "custom" && style.heroCustomColor) return "rgb(var(--w-hero))";
  if (style.heroColor === "accent" || !reading?.ramp || reading.ratio === undefined)
    return "rgb(var(--md-primary))";
  return `rgb(${triple(makeRamp(reading.ramp, source, dark).at(reading.ratio))})`;
}

export function WidgetFrame({
  id,
  def,
  size,
  autoDimmed = false,
  lifted = false,
  onOpenSettings,
}: WidgetFrameProps) {
  const host = useHost();
  const stored = host.settings.widgets[id];
  const { style } = useMemo(
    () => resolveStyle(sanitizeStyle(host.settings.style), sanitizeStyle(stored?.style)),
    [host.settings.style, stored?.style],
  );
  const content = useMemo(() => resolveContent(def, stored?.content), [def, stored?.content]);
  const roles = rolesFor(style, host.colors);
  const vars = useMemo(() => styleVariables(style, roles, size), [style, roles, size]);
  const glass = useMemo(() => glassOptions(style, roles), [style, roles]);

  const shown = useMemo(
    () =>
      content.fields
        .map((fid) => def.fields.find((f) => f.id === fid))
        .filter((f): f is FieldDef => f !== undefined),
    [content.fields, def.fields],
  );
  const topics = useMemo(
    () => [...new Set([...(def.topics ?? []), ...shown.flatMap((f) => f.topics)])].sort(),
    [def.topics, shown],
  );
  const activity = activityFor(content, def);
  useEffect(() => {
    host.subscribe(topics, activity);
  }, [host, topics, activity]);

  const live = host.useValues(
    useShallow((all: Readonly<Record<string, Value>>) => {
      const out: Record<string, Value | undefined> = {};
      for (const t of topics) out[t] = all[t];
      return out;
    }),
  );
  const values = useRelaxed(live, content.updateRate === "relaxed");

  const ctx: ReadCtx = useMemo(
    () => ({ get: (t: string) => values[t], content }),
    [values, content],
  );
  const status: CardStatus = def.status(ctx);
  const readings = useMemo(
    () =>
      shown.map((field) => {
        return {
          field,
          label: content.label(field.id, field.label),
          reading: safeRead(field, ctx),
        };
      }),
    [shown, ctx, content],
  );

  // Hero history for the graph style, kept per frame and appended after each render.
  const [history] = useState(() => new HeroHistory());
  const heroReading = readings.find((r) => r.field.id === content.hero)?.reading ?? null;
  const heroValue = heroReading?.value;
  useEffect(() => {
    if (heroValue !== undefined) history.push(content.hero, heroValue);
  }, [history, heroValue, values, content.hero]);

  const levels = def.options?.some((o) => o.key === "levels" && o.kind === "thresholds")
    ? content.opt<readonly [number, number]>("levels")
    : null;
  const level: "ok" | "warn" | "crit" =
    levels && heroValue !== undefined
      ? heroValue >= levels[1]
        ? "crit"
        : heroValue >= levels[0]
          ? "warn"
          : "ok"
      : "ok";
  const color = heroColor(
    style,
    heroReading,
    sourceColor(style, host.colors),
    isDark(style, host.colors),
    level,
  );

  const dimmed =
    style.appearance === "dimmed" || (style.appearance === "automatic" && autoDimmed)
      ? style.dimLevel / 100
      : 0;
  const { w, h } = sizes[size];
  const radius = radiusFor(style, size);
  const render: RenderCtx = { ...ctx, size, style, readings };
  const title = content.showTitle && content.title.trim() !== "" ? content.title : null;

  const body =
    status.kind === "loading" ? (
      <div className={styles.reason}>
        <LoadingIndicator size={40} label={`${content.title}: loading`} />
      </div>
    ) : status.kind !== "ready" ? (
      <div className={styles.reason} role="status">
        <Icon name={reasonIcon[status.kind]} size={24} />
        <span>{status.reason}</span>
      </div>
    ) : def.render ? (
      def.render(render)
    ) : (
      <StatLayout
        ctx={render}
        heroColor={color}
        history={history.of(content.hero)}
        historyMinutes={content.historyMinutes}
      />
    );

  return (
    <Glass
      radius={radius}
      label={content.title || def.name}
      dimmed={dimmed}
      lifted={lifted ? 1 : 0}
      noHover={!style.hoverLift}
      {...glass}
      className={`${styles.frame} ${level === "crit" ? styles.alert : ""}`}
      style={{
        ...vars,
        width: spanPx(w),
        height: spanPx(h),
        padding: "var(--w-padding)",
        opacity: 1,
      }}
    >
      <div className={styles.inner} data-size={size}>
        {title && size !== "1x1" ? (
          <div className={styles.header}>
            <Icon name={def.icon} size={18} className={styles.icon} />
            <span className={styles.title}>{title}</span>
            {onOpenSettings ? (
              <button
                type="button"
                className={styles.settings}
                aria-label={`${content.title} settings`}
                onClick={onOpenSettings}
              >
                <Icon name="tune" size={18} />
              </button>
            ) : null}
          </div>
        ) : onOpenSettings ? (
          <button
            type="button"
            className={`${styles.settings} ${styles.floating}`}
            aria-label={`${content.title} settings`}
            onClick={onOpenSettings}
          >
            <Icon name="tune" size={16} />
          </button>
        ) : null}
        {body}
      </div>
    </Glass>
  );
}

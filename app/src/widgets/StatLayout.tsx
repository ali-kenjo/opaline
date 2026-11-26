// The standard layout for monitor widgets: the hero (ring, bar, graph or number) and the other
// fields as rows, arranged per size class. Every visible field, its order and its label come
// from the user's content settings.
import { Fit, Ring, Sparkline, useFitRows } from "../design-system/components";
import { Icon } from "../design-system/icons";
import { Odometer } from "../design-system/motion";
import { springFor } from "../design-system/style";
import type { SizeClass } from "../design-system/tokens/tokens";
import { useState } from "react";
import type { Command, CommandResult } from "../layer/protocol";
import type { RenderCtx, WidgetAction } from "./types";
import styles from "./WidgetFrame.module.css";

export interface StatLayoutProps {
  ctx: RenderCtx;
  heroColor: string;
  history: readonly number[];
  historyMinutes: number;
  actions?: readonly WidgetAction[];
  onAction?: (cmd: Command) => Promise<CommandResult>;
}

/**
 * The label forms a row may use, longest first: the label as shown, then the field's written
 * short label (only when the user hasn't renamed the field).
 */
function labelVariants(shown: string, original: string, short: string | undefined): string[] {
  return short && shown === original && short !== shown ? [shown, short] : [shown];
}

/** How many rows fit beside / under the hero per size class. */
const ROWS: Record<SizeClass, number> = { "1x1": 0, "2x1": 0, "4x1": 2, S: 3, M: 6, L: 10, XL: 16 };
const RING: Record<SizeClass, number> = {
  "1x1": 0,
  "2x1": 0,
  "4x1": 0,
  S: 64,
  M: 104,
  L: 152,
  XL: 180,
};
/** Points the graph keeps (≈ one per 2 s sample). */
const POINTS_PER_MINUTE = 30;

function Value({ text, animate }: { text: string; animate: boolean }) {
  return animate ? (
    <Odometer text={text} className={styles.number} />
  ) : (
    <span className={styles.number}>{text}</span>
  );
}

export function StatLayout({
  ctx,
  heroColor,
  history,
  historyMinutes,
  actions = [],
  onAction,
}: StatLayoutProps) {
  const { size, style, readings, content } = ctx;
  const rowsRef = useFitRows<HTMLDListElement>();
  const animate = style.animations && style.odometer;
  const hero = readings.find((r) => r.field.id === content.hero);
  const withActions = actions.length > 0 && ACTION_SIZES.has(size);
  const rest = readings
    .filter((r) => r !== hero)
    .slice(0, size === "M" && withActions ? 3 : ROWS[size]);
  const heroText = hero?.reading?.text ?? "—";
  const heroStyle = content.heroStyle;
  const ringSize = RING[size];
  const showRing = heroStyle === "ring" && ringSize > 0 && hero?.reading?.ratio !== undefined;
  const showBar = heroStyle === "bar" && size !== "1x1" && hero?.reading?.ratio !== undefined;
  const showGraph =
    heroStyle === "sparkline" && size !== "1x1" && size !== "2x1" && history.length > 1;
  const graph = history.slice(-historyMinutes * POINTS_PER_MINUTE);

  const heroBlock = (
    <div className={styles.hero}>
      {showRing ? (
        <div className={styles.ringWrap} style={{ width: ringSize, height: ringSize }}>
          <Ring
            value={hero.reading?.ratio ?? 0}
            size={ringSize}
            thickness={Math.max(6, Math.round(ringSize / 12))}
            color={heroColor}
            label={`${hero.label}: ${heroText}`}
            instant={!style.animations}
            spring={springFor(style)}
          />
          <div
            className={styles.ringValue}
            // Long values ("2,825 rpm") shrink to fit inside the ring.
            style={{
              fontSize: `calc(${String(Math.min(ringSize >= 140 ? 30 : 18, (ringSize * 1.5) / Math.max(4, heroText.length)))}px * var(--w-scale))`,
            }}
          >
            <Value text={heroText} animate={animate} />
          </div>
        </div>
      ) : (
        <div
          className={styles.heroValue}
          style={{ color: heroStyle === "number" ? undefined : heroColor }}
        >
          <Value text={heroText} animate={animate} />
        </div>
      )}
      {hero && !showRing ? (
        <Fit
          className={styles.heroLabel}
          label={hero.label}
          variants={labelVariants(hero.label, hero.field.label, hero.field.shortLabel)}
        />
      ) : null}
      {hero?.reading?.sub && size !== "1x1" && size !== "2x1" && !(showRing && size === "S") ? (
        <Fit className={styles.sub} label={hero.reading.sub} variants={[hero.reading.sub]} />
      ) : null}
      {showBar ? (
        <div className={styles.bar} role="presentation">
          <div
            className={styles.barFill}
            style={{
              width: `${String(Math.round((hero.reading?.ratio ?? 0) * 1000) / 10)}%`,
              background: heroColor,
              transition: style.animations ? undefined : "none",
            }}
          />
        </div>
      ) : null}
      {showGraph ? (
        <Sparkline
          values={graph}
          min={0}
          height={size === "S" || size === "4x1" ? 28 : 48}
          color={heroColor}
          label={`${hero?.label ?? ""} history`}
        />
      ) : null}
    </div>
  );

  return (
    <div className={styles.stat} data-size={size}>
      {heroBlock}
      <div className={styles.side}>
        {rest.length ? (
          <dl className={styles.rows} ref={rowsRef}>
            {rest.map((r) => {
              const icon = r.field.icon ? (
                <Icon name={r.field.icon} size={16} className={styles.icon} />
              ) : null;
              const words = labelVariants(r.label, r.field.label, r.field.shortLabel);
              return (
                <div key={r.field.id} className={styles.row} data-fit-row="">
                  <dt>
                    <Fit
                      label={r.label}
                      variants={[
                        ...(icon
                          ? [
                              <>
                                {icon}
                                {words[0]}
                              </>,
                            ]
                          : []),
                        ...words,
                      ]}
                    />
                  </dt>
                  <dd>{r.reading?.text ?? "—"}</dd>
                </div>
              );
            })}
          </dl>
        ) : null}
        {actions.length && onAction && ACTION_SIZES.has(size) ? (
          <ActionBar actions={actions} onAction={onAction} compact={size === "M"} />
        ) : null}
      </div>
    </div>
  );
}

const ACTION_SIZES = new Set<SizeClass>(["M", "L", "XL"]);

/** Card buttons; ones with `confirm` ask on the first click and act on the second. */
export function ActionBar({
  actions,
  onAction,
  compact = false,
}: {
  actions: readonly WidgetAction[];
  onAction: (cmd: Command) => Promise<CommandResult>;
  /** Icon-only buttons (M size), with the label as tooltip and accessible name. */
  compact?: boolean;
}) {
  const [asking, setAsking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={styles.actions}>
      {actions.map((a) => (
        <button
          key={a.id}
          type="button"
          // A click target on the desktop, not only in Peek and Edit (ADR 0015).
          data-interactive=""
          className={`${styles.action} ${a.active ? styles.actionOn : ""} ${asking === a.id ? styles.actionAsk : ""}`}
          aria-pressed={a.active}
          aria-label={compact ? a.label : undefined}
          title={compact ? a.label : undefined}
          onClick={() => {
            if (a.confirm && asking !== a.id) {
              setAsking(a.id);
              return;
            }
            setAsking(null);
            onAction(a.command)
              .then((r) => {
                setError(r.result === "err" ? r.reason : null);
              })
              .catch(() => {
                setError("failed");
              });
          }}
          onBlur={() => {
            if (asking === a.id) setAsking(null);
          }}
        >
          <Icon name={a.icon} size={16} />
          {asking === a.id ? (a.confirm ?? a.label) : compact ? null : a.label}
        </button>
      ))}
      {error ? (
        <span className={styles.actionError} role="status">
          {error}
        </span>
      ) : null}
    </div>
  );
}

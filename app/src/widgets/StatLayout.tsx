// The standard layout for monitor widgets: the hero (ring, bar, graph or number) and the other
// fields as rows, arranged per size class. Every visible field, its order and its label come
// from the user's content settings.
import { Ring, Sparkline } from "../design-system/components";
import { Icon } from "../design-system/icons";
import { Odometer } from "../design-system/motion";
import { springFor } from "../design-system/style";
import type { SizeClass } from "../design-system/tokens/tokens";
import type { RenderCtx } from "./types";
import styles from "./WidgetFrame.module.css";

export interface StatLayoutProps {
  ctx: RenderCtx;
  heroColor: string;
  history: readonly number[];
  historyMinutes: number;
}

/** How many rows fit beside / under the hero per size class. */
const ROWS: Record<SizeClass, number> = { "1x1": 0, "2x1": 0, "4x1": 2, S: 2, M: 4, L: 8, XL: 12 };
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

export function StatLayout({ ctx, heroColor, history, historyMinutes }: StatLayoutProps) {
  const { size, style, readings, content } = ctx;
  const animate = style.animations && style.odometer;
  const hero = readings.find((r) => r.field.id === content.hero);
  const rest = readings.filter((r) => r !== hero).slice(0, ROWS[size]);
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
          <div className={styles.ringValue}>
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
      {hero && !showRing ? <div className={styles.heroLabel}>{hero.label}</div> : null}
      {hero?.reading?.sub && size !== "1x1" && size !== "2x1" ? (
        <div className={styles.sub}>{hero.reading.sub}</div>
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
      {rest.length ? (
        <dl className={styles.rows}>
          {rest.map((r) => (
            <div key={r.field.id} className={styles.row}>
              <dt>
                {r.field.icon ? (
                  <Icon name={r.field.icon} size={16} className={styles.icon} />
                ) : null}
                {r.label}
              </dt>
              <dd>{r.reading?.text ?? "—"}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

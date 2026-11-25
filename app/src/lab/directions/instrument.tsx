// Direction C, "Instrument": smoked glass with a hairline edge, and the precision of a watch face
// or a car's cluster: dials with ticks, arc gauges, charts with real scales, extended numerals.
import { Icon } from "../../design-system/icons";
import { type KindColors, SNAPSHOT as D } from "./data";
import { ART_BACKGROUND, Card, type CardSize, arcPath, polar, smoothPath } from "./parts";
import styles from "./Directions.module.css";

const LOOK = {
  refraction: 0.7,
  rim: 1.4,
  shadow: 1.2,
  borderWidth: 1,
  borderColor: [1, 1, 1, 0.12] as const,
};
const ALPHA = 0.6;
const SMOKE = [14, 14, 18] as const;

export interface InstrumentColors {
  clock: KindColors;
  cpu: KindColors;
  sun: KindColors;
  sky: KindColors;
  media: KindColors;
}

function InstrumentCard({
  size,
  label,
  children,
}: {
  size: CardSize;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Card
      size={size}
      label={label}
      alpha={ALPHA}
      tint={SMOKE}
      look={LOOK}
      className={styles.instrument}
    >
      {children}
    </Card>
  );
}

export function Dial({
  size,
  accent,
  className,
}: {
  size: number;
  accent: string;
  className?: string | undefined;
}) {
  const c = D.clock;
  const r = size / 2;
  const ticks = Array.from({ length: 60 }, (_, i) => {
    const hour = i % 5 === 0;
    const [x0, y0] = polar(r, r, r - 4, i * 6);
    const [x1, y1] = polar(r, r, r - (hour ? 14 : 8), i * 6);
    return (
      <line
        key={i}
        x1={x0}
        y1={y0}
        x2={x1}
        y2={y1}
        strokeWidth={hour ? 2 : 1}
        opacity={hour ? 0.9 : 0.4}
      />
    );
  });
  const hand = (deg: number, len: number, width: number, color?: string) => {
    const [x, y] = polar(r, r, len, deg);
    const [bx, by] = polar(r, r, -len * 0.14, deg);
    return (
      <line
        x1={bx}
        y1={by}
        x2={x}
        y2={y}
        strokeWidth={width}
        strokeLinecap="round"
        stroke={color ?? "currentColor"}
      />
    );
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      role="img"
      aria-label="10:09"
      className={className ?? styles.dial}
    >
      <g stroke="currentColor">{ticks}</g>
      <rect
        x={r + r * 0.42}
        y={r - 9}
        width={24}
        height={18}
        rx={4}
        className={styles.dialWindow}
      />
      <text x={r + r * 0.42 + 12} y={r + 4.5} className={styles.dialDate}>
        23
      </text>
      {hand(c.angles.hour, r * 0.5, 5)}
      {hand(c.angles.minute, r * 0.78, 3)}
      {hand(c.angles.second, r * 0.86, 1.4, accent)}
      <circle cx={r} cy={r} r={4} fill={accent} />
    </svg>
  );
}

export function InstrumentClock({ size, colors }: { size: CardSize; colors: InstrumentColors }) {
  const c = D.clock;
  if (size === "S")
    return (
      <InstrumentCard size="S" label="Clock">
        <div className={styles.center}>
          <Dial size={152} accent={colors.clock.accent} />
        </div>
      </InstrumentCard>
    );
  return (
    <InstrumentCard size="M" label="Clock">
      <div style={{ position: "absolute", left: 14, top: 14 }}>
        <Dial size={152} accent={colors.clock.accent} />
      </div>
      <div className={styles.instSide} style={{ left: 186 }}>
        <span className={styles.instNum} style={{ fontSize: 50 }}>
          {c.hours}:{c.minutes}
        </span>
        <span className={styles.instSoft}>
          {c.weekday}, {c.date}
        </span>
        <div className={styles.instRule} />
        <div className={styles.instPair}>
          <span className={styles.instSoft}>{c.secondZone.city}</span>
          <span className={styles.instNum} style={{ fontSize: 18 }}>
            {c.secondZone.time}
          </span>
        </div>
      </div>
    </InstrumentCard>
  );
}

function Gauge({ size, value, accent }: { size: number; value: number; accent: string }) {
  const r = size / 2;
  const radius = r - 10;
  const from = -135;
  const to = from + (270 * value) / 100;
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const deg = from + i * 27;
    const [x0, y0] = polar(r, r, radius - 9, deg);
    const [x1, y1] = polar(r, r, radius - (i % 5 === 0 ? 17 : 13), deg);
    return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} strokeWidth={i % 5 === 0 ? 1.6 : 1} />;
  });
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      aria-hidden
      className={styles.gauge}
    >
      <path d={arcPath(r, r, radius, from, 135)} className={styles.gaugeTrack} />
      <path d={arcPath(r, r, radius, from, to)} stroke={accent} className={styles.gaugeValue} />
      <g stroke="currentColor" opacity={0.55}>
        {ticks}
      </g>
    </svg>
  );
}

export function InstrumentCpu({ size, colors }: { size: CardSize; colors: InstrumentColors }) {
  const c = D.cpu;
  const k = colors.cpu;
  const gauge = (s: number, font: number) => (
    <div className={styles.gaugeWrap} style={{ width: s, height: s }}>
      <Gauge size={s} value={c.load} accent={k.accent} />
      <div className={styles.gaugeCenter}>
        <span className={styles.instNum} style={{ fontSize: font }}>
          {c.load}
          <small>%</small>
        </span>
        <span className={styles.instSoft}>{c.temp} °C</span>
      </div>
    </div>
  );
  if (size === "S")
    return (
      <InstrumentCard size="S" label="Processor">
        <div className={styles.center}>{gauge(156, 40)}</div>
      </InstrumentCard>
    );
  const hist: readonly number[] = c.history;
  const max = Math.max(...hist);
  const maxAt = hist.indexOf(max);
  const chartW = 176;
  const chartH = 64;
  return (
    <InstrumentCard size="M" label="Processor">
      <div style={{ position: "absolute", left: 10, top: 12 }}>{gauge(156, 42)}</div>
      <div className={styles.instSide} style={{ left: 178, right: 18, gap: 8 }}>
        <svg
          width={chartW}
          height={chartH}
          viewBox={`0 0 ${String(chartW)} ${String(chartH)}`}
          aria-hidden
          className={styles.instChart}
        >
          <line
            x1="0"
            y1={chartH - 0.5}
            x2={chartW}
            y2={chartH - 0.5}
            className={styles.instAxis}
          />
          <path
            d={`${smoothPath(hist, chartW, chartH, 6)} L${String(chartW)} ${String(chartH)} L0 ${String(chartH)} Z`}
            fill={k.accent}
            opacity={0.18}
          />
          <path
            d={smoothPath(hist, chartW, chartH, 6)}
            stroke={k.accent}
            className={styles.instLine}
          />
          <circle cx={(maxAt / (hist.length - 1)) * chartW} cy={6} r={2.5} fill={k.accent} />
        </svg>
        <div className={styles.instPair}>
          <span className={styles.instSoft}>15 minutes, peak {max} %</span>
        </div>
        <div className={styles.instGrid}>
          <span className={styles.instSoft}>Temperature</span>
          <span className={styles.instNum}>{c.temp} °C</span>
          <span className={styles.instSoft}>Frequency</span>
          <span className={styles.instNum}>{c.freqGhz} GHz</span>
        </div>
      </div>
    </InstrumentCard>
  );
}

function SunArc({ width, accent }: { width: number; accent: string }) {
  const w = D.weather;
  const r = width / 2 - 6;
  const cx = width / 2;
  const cy = r + 6;
  const deg = -90 + 180 * w.dayProgress;
  const [sx, sy] = polar(cx, cy, r, deg);
  return (
    <svg
      width={width}
      height={cy + 2}
      viewBox={`0 0 ${String(width)} ${String(cy + 2)}`}
      aria-hidden
      className={styles.sunArc}
    >
      <path d={arcPath(cx, cy, r, -90, 90)} className={styles.sunTrack} />
      <path d={arcPath(cx, cy, r, -90, deg)} stroke={accent} className={styles.sunDone} />
      <line x1="0" y1={cy + 1} x2={width} y2={cy + 1} className={styles.instAxis} />
      <circle cx={sx} cy={sy} r={5} fill={accent} />
    </svg>
  );
}

export function InstrumentWeather({ size, colors }: { size: CardSize; colors: InstrumentColors }) {
  const w = D.weather;
  if (size === "S")
    return (
      <InstrumentCard size="S" label="Weather">
        <div className={styles.instTop}>
          <span className={styles.instNum} style={{ fontSize: 50 }}>
            {w.temp}°
          </span>
          <Icon name="partly_cloudy_day" size={26} />
        </div>
        <div className={styles.instBottom}>
          <SunArc width={148} accent={colors.sun.accent} />
          <div className={styles.instTimes}>
            <span>{w.sunrise}</span>
            <span>{w.sunset}</span>
          </div>
        </div>
      </InstrumentCard>
    );
  const chartW = 196;
  const chartH = 92;
  const temps = w.hourly.map((h) => h.temp);
  const step = chartW / (w.hourly.length - 1);
  return (
    <InstrumentCard size="M" label="Weather">
      <div className={styles.instSide} style={{ left: 20 }}>
        <span className={styles.instNum} style={{ fontSize: 54 }}>
          {w.temp}°
        </span>
        <span className={styles.instStrong}>{w.condition}</span>
        <span className={styles.instSoft}>{w.place}</span>
        <span className={styles.instSoft}>
          {w.high}° / {w.low}°
        </span>
      </div>
      <div style={{ position: "absolute", right: 18, top: 26 }}>
        <svg
          width={chartW}
          height={chartH + 18}
          viewBox={`0 0 ${String(chartW)} ${String(chartH + 18)}`}
          aria-hidden
          className={styles.instChart}
        >
          {w.hourly.map((h, i) => (
            <rect
              key={h.time}
              x={i * step - 5}
              y={chartH - (h.rain / 100) * 40}
              width={10}
              height={(h.rain / 100) * 40}
              rx={2}
              fill={colors.sky.accent}
              opacity={0.45}
            />
          ))}
          <line
            x1="0"
            y1={chartH - 0.5}
            x2={chartW}
            y2={chartH - 0.5}
            className={styles.instAxis}
          />
          <path
            d={smoothPath(temps, chartW, chartH - 40, 8)}
            stroke={colors.sun.accent}
            className={styles.instLine}
          />
          {w.hourly.map((h, i) => (
            <text key={h.time} x={i * step} y={chartH + 14} className={styles.instTick}>
              {h.time}
            </text>
          ))}
        </svg>
      </div>
    </InstrumentCard>
  );
}

function Disc({ size }: { size: number }) {
  return (
    <div
      className={styles.disc}
      style={{ width: size, height: size }}
      role="img"
      aria-label="Album art"
    >
      <div
        className={styles.discLabel}
        style={{ background: ART_BACKGROUND, width: size * 0.38, height: size * 0.38 }}
      />
    </div>
  );
}

export function InstrumentMedia({ size, colors }: { size: CardSize; colors: InstrumentColors }) {
  const m = D.media;
  const bars = (count: number, width: number, height: number) => (
    <div
      className={styles.waveBars}
      style={{ width, height }}
      role="progressbar"
      aria-label="Playback position"
      aria-valuenow={Math.round(m.progress * 100)}
    >
      {Array.from({ length: count }, (_, i) => {
        const h = 0.3 + 0.7 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.45));
        const played = i / count < m.progress;
        return (
          <div
            key={i}
            style={{
              height: `${String(h * 100)}%`,
              background: played ? colors.media.accent : undefined,
            }}
          />
        );
      })}
    </div>
  );
  if (size === "S")
    return (
      <InstrumentCard size="S" label="Now playing">
        <div style={{ position: "absolute", left: -26, top: 12 }}>
          <Disc size={112} />
        </div>
        <div className={styles.instTopRight}>
          <Icon name="pause" size={28} fill={1} />
        </div>
        <div className={styles.instBottom} style={{ gap: 6 }}>
          <span className={styles.instStrong}>{m.title}</span>
          {bars(26, 148, 16)}
        </div>
      </InstrumentCard>
    );
  return (
    <InstrumentCard size="M" label="Now playing">
      <div style={{ position: "absolute", left: -40, top: 12 }}>
        <Disc size={156} />
      </div>
      <div className={styles.instSide} style={{ left: 136, right: 18, gap: 6 }}>
        <span className={styles.instTitle}>{m.title}</span>
        <span className={styles.instSoft}>{m.artist}</span>
        {bars(40, 216, 26)}
        <div className={styles.instTimes}>
          <span>{m.elapsed}</span>
          <Icon name="pause" size={24} fill={1} />
          <span>{m.remaining}</span>
        </div>
      </div>
    </InstrumentCard>
  );
}

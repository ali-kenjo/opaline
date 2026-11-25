// The default Opaline theme, the hybrid decided at P1 task 1.1 (DESIGN-2 §11): Lens's clear
// glass and bold condensed numerals as the base; Pebble's shapes only where they carry meaning
// (heat badge, sky, album-art mask); Instrument's dial and charts at M.
import { Icon } from "../../design-system/icons";
import { type KindColors, SNAPSHOT as D } from "./data";
import { Dial } from "./instrument";
import { Card, type CardSize, Shape, smoothPath } from "./parts";
import { heatShape, MaskedArt } from "./pebble";
import styles from "./Directions.module.css";

const LOOK = { refraction: 1.5, rim: 1.6, shadow: 0.8, grain: 0.6 } as const;
const ALPHA = 0.14;

export interface OpalineColors {
  clock: KindColors;
  cpu: KindColors;
  sun: KindColors;
  sky: KindColors;
  media: KindColors;
}

function OpalCard({
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
      look={LOOK}
      className={`${styles.lens} ${styles.opal}`}
    >
      {children}
    </Card>
  );
}

export function OpalineClock({ size, colors }: { size: CardSize; colors: OpalineColors }) {
  const c = D.clock;
  if (size === "S")
    return (
      <OpalCard size="S" label="Clock">
        <div className={styles.lensStack}>
          <span className={styles.lensHero} style={{ fontSize: 80 }}>
            {c.hours}
          </span>
          <span className={styles.lensHero} style={{ fontSize: 80 }}>
            {c.minutes}
          </span>
        </div>
        <div className={styles.lensCorner}>
          <span className={styles.lensStrong}>{c.weekday}</span>
          <span className={styles.lensSoft}>{c.date}</span>
        </div>
      </OpalCard>
    );
  return (
    <OpalCard size="M" label="Clock">
      <div className={styles.lensMain} style={{ justifyContent: "center" }}>
        <span className={styles.lensHero} style={{ fontSize: 96 }}>
          {c.hours}:{c.minutes}
        </span>
        <span className={styles.lensStrong}>
          {c.weekday}, {c.date}
        </span>
        <span className={styles.lensSoft}>
          {c.secondZone.city} {c.secondZone.time}
        </span>
      </div>
      <div className={styles.opalDialSlot}>
        <Dial size={148} accent={colors.clock.accent} className={styles.opalDial} />
      </div>
    </OpalCard>
  );
}

function HeatBadge({ size, colors }: { size: number; colors: KindColors }) {
  return (
    <Shape
      name={heatShape(D.cpu.temp)}
      size={size}
      fill={colors.container}
      style={{ position: "relative" }}
    >
      <span
        className={styles.pebbleNum}
        style={{ fontSize: size * 0.34, color: colors.onContainer }}
      >
        {D.cpu.temp}°
      </span>
    </Shape>
  );
}

export function OpalineCpu({ size, colors }: { size: CardSize; colors: OpalineColors }) {
  const c = D.cpu;
  const k = colors.cpu;
  if (size === "S")
    return (
      <OpalCard size="S" label="Processor">
        <div className={styles.lensMain} style={{ justifyContent: "flex-start" }}>
          <span className={styles.lensHero} style={{ fontSize: 84 }}>
            {c.load}
            <span className={styles.lensUnit}>%</span>
          </span>
        </div>
        <div className={styles.opalBadgeCorner}>
          <HeatBadge size={64} colors={k} />
        </div>
        <div className={styles.lensFoot}>
          <span className={styles.lensValue}>{c.freqGhz} GHz</span>
        </div>
      </OpalCard>
    );
  const chartW = 156;
  const chartH = 56;
  return (
    <OpalCard size="M" label="Processor">
      <div className={styles.lensMain}>
        <span className={styles.lensHero} style={{ fontSize: 124 }}>
          {c.load}
          <span className={styles.lensUnit}>%</span>
        </span>
        <span className={styles.lensSoft}>Processor load</span>
      </div>
      <div className={styles.lensAside} style={{ gap: 8 }}>
        <div className={styles.opalRow}>
          <span className={styles.lensValue}>{c.freqGhz} GHz</span>
          <HeatBadge size={56} colors={k} />
        </div>
        <svg
          width={chartW}
          height={chartH}
          viewBox={`0 0 ${String(chartW)} ${String(chartH)}`}
          aria-hidden
          className={styles.opalChart}
        >
          <path
            d={`${smoothPath(c.history, chartW, chartH, 5)} L${String(chartW)} ${String(chartH)} L0 ${String(chartH)} Z`}
            fill={k.accent}
            opacity={0.22}
          />
          <path d={smoothPath(c.history, chartW, chartH, 5)} />
        </svg>
        <span className={styles.lensSoft}>Last 15 minutes</span>
      </div>
    </OpalCard>
  );
}

function Sky({ scale, colors }: { scale: number; colors: OpalineColors }) {
  return (
    <div style={{ position: "relative", width: 132 * scale, height: 126 * scale }}>
      <Shape
        name="sunny"
        size={92 * scale}
        fill={colors.sun.container}
        style={{ left: 40 * scale, top: 0 }}
      />
      <Shape
        name="puffy"
        size={84 * scale}
        fill={colors.sky.container}
        style={{ left: 0, top: 42 * scale }}
      />
    </div>
  );
}

export function OpalineWeather({ size, colors }: { size: CardSize; colors: OpalineColors }) {
  const w = D.weather;
  if (size === "S")
    return (
      <OpalCard size="S" label="Weather">
        <div className={styles.opalSkyCorner}>
          <Sky scale={0.5} colors={colors} />
        </div>
        <div className={styles.lensMain} style={{ justifyContent: "flex-start" }}>
          <span className={styles.lensHero} style={{ fontSize: 100 }}>
            {w.temp}°
          </span>
        </div>
        <div className={styles.lensFoot}>
          <span className={styles.lensStrong}>{w.condition}</span>
          <span className={styles.lensSoft}>
            {w.place}, {w.high}° / {w.low}°
          </span>
        </div>
      </OpalCard>
    );
  const chartW = 150;
  const chartH = 76;
  const temps = w.hourly.map((h) => h.temp);
  const step = chartW / (w.hourly.length - 1);
  return (
    <OpalCard size="M" label="Weather">
      <div className={styles.lensMain}>
        <span className={styles.lensHero} style={{ fontSize: 104 }}>
          {w.temp}°
        </span>
        <span className={styles.lensStrong}>{w.condition}</span>
        <span className={styles.lensSoft}>{w.place}</span>
      </div>
      <div className={styles.opalSkyM}>
        <Sky scale={0.42} colors={colors} />
      </div>
      <div className={styles.lensAside} style={{ width: chartW }}>
        <svg
          width={chartW}
          height={chartH + 16}
          viewBox={`0 0 ${String(chartW)} ${String(chartH + 16)}`}
          aria-hidden
          className={styles.opalChart}
        >
          {w.hourly.map((h, i) => (
            <rect
              key={h.time}
              x={i * step - 4}
              y={chartH - (h.rain / 100) * 30}
              width={8}
              height={(h.rain / 100) * 30}
              rx={2}
              fill={colors.sky.accent}
              opacity={0.5}
            />
          ))}
          <path d={smoothPath(temps, chartW, chartH - 30, 8)} />
          {w.hourly
            .filter((_, i) => i % 2 === 0)
            .map((h, j) => (
              <text key={h.time} x={j * 2 * step} y={chartH + 13} className={styles.opalTick}>
                {h.time}
              </text>
            ))}
        </svg>
      </div>
    </OpalCard>
  );
}

export function OpalineMedia({ size, colors }: { size: CardSize; colors: OpalineColors }) {
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
            className={styles.opalBar}
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
      <OpalCard size="S" label="Now playing">
        <MaskedArt size={100} />
        <div className={styles.lensFoot}>
          <span className={styles.lensStrong}>{m.title}</span>
          <span className={styles.lensSoft}>{m.artist}</span>
        </div>
      </OpalCard>
    );
  return (
    <OpalCard size="M" label="Now playing">
      <MaskedArt size={146} />
      <div className={styles.lensMediaText}>
        <span className={styles.lensTitle}>{m.title}</span>
        <span className={styles.lensSoft}>{m.artist}</span>
        <div className={styles.lensControls}>
          <Icon name="skip_previous" size={26} />
          <Icon name="pause" size={34} fill={1} />
          <Icon name="skip_next" size={26} />
        </div>
        {bars(34, 170, 22)}
        <div className={styles.lensTimes}>
          <span>{m.elapsed}</span>
          <span>{m.remaining}</span>
        </div>
      </div>
    </OpalCard>
  );
}

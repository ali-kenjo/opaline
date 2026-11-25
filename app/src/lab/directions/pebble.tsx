// Direction B, "Pebble": glass tinted in each widget kind's own color, and Material shapes that
// carry the data (heat as a cookie badge, the sky as sun and cloud, the album art in a cookie).
import { WavyProgress } from "../../design-system/components";
import { Icon } from "../../design-system/icons";
import { cubicsToPath, materialShape } from "../../design-system/shapes";
import { type KindColors, SNAPSHOT as D } from "./data";
import { ART_BACKGROUND, Card, type CardSize, Shape } from "./parts";
import styles from "./Directions.module.css";

const LOOK = { refraction: 1, rim: 1.1, shadow: 1 } as const;
const ALPHA = 0.46;

export interface PebbleColors {
  clock: KindColors;
  cpu: KindColors;
  sun: KindColors;
  sky: KindColors;
  media: KindColors;
}

function PebbleCard({
  size,
  label,
  colors,
  children,
}: {
  size: CardSize;
  label: string;
  colors: KindColors;
  children: React.ReactNode;
}) {
  return (
    <Card
      size={size}
      label={label}
      alpha={ALPHA}
      tint={colors.tint}
      look={LOOK}
      className={styles.pebble}
    >
      {children}
    </Card>
  );
}

export function PebbleClock({ size, colors }: { size: CardSize; colors: PebbleColors }) {
  const c = D.clock;
  const k = colors.clock;
  const digit = (text: string, fontSize: number, color = k.onContainer) => (
    <span className={styles.pebbleNum} style={{ fontSize, color }}>
      {text}
    </span>
  );
  if (size === "S")
    return (
      <PebbleCard size="S" label="Clock" colors={k}>
        <Shape name="cookie9Sided" size={104} fill={k.container} style={{ left: 14, top: 14 }}>
          {digit(c.hours, 50)}
        </Shape>
        <Shape name="sunny" size={96} fill={k.accent} rotate={12} style={{ right: 12, bottom: 12 }}>
          {digit(c.minutes, 46, k.onAccent)}
        </Shape>
      </PebbleCard>
    );
  return (
    <PebbleCard size="M" label="Clock" colors={k}>
      <Shape name="cookie9Sided" size={124} fill={k.container} style={{ left: 18, top: 28 }}>
        {digit(c.hours, 60)}
      </Shape>
      <Shape name="sunny" size={116} fill={k.accent} rotate={12} style={{ left: 122, top: 32 }}>
        {digit(c.minutes, 56, k.onAccent)}
      </Shape>
      <div className={styles.pebbleSide} style={{ left: 256 }}>
        <span className={styles.pebbleStrong}>{c.weekday}</span>
        <span className={styles.pebbleSoft}>{c.date}</span>
        <span
          className={styles.pebbleChip}
          style={{ background: k.container, color: k.onContainer }}
        >
          {c.secondZone.city} {c.secondZone.time}
        </span>
      </div>
    </PebbleCard>
  );
}

/** The CPU badge's shape follows the heat: calm circle, then cookies, then bursts. */
export function heatShape(temp: number) {
  if (temp < 45) return "circle" as const;
  if (temp < 65) return "cookie7Sided" as const;
  if (temp < 80) return "softBurst" as const;
  return "burst" as const;
}

export function PebbleCpu({ size, colors }: { size: CardSize; colors: PebbleColors }) {
  const c = D.cpu;
  const k = colors.cpu;
  const badge = (s: number, fontSize: number) => (
    <Shape name={heatShape(c.temp)} size={s} fill={k.container}>
      <span className={styles.pebbleNum} style={{ fontSize, color: k.onContainer }}>
        {c.temp}°
      </span>
    </Shape>
  );
  const cores = (height: number) => (
    <div className={styles.pebbleCores} style={{ height }} role="img" aria-label="Load per core">
      {c.cores.map((v, i) => (
        <div key={i} style={{ height: `${String(Math.max(18, v))}%`, background: k.accent }} />
      ))}
    </div>
  );
  if (size === "S")
    return (
      <PebbleCard size="S" label="Processor" colors={k}>
        <div style={{ position: "absolute", left: 14, top: 14 }}>{badge(108, 38)}</div>
        <div className={styles.pebbleCorner}>
          <span className={styles.pebbleValue}>
            {c.load}
            <small>%</small>
          </span>
          <span className={styles.pebbleSoft}>Load</span>
        </div>
      </PebbleCard>
    );
  return (
    <PebbleCard size="M" label="Processor" colors={k}>
      <div style={{ position: "absolute", left: 16, top: 22 }}>{badge(136, 46)}</div>
      <div className={styles.pebbleSide} style={{ left: 172, right: 20, gap: 10 }}>
        <div className={styles.pebbleRow}>
          <span className={styles.pebbleValue} style={{ fontSize: 44 }}>
            {c.load}
            <small>%</small>
          </span>
          <span className={styles.pebbleSoft}>
            Load
            <br />
            {c.freqGhz} GHz
          </span>
        </div>
        {cores(56)}
      </div>
    </PebbleCard>
  );
}

const HOUR_SHAPE = { partly: "sunny", cloud: "puffy", rain: "puffyDiamond" } as const;

export function PebbleWeather({ size, colors }: { size: CardSize; colors: PebbleColors }) {
  const w = D.weather;
  const sky = (scale: number, left: number, top: number) => (
    <>
      <Shape
        name="sunny"
        size={92 * scale}
        fill={colors.sun.container}
        style={{ left: left + 40 * scale, top }}
      />
      <Shape
        name="puffy"
        size={84 * scale}
        fill={colors.sky.container}
        style={{ left, top: top + 42 * scale, opacity: 0.96 }}
      />
    </>
  );
  if (size === "S")
    return (
      <PebbleCard size="S" label="Weather" colors={colors.sky}>
        {sky(0.7, 84, 84)}
        <div className={styles.pebbleHead}>
          <span className={styles.pebbleValue} style={{ fontSize: 52 }}>
            {w.temp}°
          </span>
          <span className={styles.pebbleSoft}>{w.condition}</span>
        </div>
      </PebbleCard>
    );
  return (
    <PebbleCard size="M" label="Weather" colors={colors.sky}>
      {sky(0.86, 10, 26)}
      <div className={styles.pebbleSide} style={{ left: 132 }}>
        <span className={styles.pebbleValue} style={{ fontSize: 60 }}>
          {w.temp}°
        </span>
        <span className={styles.pebbleStrong}>{w.condition}</span>
        <span className={styles.pebbleSoft}>
          {w.place}, {w.high}° / {w.low}°
        </span>
      </div>
      <div className={styles.pebbleHours}>
        {w.hourly
          .filter((_, i) => i % 3 === 0)
          .map((h) => (
            <div key={h.time}>
              <span className={styles.pebbleSoft}>{h.time}</span>
              <Shape
                name={HOUR_SHAPE[h.kind]}
                size={24}
                fill={h.kind === "partly" ? colors.sun.container : colors.sky.container}
                style={{ position: "relative" }}
              />
              <b>{h.temp}°</b>
            </div>
          ))}
      </div>
    </PebbleCard>
  );
}

export function MaskedArt({ size }: { size: number }) {
  const d = cubicsToPath(materialShape("cookie12Sided").cubics, size);
  return (
    <div
      role="img"
      aria-label="Album art"
      className={styles.pebbleArt}
      style={{ width: size, height: size, background: ART_BACKGROUND, clipPath: `path("${d}")` }}
    />
  );
}

export function PebbleMedia({ size, colors }: { size: CardSize; colors: PebbleColors }) {
  const m = D.media;
  const k = colors.media;
  const play = (s: number) => (
    <span
      className={styles.pebblePlay}
      style={{ width: s * 1.4, height: s, background: k.container, color: k.onContainer }}
    >
      <Icon name="pause" size={s * 0.55} fill={1} />
    </span>
  );
  if (size === "S")
    return (
      <PebbleCard size="S" label="Now playing" colors={k}>
        <div style={{ position: "absolute", left: 14, top: 12 }}>
          <MaskedArt size={108} />
        </div>
        <div style={{ position: "absolute", right: 14, top: 18 }}>{play(40)}</div>
        <div className={styles.pebbleFoot}>
          <span className={styles.pebbleStrong}>{m.title}</span>
          <span className={styles.pebbleSoft}>{m.artist}</span>
        </div>
      </PebbleCard>
    );
  return (
    <PebbleCard size="M" label="Now playing" colors={k}>
      <div style={{ position: "absolute", left: 14, top: 16 }}>
        <MaskedArt size={148} />
      </div>
      <div className={styles.pebbleSide} style={{ left: 178, right: 18, gap: 6 }}>
        <span className={styles.pebbleTitle}>{m.title}</span>
        <span className={styles.pebbleSoft}>{m.artist}</span>
        <div style={{ color: k.accent, marginTop: 6 }}>
          <WavyProgress value={m.progress} width={176} label="Playback position" />
        </div>
        <div className={styles.pebbleRow} style={{ justifyContent: "space-between" }}>
          <Icon name="skip_previous" size={24} />
          {play(44)}
          <Icon name="skip_next" size={24} />
        </div>
      </div>
    </PebbleCard>
  );
}

// Direction A, "Lens": clear glass that keeps the wallpaper visible; the numbers are the design.
// Very bold, condensed Roboto Flex; almost no color; text holds its own with a soft halo.
import { Icon } from "../../design-system/icons";
import { SNAPSHOT as D } from "./data";
import { Art, Card, type CardSize, smoothPath } from "./parts";
import styles from "./Directions.module.css";

const LOOK = { refraction: 1.7, rim: 1.9, shadow: 0.7, grain: 0.6 } as const;
const ALPHA = 0.1;

function LensCard({
  size,
  label,
  children,
}: {
  size: CardSize;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Card size={size} label={label} alpha={ALPHA} look={LOOK} className={styles.lens}>
      {children}
    </Card>
  );
}

export function LensClock({ size }: { size: CardSize }) {
  const c = D.clock;
  if (size === "S")
    return (
      <LensCard size="S" label="Clock">
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
      </LensCard>
    );
  return (
    <LensCard size="M" label="Clock">
      <div className={styles.lensMain}>
        <span className={styles.lensHero} style={{ fontSize: 116 }}>
          {c.hours}:{c.minutes}
        </span>
        <span className={styles.lensStrong}>
          {c.weekday}, {c.date}
        </span>
      </div>
      <div className={styles.lensAside}>
        <span className={styles.lensSoft}>{c.secondZone.city}</span>
        <span className={styles.lensValue} style={{ fontSize: 24 }}>
          {c.secondZone.time}
        </span>
      </div>
    </LensCard>
  );
}

export function LensCpu({ size }: { size: CardSize }) {
  const c = D.cpu;
  const readouts = (labels: boolean) => (
    <div className={styles.lensReadouts}>
      <div title="Temperature" aria-label={`Temperature ${String(c.temp)}°`}>
        <span className={styles.lensValue}>{c.temp}°</span>
        {labels ? <span className={styles.lensSoft}>Temperature</span> : null}
      </div>
      <div title="Frequency" aria-label={`Frequency ${c.freqGhz} GHz`}>
        <span className={styles.lensValue}>{c.freqGhz} GHz</span>
        {labels ? <span className={styles.lensSoft}>Frequency</span> : null}
      </div>
    </div>
  );
  if (size === "S")
    return (
      <LensCard size="S" label="Processor">
        <div className={styles.lensMain} style={{ justifyContent: "flex-start" }}>
          <span className={styles.lensHero} style={{ fontSize: 84 }}>
            {c.load}
            <span className={styles.lensUnit}>%</span>
          </span>
          <div className={styles.lensLine}>
            <div style={{ width: `${String(c.load)}%` }} />
          </div>
        </div>
        {readouts(false)}
      </LensCard>
    );
  return (
    <LensCard size="M" label="Processor">
      <div className={styles.lensMain}>
        <span className={styles.lensHero} style={{ fontSize: 124 }}>
          {c.load}
          <span className={styles.lensUnit}>%</span>
        </span>
        <span className={styles.lensSoft}>Processor load</span>
      </div>
      <div className={styles.lensAside} style={{ gap: 14 }}>
        <div className={styles.lensCores} role="img" aria-label="Load per core">
          {c.cores.map((v, i) => (
            <div key={i} style={{ height: `${String(v)}%` }} />
          ))}
        </div>
        {readouts(true)}
      </div>
    </LensCard>
  );
}

export function LensWeather({ size }: { size: CardSize }) {
  const w = D.weather;
  if (size === "S")
    return (
      <LensCard size="S" label="Weather">
        <Icon name="partly_cloudy_day" size={30} className={styles.lensIcon} />
        <div className={styles.lensMain}>
          <span className={styles.lensHero} style={{ fontSize: 104 }}>
            {w.temp}°
          </span>
        </div>
        <div className={styles.lensFoot}>
          <span className={styles.lensStrong}>{w.condition}</span>
          <span className={styles.lensSoft}>
            {w.place}, {w.high}° / {w.low}°
          </span>
        </div>
      </LensCard>
    );
  const temps = w.hourly.map((h) => h.temp);
  return (
    <LensCard size="M" label="Weather">
      <div className={styles.lensMain}>
        <span className={styles.lensHero} style={{ fontSize: 112 }}>
          {w.temp}°
        </span>
        <span className={styles.lensStrong}>{w.condition}</span>
        <span className={styles.lensSoft}>{w.place}</span>
      </div>
      <div className={styles.lensAside} style={{ width: 168 }}>
        <svg width="168" height="62" viewBox="0 0 168 62" aria-hidden className={styles.lensChart}>
          <path d={smoothPath(temps, 168, 62, 10)} />
        </svg>
        <div className={styles.lensHours}>
          {w.hourly
            .filter((_, i) => i % 2 === 0)
            .map((h) => (
              <span key={h.time}>
                <b>{h.temp}°</b>
                {h.time}
              </span>
            ))}
        </div>
      </div>
    </LensCard>
  );
}

export function LensMedia({ size }: { size: CardSize }) {
  const m = D.media;
  const progress = (
    <div className={styles.lensLine}>
      <div style={{ width: `${String(m.progress * 100)}%` }} />
    </div>
  );
  if (size === "S")
    return (
      <LensCard size="S" label="Now playing">
        <Art size={96} radius={18} />
        <div className={styles.lensFoot}>
          <span className={styles.lensStrong}>{m.title}</span>
          <span className={styles.lensSoft}>{m.artist}</span>
          {progress}
        </div>
      </LensCard>
    );
  return (
    <LensCard size="M" label="Now playing">
      <Art size={144} radius={22} />
      <div className={styles.lensMediaText}>
        <span className={styles.lensTitle}>{m.title}</span>
        <span className={styles.lensSoft}>{m.artist}</span>
        <div className={styles.lensControls}>
          <Icon name="skip_previous" size={26} />
          <Icon name="pause" size={34} fill={1} />
          <Icon name="skip_next" size={26} />
        </div>
        {progress}
        <div className={styles.lensTimes}>
          <span>{m.elapsed}</span>
          <span>{m.remaining}</span>
        </div>
      </div>
    </LensCard>
  );
}

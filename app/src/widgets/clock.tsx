// Clock widget: digital or analog face, 12/24 h, seconds, date style, its own time zone and a
// second zone. Follows GNOME's clock settings unless the user overrides them.
import { useEffect, useState } from "react";
import { Odometer } from "../design-system/motion";
import { map, num, text } from "./format";
import { useHost } from "./host";
import type { CardStatus, ReadCtx, RenderCtx, WidgetDef } from "./types";
import styles from "./clock.module.css";

const SETTINGS = "clock.settings";

function systemSettings(c: ReadCtx) {
  const s = map(c.get(SETTINGS));
  return {
    h24: s?.format24h?.kind === "bool" ? s.format24h.v : true,
    seconds: s?.showSeconds?.kind === "bool" ? s.showSeconds.v : false,
    zone: text(s?.timezone) ?? undefined,
    weekStart: num(s?.weekStart) ?? 1,
  };
}

function validZone(zone: string): string | undefined {
  const z = zone.trim();
  if (!z) return undefined;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: z });
    return z;
  } catch {
    return undefined;
  }
}

function useNow(withSeconds: boolean): Date {
  const host = useHost();
  const fixed = host.now?.();
  const [now, setNow] = useState(() => fixed ?? new Date());
  useEffect(() => {
    if (fixed) return;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      const d = new Date();
      setNow(d);
      const step = withSeconds ? 1000 : 60_000;
      t = setTimeout(tick, step - (d.getTime() % step) + 5);
    };
    tick();
    return () => {
      clearTimeout(t);
    };
  }, [withSeconds, fixed]);
  return fixed ?? now;
}

/** ISO week number of a date in a zone. */
function isoWeek(d: Date, zone: string | undefined): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const [y, m, day] = parts.split("-").map(Number);
  const t = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, day ?? 1));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

function Analog({ now, zone, seconds }: { now: Date; zone: string | undefined; seconds: boolean }) {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  })
    .formatToParts(now)
    .reduce<Record<string, number>>(
      (a, x) => (x.type === "literal" ? a : { ...a, [x.type]: Number(x.value) }),
      {},
    );
  const h = p.hour ?? 0;
  const m = p.minute ?? 0;
  const s = p.second ?? 0;
  const hand = (deg: number, len: number, w: number, cls: string) => (
    <line
      x1="50"
      y1="50"
      x2={50 + len * Math.sin((deg * Math.PI) / 180)}
      y2={50 - len * Math.cos((deg * Math.PI) / 180)}
      strokeWidth={w}
      strokeLinecap="round"
      className={cls}
    />
  );
  return (
    <svg
      viewBox="0 0 100 100"
      className={styles.analog}
      role="img"
      aria-label={now.toLocaleTimeString(undefined, { timeZone: zone })}
    >
      <circle cx="50" cy="50" r="47" className={styles.face} />
      {Array.from({ length: 12 }, (_, i) => (
        <circle
          key={i}
          cx={50 + 40 * Math.sin((i * Math.PI) / 6)}
          cy={50 - 40 * Math.cos((i * Math.PI) / 6)}
          r={i % 3 === 0 ? 2.2 : 1.2}
          className={styles.tick}
        />
      ))}
      {hand(((h % 12) + m / 60) * 30, 24, 5, styles.hourHand ?? "")}
      {hand((m + s / 60) * 6, 34, 3.5, styles.minuteHand ?? "")}
      {seconds ? hand(s * 6, 38, 1.5, styles.secondHand ?? "") : null}
      <circle cx="50" cy="50" r="3" className={styles.pin} />
    </svg>
  );
}

function ClockFace({ ctx }: { ctx: RenderCtx }) {
  const { content, size, style, readings } = ctx;
  const sys = systemSettings(ctx);
  const formatOpt = content.opt<string>("format");
  const secondsOpt = content.opt<string>("seconds");
  const h24 = formatOpt === "system" ? sys.h24 : formatOpt === "24";
  const seconds = secondsOpt === "system" ? sys.seconds : secondsOpt === "on";
  const zone = validZone(content.opt<string>("zone")) ?? sys.zone;
  const zone2 = validZone(content.opt<string>("zone2"));
  const now = useNow(seconds);
  const face = content.opt<string>("face");
  const dateStyle = content.opt<"full" | "long" | "medium" | "short">("dateStyle");

  const time = new Intl.DateTimeFormat(undefined, {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
    ...(seconds && size !== "1x1" ? { second: "2-digit" } : {}),
    hourCycle: h24 ? "h23" : "h12",
  }).format(now);
  const show = new Set(readings.map((r) => r.field.id));
  const label = (id: string) => readings.find((r) => r.field.id === id)?.label ?? id;
  const animate = style.animations && style.odometer;

  const lines: { id: string; text: string }[] = [];
  for (const r of readings) {
    if (r.field.id === "date")
      lines.push({
        id: "date",
        text: new Intl.DateTimeFormat(undefined, { timeZone: zone, dateStyle }).format(now),
      });
    if (r.field.id === "weekday")
      lines.push({
        id: "weekday",
        text: new Intl.DateTimeFormat(undefined, { timeZone: zone, weekday: "long" }).format(now),
      });
    if (r.field.id === "week")
      lines.push({ id: "week", text: `${label("week")} ${String(isoWeek(now, zone))}` });
    if (r.field.id === "zone")
      lines.push({ id: "zone", text: zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone });
    if (r.field.id === "zone2" && zone2) {
      const t2 = new Intl.DateTimeFormat(undefined, {
        timeZone: zone2,
        hour: "numeric",
        minute: "2-digit",
        hourCycle: h24 ? "h23" : "h12",
      }).format(now);
      const custom = content.opt<string>("zone2Label").trim();
      const name = custom !== "" ? custom : (zone2.split("/").pop()?.replace(/_/g, " ") ?? zone2);
      lines.push({ id: "zone2", text: `${name} ${t2}` });
    }
  }

  return (
    <div className={styles.clock} data-size={size} data-face={face}>
      {face === "analog" && size !== "1x1" && size !== "2x1" && size !== "4x1" ? (
        <Analog now={now} zone={zone} seconds={seconds} />
      ) : show.has("time") ? (
        <div className={styles.time} aria-live="off">
          {animate ? (
            <Odometer text={time} className={styles.digits} />
          ) : (
            <span className={styles.digits}>{time}</span>
          )}
        </div>
      ) : null}
      <div className={styles.lines}>
        {lines
          .slice(0, size === "1x1" ? 0 : size === "2x1" || size === "S" || size === "4x1" ? 2 : 6)
          .map((l) => (
            <div key={l.id} className={styles.line}>
              {l.text}
            </div>
          ))}
      </div>
    </div>
  );
}

export const clock: WidgetDef = {
  kind: "clock",
  name: "Clock",
  icon: "schedule",
  category: "time",
  sizes: ["1x1", "2x1", "4x1", "S", "M", "L"],
  defaultSize: "M",
  topics: [SETTINGS],
  defaultFields: ["time", "date"],
  fields: [
    {
      id: "time",
      label: "Time",
      icon: "schedule",
      topics: [],
      hero: false,
      read: () => ({ text: "" }),
    },
    {
      id: "date",
      label: "Date",
      icon: "calendar_today",
      topics: [],
      hero: false,
      read: () => ({ text: "" }),
    },
    {
      id: "weekday",
      label: "Weekday",
      icon: "event",
      topics: [],
      hero: false,
      read: () => ({ text: "" }),
    },
    {
      id: "week",
      label: "Week",
      icon: "event",
      topics: [],
      hero: false,
      read: () => ({ text: "" }),
    },
    {
      id: "zone",
      label: "Time zone",
      icon: "public",
      topics: [],
      hero: false,
      read: () => ({ text: "" }),
    },
    {
      id: "zone2",
      label: "Second time zone",
      icon: "language",
      topics: [],
      hero: false,
      read: () => ({ text: "" }),
    },
  ],
  options: [
    {
      kind: "enum",
      key: "face",
      label: "Face",
      options: [
        { value: "digital", label: "Digital" },
        { value: "analog", label: "Analog" },
      ],
      default: "digital",
    },
    {
      kind: "enum",
      key: "format",
      label: "Time format",
      options: [
        { value: "system", label: "Like the system" },
        { value: "24", label: "24-hour" },
        { value: "12", label: "12-hour" },
      ],
      default: "system",
    },
    {
      kind: "enum",
      key: "seconds",
      label: "Seconds",
      options: [
        { value: "system", label: "Like the system" },
        { value: "on", label: "Show" },
        { value: "off", label: "Hide" },
      ],
      default: "system",
    },
    {
      kind: "enum",
      key: "dateStyle",
      label: "Date style",
      options: [
        { value: "full", label: "Monday, 23 November 2026" },
        { value: "long", label: "23 November 2026" },
        { value: "medium", label: "23 Nov 2026" },
        { value: "short", label: "23/11/2026" },
      ],
      default: "full",
    },
    {
      kind: "text",
      key: "zone",
      label: "Time zone",
      help: "IANA name like Europe/Berlin; empty follows the system.",
      maxLength: 64,
      placeholder: "System",
      default: "",
    },
    {
      kind: "text",
      key: "zone2",
      label: "Second time zone",
      help: "Shown when the Second time zone field is on.",
      maxLength: 64,
      placeholder: "America/New_York",
      default: "",
    },
    {
      kind: "text",
      key: "zone2Label",
      label: "Second zone name",
      maxLength: 32,
      placeholder: "City name",
      default: "",
    },
  ],
  status(): CardStatus {
    // The clock works without core: system settings only refine it.
    return { kind: "ready" };
  },
  render: (ctx) => <ClockFace ctx={ctx} />,
};

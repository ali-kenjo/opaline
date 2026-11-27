// Weather widget (Open-Meteo through core): now, feels like, wind, rain, humidity, pressure, UV,
// air quality, sunrise and sunset, the next hours and days. Location is searched in its settings.
import { useState } from "react";
import { Icon, type IconName } from "../design-system/icons";
import { useHost } from "./host";
import type { Value } from "../layer/protocol";
import { fixed, map, missingReason, num, temperature, type TempUnit, text } from "./format";
import { TEMP_UNIT } from "./options";
import type { CardStatus, ReadCtx, Reading, RenderCtx, WidgetDef } from "./types";
import { weatherComposition } from "./weather.composition";
import styles from "./weather.module.css";
import frame from "./WidgetFrame.module.css";

const CURRENT = "weather.current";
const HOURLY = "weather.hourly";
const DAILY = "weather.daily";
const AIR = "weather.air";

/** WMO weather codes → words and an icon. */
export function condition(code: number | null, day: boolean): { text: string; icon: IconName } {
  if (code === null) return { text: "—", icon: "cloud" };
  if (code === 0) return { text: "Clear", icon: day ? "sunny" : "dark_mode" };
  if (code <= 2)
    return {
      text: code === 1 ? "Mostly clear" : "Partly cloudy",
      icon: day ? "partly_cloudy_day" : "dark_mode",
    };
  if (code === 3) return { text: "Overcast", icon: "cloud" };
  if (code === 45 || code === 48) return { text: "Fog", icon: "foggy" };
  if (code >= 51 && code <= 57) return { text: "Drizzle", icon: "rainy" };
  if (code >= 61 && code <= 67)
    return { text: code >= 66 ? "Freezing rain" : "Rain", icon: "rainy" };
  if (code >= 71 && code <= 77) return { text: "Snow", icon: "weather_snowy" };
  if (code >= 80 && code <= 82) return { text: "Showers", icon: "rainy" };
  if (code === 85 || code === 86) return { text: "Snow showers", icon: "weather_snowy" };
  if (code >= 95) return { text: "Thunderstorm", icon: "thunderstorm" };
  return { text: "—", icon: "cloud" };
}

const cur = (c: ReadCtx) => map(c.get(CURRENT));
const today = (c: ReadCtx) => {
  const d = c.get(DAILY);
  return d?.kind === "list" && d.v[0]?.kind === "map" ? d.v[0].v : null;
};
const temp = (c: ReadCtx, v: number) =>
  temperature(v, c.content.opt<TempUnit>("tempUnit"), c.content.decimals);

type WindUnit = "kmh" | "ms" | "mph" | "kn";
function wind(kmh: number, unit: WindUnit): string {
  const v =
    unit === "ms" ? kmh / 3.6 : unit === "mph" ? kmh / 1.609 : unit === "kn" ? kmh / 1.852 : kmh;
  const name = { kmh: "km/h", ms: "m/s", mph: "mph", kn: "kn" }[unit];
  return `${fixed(v, unit === "ms" ? 1 : 0)} ${name}`;
}

function compass(deg: number): string {
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8] ?? "";
}

function hm(iso: string | null): string | null {
  if (!iso) return null;
  const m = /T(\d\d:\d\d)/.exec(iso);
  return m?.[1] ?? null;
}

function rows(v: Value | undefined): Record<string, Value>[] {
  return v?.kind === "list" ? v.v.flatMap((r) => (r.kind === "map" ? [r.v] : [])) : [];
}

function field(
  id: string,
  label: string,
  icon: IconName,
  topics: string[],
  read: (c: ReadCtx) => Reading | null,
  hero = false,
) {
  return { id, label, icon, topics, read, hero };
}

function Strips({ ctx }: { ctx: RenderCtx }) {
  const shown = new Set(ctx.content.fields);
  const host = useHost();
  const [now] = useState(() => host.now?.() ?? new Date());
  const hours = rows(ctx.get(HOURLY));
  // Open-Meteo hours are local to the place ("2026-11-23T14:00"); compare in its time zone.
  const tz = text(cur(ctx)?.timezone) ?? undefined;
  const hour = new Intl.DateTimeFormat("sv-SE", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  })
    .format(now)
    .replace(" ", "T");
  const next = hours.filter((h) => (text(h.time) ?? "").slice(0, 13) >= hour).slice(0, 8);
  const days = rows(ctx.get(DAILY)).slice(0, 7);
  return (
    <>
      {shown.has("hourly") && next.length ? (
        <div className={styles.strip} aria-label="Next hours">
          {next.map((h) => {
            const cnd = condition(num(h.code), num(h.isDay) !== 0);
            const t = num(h.tempC);
            return (
              <div key={text(h.time) ?? ""}>
                <span className={styles.sub}>{hm(text(h.time))}</span>
                <Icon name={cnd.icon} size={18} label={cnd.text} />
                <span className={styles.temp}>
                  {t === null ? "—" : temp(ctx, t).replace(/ °[CF]$/, "°")}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
      {shown.has("daily") && days.length ? (
        <div className={styles.strip} aria-label="Next days">
          {days.map((d) => {
            const date = text(d.date);
            const cnd = condition(num(d.code), true);
            const hi = num(d.maxC);
            const lo = num(d.minC);
            return (
              <div key={date ?? ""}>
                <span className={styles.sub}>
                  {date
                    ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
                        weekday: "short",
                      })
                    : ""}
                </span>
                <Icon name={cnd.icon} size={18} label={cnd.text} />
                <span className={styles.temp}>
                  {hi === null ? "—" : temp(ctx, hi).replace(/ °[CF]$/, "°")}{" "}
                  <span className={styles.sub}>
                    {lo === null ? "" : temp(ctx, lo).replace(/ °[CF]$/, "°")}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </>
  );
}

function Weather({ ctx }: { ctx: RenderCtx }) {
  const c = cur(ctx);
  const day = c?.isDay?.kind === "bool" ? c.isDay.v : true;
  const cnd = condition(num(c?.code), day);
  const t = num(c?.tempC);
  const big = ctx.size === "L" || ctx.size === "XL";
  // Rows give way to the hour and day strips on L.
  const strips = ctx.content.fields.filter((f) => f === "hourly" || f === "daily").length;
  const bigRows = ctx.size === "XL" ? 8 : strips === 2 ? 3 : strips === 1 ? 5 : 8;
  const rest: RenderCtx = {
    ...ctx,
    readings: ctx.readings.filter(
      (r) =>
        r.field.id !== "temp" &&
        r.field.id !== "condition" &&
        r.field.id !== "hourly" &&
        r.field.id !== "daily",
    ),
  };
  return (
    <div className={styles.weather} data-size={ctx.size}>
      <div className={styles.now}>
        {ctx.style.icons ? (
          <Icon name={cnd.icon} size={ctx.size === "1x1" ? 24 : 40} fill={1} />
        ) : null}
        <span className={styles.big}>{t === null ? "—" : temp(ctx, t)}</span>
        {ctx.size !== "1x1" ? (
          <div className={styles.cond}>
            <span className={styles.condText}>{cnd.text}</span>
            <span className={styles.sub}>{text(c?.location) ?? ""}</span>
          </div>
        ) : null}
      </div>
      {ctx.size !== "1x1" && ctx.size !== "2x1" && rest.readings.length ? (
        <dl className={frame.rows}>
          {rest.readings.slice(0, big ? bigRows : ctx.size === "M" ? 3 : 2).map((r) => (
            <div key={r.field.id} className={frame.row}>
              <dt>
                {r.field.icon ? (
                  <Icon name={r.field.icon} size={16} className={frame.icon} />
                ) : null}
                {r.label}
              </dt>
              <dd>{r.reading?.text ?? "—"}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {big ? <Strips ctx={ctx} /> : null}
    </div>
  );
}

export const weather: WidgetDef = {
  kind: "weather",
  name: "Weather",
  icon: "partly_cloudy_day",
  category: "info",
  sizes: ["1x1", "2x1", "4x1", "S", "M", "L", "XL"],
  defaultSize: "M",
  topics: [CURRENT],
  extraTopics: () => [HOURLY, DAILY, AIR],
  defaultFields: ["temp", "condition", "highLow", "feels", "rain", "wind", "hourly", "daily"],
  fields: [
    field(
      "temp",
      "Temperature",
      "thermostat",
      [CURRENT],
      (c) => {
        const t = num(cur(c)?.tempC);
        return t === null ? null : { text: temp(c, t), value: t };
      },
      true,
    ),
    field("condition", "Condition", "cloud", [CURRENT], (c) => ({
      text: condition(num(cur(c)?.code), true).text,
    })),
    field("highLow", "High / low", "thermostat", [DAILY], (c) => {
      const d = today(c);
      const hi = num(d?.maxC);
      const lo = num(d?.minC);
      return hi === null || lo === null ? null : { text: `${temp(c, hi)} / ${temp(c, lo)}` };
    }),
    field("feels", "Feels like", "device_thermostat", [CURRENT], (c) => {
      const t = num(cur(c)?.feelsC);
      return t === null ? null : { text: temp(c, t) };
    }),
    field("rain", "Rain chance", "water_drop", [DAILY], (c) => {
      const p = num(today(c)?.precipProb);
      return p === null ? null : { text: `${fixed(p, 0)} %` };
    }),
    field("precip", "Precipitation", "rainy", [CURRENT], (c) => {
      const mm = num(cur(c)?.precipMm);
      if (mm === null) return null;
      return {
        text:
          c.content.opt<string>("precipUnit") === "in"
            ? `${fixed(mm / 25.4, 2)} in`
            : `${fixed(mm, 1)} mm`,
      };
    }),
    field("wind", "Wind", "air", [CURRENT], (c) => {
      const k = num(cur(c)?.windKmh);
      const d = num(cur(c)?.windDir);
      return k === null
        ? null
        : {
            text: `${wind(k, c.content.opt<WindUnit>("windUnit"))}${d === null ? "" : ` ${compass(d)}`}`,
          };
    }),
    field("humidity", "Humidity", "water_drop", [CURRENT], (c) => {
      const h = num(cur(c)?.humidity);
      return h === null ? null : { text: `${fixed(h, 0)} %` };
    }),
    field("pressure", "Pressure", "speed", [CURRENT], (c) => {
      const p = num(cur(c)?.pressureHpa);
      return p === null ? null : { text: `${fixed(p, 0)} hPa` };
    }),
    field("cloud", "Clouds", "cloud", [CURRENT], (c) => {
      const p = num(cur(c)?.cloud);
      return p === null ? null : { text: `${fixed(p, 0)} %` };
    }),
    field("uv", "UV index", "sunny", [DAILY], (c) => {
      const u = num(today(c)?.uv);
      return u === null ? null : { text: fixed(u, 0) };
    }),
    field("air", "Air quality", "air", [AIR], (c) => {
      const a = map(c.get(AIR));
      const eu = num(a?.europeanAqi);
      return eu === null
        ? null
        : {
            text: `${fixed(eu, 0)} ${eu <= 20 ? "good" : eu <= 40 ? "fair" : eu <= 60 ? "moderate" : eu <= 80 ? "poor" : "very poor"}`,
          };
    }),
    field("sun", "Sunrise / sunset", "light_mode", [DAILY], (c) => {
      const d = today(c);
      const up = hm(text(d?.sunrise));
      const down = hm(text(d?.sunset));
      return up && down ? { text: `${up} / ${down}` } : null;
    }),
    field("hourly", "Next hours", "schedule", [HOURLY], () => ({ text: "" })),
    field("daily", "Next days", "calendar_today", [DAILY], () => ({ text: "" })),
    field("updated", "Updated", "refresh", [CURRENT], (c) => {
      const ms = num(cur(c)?.updatedMs);
      return ms === null
        ? null
        : {
            text: new Date(ms).toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
            }),
          };
    }),
  ],
  options: [
    { kind: "location", key: "location", label: "Location", default: "" },
    TEMP_UNIT,
    {
      kind: "enum",
      key: "windUnit",
      label: "Wind units",
      options: [
        { value: "kmh", label: "km/h" },
        { value: "ms", label: "m/s" },
        { value: "mph", label: "mph" },
        { value: "kn", label: "knots" },
      ],
      default: "kmh",
    },
    {
      kind: "enum",
      key: "precipUnit",
      label: "Rain units",
      options: [
        { value: "mm", label: "mm" },
        { value: "in", label: "inches" },
      ],
      default: "mm",
    },
    { kind: "bool", key: "skyScene", label: "Illustrated sky scene", default: true },
    { kind: "bool", key: "showSunArc", label: "Sunrise / sunset arc", default: true },
  ],
  status(c): CardStatus {
    const v = c.get(CURRENT);
    if (v === undefined) return { kind: "loading" };
    const reason = missingReason(v);
    if (reason === "no-location")
      return { kind: "needs-permission", reason: "Choose a location in this widget's settings" };
    return reason
      ? { kind: "unavailable", reason: `Weather unavailable (${reason})` }
      : { kind: "ready" };
  },
  render: (ctx) => <Weather ctx={ctx} />,
  composition: weatherComposition,
  useClassicStat: true,
  compositionTopics(values, content) {
    const shown = new Set(content.fields);
    return {
      ...values,
      wxMeta: {
        kind: "map",
        v: {
          decimals: { kind: "num", v: content.decimals },
          showHourly: { kind: "bool", v: shown.has("hourly") },
          showDaily: { kind: "bool", v: shown.has("daily") },
        },
      },
    };
  },
};

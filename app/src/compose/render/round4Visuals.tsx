// Built-in canvas visuals for Phase 4 Round 4 (Weather 4.12, Calendar 4.13, Docker 4.14, brief §8.1):
// - `weather-scene`: illustrated sky atmosphere (0 idle frames when still/reduced motion), current
//   hero, hourly strip with precip bars, 5–7 day low-to-high range forecast, wind compass, UV,
//   humidity, AQI, and sunrise/sunset arc.
// - `calendar-view`: mini month grid with event color dots + interactive day selection, agenda with
//   live countdown ("In 25 min" / "Happening now"), current-time rule, all-day chips, click-to-expand.
// - `docker-panel`: Compose-project groups, status pills, live CPU/RAM mini bars, port chips,
//   filter pills, Start/Restart/Stop actions, and honest Docker Desktop stopped card.
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../design-system/icons";
import { type Animator, reducedMotion, scheduler } from "../../design-system/motion";
import type { Value } from "../../expr";
import type { Command, CommandResult } from "../../layer/protocol";
import { HostContext } from "../../widgets/host";
import { condition } from "../../widgets/weather";
import type { VisualProps } from "./clockVisuals";
import { useView } from "./context";
import styles from "./round4Visuals.module.css";

const num = (v: Value | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: Value | undefined): string => (typeof v === "string" ? v : "");
const bool = (v: Value | undefined): boolean | null => (typeof v === "boolean" ? v : null);
const isMap = (v: Value | undefined): v is Record<string, Value> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function fmtTemp(c: number, unit: string, decimals = 0): string {
  const v = unit === "f" ? (c * 9) / 5 + 32 : c;
  return `${v.toFixed(decimals)}°`;
}

function fmtWind(kmh: number, unit: string): string {
  const v =
    unit === "ms" ? kmh / 3.6 : unit === "mph" ? kmh / 1.609 : unit === "kn" ? kmh / 1.852 : kmh;
  const u = unit === "ms" ? "m/s" : unit === "mph" ? "mph" : unit === "kn" ? "kn" : "km/h";
  return `${v.toFixed(unit === "ms" ? 1 : 0)} ${u}`;
}

function compassDir(deg: number): string {
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8] ?? "N";
}

function fmtHm(iso: string): string {
  const m = /T(\d\d:\d\d)/.exec(iso);
  return m?.[1] ?? "";
}

function fmtBytes(b: number, binary: boolean): string {
  const base = binary ? 1024 : 1000;
  const units = binary ? ["B", "KiB", "MiB", "GiB", "TiB"] : ["B", "kB", "MB", "GB", "TB"];
  let v = Math.max(0, b);
  let i = 0;
  while (v >= base && i < units.length - 1) {
    v /= base;
    i++;
  }
  return `${v >= 10 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i] ?? "B"}`;
}

function aqiLabel(eu: number): string {
  if (eu <= 20) return "Good";
  if (eu <= 40) return "Fair";
  if (eu <= 60) return "Moderate";
  if (eu <= 80) return "Poor";
  return "Very poor";
}

function uvLabel(uv: number): string {
  if (uv < 3) return "Low";
  if (uv < 6) return "Mod";
  if (uv < 8) return "High";
  return "Very high";
}

/** Sun daylight progress in `[0, 1]` between ISO `sunrise` and `sunset` strings, or null. */
export function sunProgress(sunriseIso: string, sunsetIso: string, now: Date): number | null {
  const up = fmtHm(sunriseIso);
  const down = fmtHm(sunsetIso);
  if (!up || !down) return null;
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  const s = toMin(up);
  const e = toMin(down);
  if (e <= s) return null;
  const cur = now.getHours() * 60 + now.getMinutes();
  return Math.min(1, Math.max(0, (cur - s) / (e - s)));
}

/** Pure helper: live countdown text for an upcoming/ongoing event. */
export function formatCountdown(startMs: number, endMs: number, nowMs: number): string | null {
  if (endMs <= nowMs) return null;
  if (startMs <= nowMs) return "Happening now";
  const mins = Math.max(1, Math.round((startMs - nowMs) / 60_000));
  if (mins < 60) return `In ${String(mins)} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hrs < 24) return rem > 0 ? `In ${String(hrs)} h ${String(rem)} m` : `In ${String(hrs)} h`;
  const days = Math.round(hrs / 24);
  return days === 1 ? "Tomorrow" : `In ${String(days)} d`;
}

/** Builds a 42-cell (6-week) month grid for `year`/`month` (0-indexed month). */
export function buildMonthGrid(
  year: number,
  month: number,
  weekStart: "mon" | "sun" = "mon",
): { year: number; month: number; day: number; outside: boolean; key: string }[] {
  const first = new Date(year, month, 1);
  const rawDow = first.getDay(); // 0=Sun..6=Sat
  const offset = weekStart === "mon" ? (rawDow + 6) % 7 : rawDow;
  const startDate = new Date(year, month, 1 - offset);
  const cells: { year: number; month: number; day: number; outside: boolean; key: string }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i);
    const y = d.getFullYear();
    const m = d.getMonth();
    const day = d.getDate();
    cells.push({
      year: y,
      month: m,
      day,
      outside: m !== month,
      key: `${String(y)}-${String(m)}-${String(day)}`,
    });
  }
  return cells;
}

/* ── 4.12 Weather sky visual ────────────────────────────────────────────────── */

function SkyAtmosphere({
  code,
  isDay,
  animate,
}: {
  code: number | null;
  isDay: boolean;
  animate: boolean;
}) {
  const driftRef = useRef<SVGGElement>(null);
  const isRain =
    code !== null && ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95);
  const isSnow = code !== null && ((code >= 71 && code <= 77) || code === 85 || code === 86);
  const isStorm = code !== null && code >= 95;
  const isCloudy = code !== null && code >= 2;
  const isFog = code === 45 || code === 48;

  useEffect(() => {
    if (!animate || reducedMotion()) return;
    let phase = 0;
    const anim: Animator = {
      ambient: true,
      step(dt) {
        phase = (phase + dt * 0.45) % (Math.PI * 2);
        if (driftRef.current) {
          const dx = Math.sin(phase) * 6;
          driftRef.current.setAttribute("transform", `translate(${dx.toFixed(2)} 0)`);
        }
        return true;
      },
    };
    scheduler.add(anim);
    return () => {
      scheduler.remove(anim);
    };
  }, [animate]);

  const topColor = isStorm
    ? "rgb(36 42 74 / 0.42)"
    : isRain
      ? "rgb(48 82 128 / 0.34)"
      : isDay
        ? "rgb(72 152 240 / 0.28)"
        : "rgb(26 36 82 / 0.42)";
  const botColor = isDay ? "rgb(255 196 112 / 0.08)" : "rgb(66 84 148 / 0.06)";

  return (
    <div className={styles.wxSky} aria-hidden="true">
      <svg className={styles.wxSkySvg} viewBox="0 0 320 200" preserveAspectRatio="none">
        <defs>
          <linearGradient id="wxSkyGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={topColor} />
            <stop offset="100%" stopColor={botColor} />
          </linearGradient>
        </defs>
        <rect width="320" height="200" fill="url(#wxSkyGrad)" />
        {isDay && !isRain && !isStorm ? (
          <g>
            <circle cx="272" cy="38" r="42" fill="rgb(255 214 102 / 0.16)" />
            <circle cx="272" cy="38" r="22" fill="rgb(255 224 128 / 0.34)" />
          </g>
        ) : null}
        {!isDay ? (
          <g fill="rgb(232 240 255 / 0.48)">
            <circle cx="268" cy="34" r="14" opacity="0.55" />
            <circle cx="274" cy="30" r="12" fill="rgb(26 36 82 / 0.9)" />
            <circle cx="48" cy="24" r="1.5" />
            <circle cx="118" cy="36" r="1.2" />
            <circle cx="204" cy="22" r="1.6" />
          </g>
        ) : null}
        <g ref={driftRef}>
          {isCloudy || isFog ? (
            <g fill="rgb(255 255 255 / 0.14)">
              <ellipse cx="236" cy="54" rx="54" ry="18" />
              <ellipse cx="268" cy="48" rx="34" ry="15" />
              <ellipse cx="88" cy="42" rx="44" ry="14" opacity="0.7" />
            </g>
          ) : null}
          {isRain ? (
            <g stroke="rgb(138 202 255 / 0.42)" strokeWidth="1.6" strokeLinecap="round">
              <line x1="76" y1="68" x2="68" y2="96" />
              <line x1="126" y1="64" x2="118" y2="92" />
              <line x1="184" y1="72" x2="176" y2="100" />
              <line x1="240" y1="66" x2="232" y2="94" />
              <line x1="278" y1="74" x2="270" y2="102" />
            </g>
          ) : null}
          {isSnow ? (
            <g fill="rgb(240 248 255 / 0.55)">
              <circle cx="72" cy="72" r="2.5" />
              <circle cx="134" cy="86" r="2" />
              <circle cx="192" cy="70" r="2.6" />
              <circle cx="248" cy="88" r="2.2" />
              <circle cx="284" cy="68" r="2" />
            </g>
          ) : null}
          {isStorm ? (
            <polygon
              points="244,64 234,88 244,88 236,112 256,82 246,82"
              fill="rgb(255 224 102 / 0.72)"
            />
          ) : null}
        </g>
      </svg>
    </div>
  );
}

export function WeatherSceneVisual({ params, animate, label }: VisualProps) {
  const host = useContext(HostContext);
  const now = useMemo(() => host?.now?.() ?? new Date(), [host]);
  const cur = isMap(params.current) ? params.current : null;
  const air = isMap(params.air) ? params.air : null;
  const daily = useMemo(
    () => (Array.isArray(params.daily) ? params.daily.filter(isMap) : []),
    [params.daily],
  );

  const size = str(params.size) || "M";
  const tempUnit = str(params.tempUnit) || "c";
  const windUnit = str(params.windUnit) || "kmh";
  const decimals = num(params.decimals) ?? 0;
  const skyScene = params.skyScene !== false;
  const showHourly = params.showHourly !== false;
  const showDaily = params.showDaily !== false;
  const showSunArc = params.showSunArc !== false;

  const isDay = bool(cur?.isDay) ?? true;
  const code = num(cur?.code);
  const cnd = condition(code, isDay);
  const tempC = num(cur?.tempC);
  const feelsC = num(cur?.feelsC);
  const loc = str(cur?.location);
  const windKmh = num(cur?.windKmh);
  const windDir = num(cur?.windDir);
  const humidity = num(cur?.humidity);
  const today = daily[0] ?? null;
  const hiToday = num(today?.maxC);
  const loToday = num(today?.minC);
  const uv = num(today?.uv);
  const euAqi = num(air?.europeanAqi);
  const sunrise = str(today?.sunrise);
  const sunset = str(today?.sunset);
  const sunFrac = sunProgress(sunrise, sunset, now);

  const isTiny = size === "1x1" || size === "2x1";
  const isCompact = size === "S" || size === "4x1" || isTiny;
  const isLarge = size === "L";

  // Filter upcoming 6 hours relative to location timezone when available.
  const tz = str(cur?.timezone) || undefined;
  const curHourIso = useMemo(() => {
    try {
      return new Intl.DateTimeFormat("sv-SE", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        hourCycle: "h23",
      })
        .format(now)
        .replace(" ", "T");
    } catch {
      return "";
    }
  }, [now, tz]);

  const nextHours = useMemo(() => {
    const hourly = Array.isArray(params.hourly) ? params.hourly.filter(isMap) : [];
    const filtered = curHourIso
      ? hourly.filter((h) => str(h.time).slice(0, 13) >= curHourIso)
      : hourly;
    return (filtered.length > 0 ? filtered : hourly).slice(0, isLarge ? 7 : 5);
  }, [params.hourly, curHourIso, isLarge]);

  const daysList = useMemo(() => daily.slice(0, isLarge ? 6 : 4), [daily, isLarge]);
  const weekMin = Math.min(...daysList.map((d) => num(d.minC) ?? 0), 0);
  const weekMax = Math.max(...daysList.map((d) => num(d.maxC) ?? 1), weekMin + 1);

  return (
    <div className={styles.wxRoot} data-testid="weather-scene" aria-label={label ?? "Weather"}>
      {skyScene ? <SkyAtmosphere code={code} isDay={isDay} animate={animate ?? false} /> : null}

      <div className={styles.wxHero}>
        <div className={styles.wxHeroLeft}>
          <Icon name={cnd.icon} size={isTiny ? 26 : 36} fill={1} />
          <span className={`${styles.wxTemp} ${isTiny ? styles.wxTempSmall : ""}`}>
            {tempC === null ? "—" : fmtTemp(tempC, tempUnit, decimals)}
          </span>
          {size !== "1x1" ? (
            <div className={styles.wxMeta}>
              <span className={styles.wxCond}>{cnd.text}</span>
              <span className={styles.wxLoc}>
                {loc}
                {feelsC !== null && !isTiny ? ` · Feels ${fmtTemp(feelsC, tempUnit, 0)}` : ""}
              </span>
            </div>
          ) : null}
        </div>
        {!isTiny && hiToday !== null && loToday !== null ? (
          <div className={styles.wxHiLo}>
            <span>H {fmtTemp(hiToday, tempUnit, 0)}</span>
            <span>L {fmtTemp(loToday, tempUnit, 0)}</span>
          </div>
        ) : null}
      </div>

      {!isTiny ? (
        <div className={styles.wxPills}>
          {windKmh !== null ? (
            <span className={styles.wxPill} title="Wind">
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                style={{ transform: `rotate(${String(windDir ?? 0)}deg)` }}
                aria-hidden="true"
              >
                <path d="M8 2 L12 13 L8 10.5 L4 13 Z" fill="currentColor" />
              </svg>
              {fmtWind(windKmh, windUnit)}
              {windDir !== null ? ` ${compassDir(windDir)}` : ""}
            </span>
          ) : null}
          {humidity !== null ? (
            <span className={styles.wxPill}>
              <Icon name="water_drop" size={13} />
              {Math.round(humidity)}%
            </span>
          ) : null}
          {uv !== null ? (
            <span className={styles.wxPill}>
              UV {Math.round(uv)} · {uvLabel(uv)}
            </span>
          ) : null}
          {euAqi !== null ? (
            <span className={styles.wxPill}>
              AQI {Math.round(euAqi)} · {aqiLabel(euAqi)}
            </span>
          ) : null}
        </div>
      ) : null}

      {!isCompact && showHourly && nextHours.length > 0 ? (
        <div className={styles.wxHourly} aria-label="Hourly forecast">
          {nextHours.map((h, i) => {
            const hc = condition(num(h.code), num(h.isDay) !== 0);
            const t = num(h.tempC);
            const p = num(h.precipProb) ?? 0;
            return (
              <div key={str(h.time) || String(i)} className={styles.wxHourCol}>
                <span className={styles.wxHourTime}>{fmtHm(str(h.time))}</span>
                <Icon name={hc.icon} size={17} />
                <span className={styles.wxHourTemp}>
                  {t === null ? "—" : fmtTemp(t, tempUnit, 0)}
                </span>
                <span className={styles.wxPrecipBar} title={`Rain ${String(Math.round(p))}%`}>
                  <span
                    className={styles.wxPrecipFill}
                    style={{ width: `${String(Math.min(100, Math.max(0, p)))}%` }}
                  />
                </span>
              </div>
            );
          })}
        </div>
      ) : null}

      {isLarge && showDaily && daysList.length > 0 ? (
        <div className={styles.wxDaily} aria-label="Multi-day forecast">
          {daysList.map((d, i) => {
            const dateStr = str(d.date);
            const dc = condition(num(d.code), true);
            const lo = num(d.minC);
            const hi = num(d.maxC);
            const leftPct = lo !== null ? ((lo - weekMin) / (weekMax - weekMin)) * 100 : 0;
            const widthPct =
              lo !== null && hi !== null
                ? Math.max(8, ((hi - lo) / (weekMax - weekMin)) * 100)
                : 40;
            const dayName =
              i === 0
                ? "Today"
                : dateStr
                  ? new Date(`${dateStr}T12:00:00`).toLocaleDateString(undefined, {
                      weekday: "short",
                    })
                  : "";
            return (
              <div key={dateStr || String(i)} className={styles.wxDayRow}>
                <span className={styles.wxDayName}>{dayName}</span>
                <Icon name={dc.icon} size={16} />
                <span className={styles.wxHourTime}>
                  {lo === null ? "—" : fmtTemp(lo, tempUnit, 0)}
                </span>
                <span className={styles.wxRangeTrack}>
                  <span
                    className={styles.wxRangeFill}
                    style={{ left: `${String(leftPct)}%`, width: `${String(widthPct)}%` }}
                  />
                </span>
                <span className={styles.wxHourTemp}>
                  {hi === null ? "—" : fmtTemp(hi, tempUnit, 0)}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}

      {!isCompact && (sunFrac !== null || isLarge) ? (
        <div className={styles.wxFooterRow}>
          {showSunArc && sunFrac !== null ? (
            <span className={styles.wxSunArc}>
              <span>☀ {fmtHm(sunrise)}</span>
              <svg width="54" height="18" viewBox="0 0 54 18" aria-hidden="true">
                <path
                  d="M 4 15 A 23 23 0 0 1 50 15"
                  fill="none"
                  stroke="currentColor"
                  strokeOpacity="0.32"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <circle
                  cx={27 - Math.cos(sunFrac * Math.PI) * 23}
                  cy={15 - Math.sin(sunFrac * Math.PI) * 13}
                  r="3.2"
                  fill="rgb(255 208 86)"
                />
              </svg>
              <span>{fmtHm(sunset)}</span>
            </span>
          ) : (
            <span />
          )}
          <span className={styles.wxAttr}>Open-Meteo</span>
        </div>
      ) : null}
    </div>
  );
}

/* ── 4.13 Calendar 2.0 visual ───────────────────────────────────────────────── */

interface CalEvent {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  location: string;
  calendar: string;
  color: string | null;
}

function dayKeyFromMs(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getFullYear())}-${String(d.getMonth())}-${String(d.getDate())}`;
}

export function CalendarViewVisual({ params, label }: VisualProps) {
  const host = useContext(HostContext);
  const nowDate = useMemo(() => host?.now?.() ?? new Date(), [host]);
  const nowMs = nowDate.getTime();
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const size = str(params.size) || "M";
  const view = str(params.view) || "auto";
  const weekStart = str(params.weekStart) === "sun" ? "sun" : "mon";
  const daysAhead = Number(str(params.days) || "7");
  const maxEvents = Math.max(1, Math.round(num(params.max) ?? 8));
  const timeFormat = str(params.timeFormat) || "system";
  const showAllDay = params.showAllDay !== false;
  const showColor = params.showColor !== false;
  const showLocation = params.showLocation !== false;
  const showCalendar = params.showCalendar === true;
  const showTime = params.showTime !== false;
  const showEnd = params.showEnd === true;

  const h24 = timeFormat === "24" ? true : timeFormat === "12" ? false : undefined;

  const parsedEvents = useMemo(() => {
    if (!Array.isArray(params.events)) return [];
    const out: CalEvent[] = [];
    for (let i = 0; i < params.events.length; i++) {
      const e = params.events[i];
      if (!isMap(e)) continue;
      const startMs = num(e.startMs);
      if (startMs === null) continue;
      const endMs = num(e.endMs) ?? startMs;
      const allDay = bool(e.allDay) ?? false;
      if (!showAllDay && allDay) continue;
      out.push({
        id: `${String(startMs)}-${str(e.title)}-${String(i)}`,
        title: str(e.title) || "(no title)",
        startMs,
        endMs,
        allDay,
        location: str(e.location),
        calendar: str(e.calendar),
        color: str(e.color) || null,
      });
    }
    out.sort((a, b) => a.startMs - b.startMs);
    return out;
  }, [params.events, showAllDay]);

  const dotsByDay = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const ev of parsedEvents) {
      const k = dayKeyFromMs(ev.startMs);
      const list = map.get(k) ?? [];
      const col = ev.color ?? "rgb(var(--md-primary))";
      if (list.length < 3 && !list.includes(col)) list.push(col);
      map.set(k, list);
    }
    return map;
  }, [parsedEvents]);

  const todayKey = dayKeyFromMs(nowMs);
  const tomorrowKey = dayKeyFromMs(nowMs + 86_400_000);
  const isLarge = size === "L";
  const showMonthGrid = view === "month" ? size !== "2x1" : view === "auto" ? isLarge : false;

  const gridCells = useMemo(
    () => buildMonthGrid(nowDate.getFullYear(), nowDate.getMonth(), weekStart),
    [nowDate, weekStart],
  );

  const visibleEvents = useMemo(() => {
    const list = selectedDay
      ? parsedEvents.filter((e) => dayKeyFromMs(e.startMs) === selectedDay)
      : parsedEvents.filter((e) => e.endMs > nowMs && e.startMs < nowMs + daysAhead * 86_400_000);
    return list.slice(0, isLarge ? maxEvents : Math.min(maxEvents, size === "M" ? 4 : 2));
  }, [parsedEvents, selectedDay, nowMs, daysAhead, isLarge, maxEvents, size]);

  const nextTimed =
    parsedEvents.find((e) => !e.allDay && e.endMs > nowMs) ??
    parsedEvents.find((e) => e.endMs > nowMs);
  const countdown = nextTimed ? formatCountdown(nextTimed.startMs, nextTimed.endMs, nowMs) : null;

  const fmtTime = (ms: number) =>
    new Date(ms).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      ...(h24 === undefined ? {} : { hour12: !h24 }),
    });

  const dayLabel = (k: string, ms: number) => {
    if (k === todayKey) return "Today";
    if (k === tomorrowKey) return "Tomorrow";
    return new Date(ms).toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  };

  const monthHeading = nowDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const weekLabels =
    weekStart === "mon" ? ["M", "T", "W", "T", "F", "S", "S"] : ["S", "M", "T", "W", "T", "F", "S"];

  // Group agenda items by day and insert current-time line once on Today.
  let lastGroup = "";
  let nowLineInserted = false;

  return (
    <div className={styles.calRoot} data-testid="calendar-view" aria-label={label ?? "Calendar"}>
      <div className={styles.calTop}>
        <span className={styles.calDateTitle}>{monthHeading}</span>
        {countdown ? <span className={styles.calCountdown}>{countdown}</span> : null}
      </div>

      <div className={`${styles.calSplit} ${showMonthGrid ? styles.calSplitWide : ""}`}>
        {showMonthGrid ? (
          <div className={styles.calGridWrap} aria-label="Month grid">
            <div className={styles.calWeekHead}>
              {weekLabels.map((w, i) => (
                <span key={`${w}-${String(i)}`}>{w}</span>
              ))}
            </div>
            <div className={styles.calGrid}>
              {gridCells.map((cell) => {
                const isToday = cell.key === todayKey;
                const isSel = cell.key === selectedDay;
                const dots = dotsByDay.get(cell.key) ?? [];
                return (
                  <button
                    key={cell.key}
                    type="button"
                    className={`${styles.calCell} ${cell.outside ? styles.calCellOutside : ""} ${isToday ? styles.calCellToday : ""} ${isSel ? styles.calCellSelected : ""}`}
                    aria-pressed={isSel}
                    onClick={() => {
                      setSelectedDay((prev) => (prev === cell.key ? null : cell.key));
                    }}
                  >
                    <span>{cell.day}</span>
                    <span className={styles.calDots}>
                      {dots.map((col, idx) => (
                        <span
                          key={idx}
                          className={styles.calDot}
                          style={{ background: isToday ? "currentColor" : col }}
                        />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className={styles.calAgenda} aria-label="Upcoming events">
          {visibleEvents.length === 0 ? (
            <div className={styles.calEmpty}>
              {selectedDay
                ? "No events on this day"
                : daysAhead === 1
                  ? "Nothing else today"
                  : `Nothing in the next ${String(daysAhead)} days`}
            </div>
          ) : (
            visibleEvents.map((ev) => {
              const k = dayKeyFromMs(Math.max(ev.startMs, nowMs));
              const showHead = k !== lastGroup && size !== "2x1";
              lastGroup = k;
              const showNowRule =
                !nowLineInserted && k === todayKey && !ev.allDay && ev.startMs > nowMs;
              if (showNowRule) nowLineInserted = true;
              const expanded = expandedId === ev.id;
              return (
                <div key={ev.id}>
                  {showHead ? (
                    <div className={styles.calDayHeading}>{dayLabel(k, ev.startMs)}</div>
                  ) : null}
                  {showNowRule ? (
                    <div className={styles.calNowLine} aria-hidden="true">
                      <span className={styles.calNowDot} />
                      <span className={styles.calNowRule} />
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className={styles.calEventBtn}
                    aria-expanded={expanded}
                    onClick={() => {
                      setExpandedId((prev) => (prev === ev.id ? null : ev.id));
                    }}
                  >
                    <div className={styles.calEventMain}>
                      {showColor ? (
                        <span
                          className={styles.calEventColor}
                          style={{ background: ev.color ?? "rgb(var(--md-primary))" }}
                        />
                      ) : (
                        <span />
                      )}
                      <span className={styles.calEventTitle}>{ev.title}</span>
                      {showTime ? (
                        ev.allDay ? (
                          <span className={styles.calAllDayChip}>All day</span>
                        ) : (
                          <span className={styles.calEventTime}>
                            {fmtTime(ev.startMs)}
                            {showEnd ? `–${fmtTime(ev.endMs)}` : ""}
                          </span>
                        )
                      ) : null}
                    </div>
                    {expanded || (showLocation && ev.location && isLarge) ? (
                      <div className={styles.calEventDetail}>
                        {!ev.allDay ? (
                          <span>
                            {fmtTime(ev.startMs)}–{fmtTime(ev.endMs)}
                          </span>
                        ) : null}
                        {showLocation && ev.location ? <span>{ev.location}</span> : null}
                        {(showCalendar || expanded) && ev.calendar ? (
                          <span>{ev.calendar}</span>
                        ) : null}
                      </div>
                    ) : null}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

/* ── 4.14 Docker / Podman 2.0 visual ────────────────────────────────────────── */

interface DockerRow {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  project: string | null;
  ports: string[];
  cpu: number | null;
  memB: number | null;
  memLimitB: number | null;
}

export function DockerPanelVisual({ params, label }: VisualProps) {
  const { services } = useView();
  const host = useContext(HostContext);
  const [filter, setFilter] = useState<"all" | "running" | "stopped">("all");
  const [asking, setAsking] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const engineState = isMap(params.state) ? params.state : null;
  const engineStatus = str(engineState?.status);
  const engineName = str(engineState?.engine) === "podman" ? "Podman" : "Docker";
  const showStoppedOpt = params.showStopped !== false;
  const allowControls = params.controls !== false;
  const groupByProject = params.groupByProject !== false;
  const binary = params.binary === true;
  const decimals = num(params.decimals) ?? 0;
  const showImage = params.showImage !== false;
  const showCpu = params.showCpu !== false;
  const showMemory = params.showMemory !== false;
  const showStatus = params.showStatus === true;
  const size = str(params.size) || "M";
  const maxRows = size === "L" ? 9 : size === "M" ? 4 : 3;

  const send = (cmd: Command) => {
    const p = services
      ? services.command(cmd)
      : host
        ? host.command(cmd)
        : Promise.resolve({ result: "ok" as const });
    void p
      .then((res: CommandResult) => {
        setErrMsg(res.result === "err" ? res.reason : null);
        services?.releaseFocus();
      })
      .catch(() => {
        setErrMsg("failed");
      });
  };

  const all = useMemo(() => {
    if (!Array.isArray(params.containers)) return [];
    const out: DockerRow[] = [];
    for (const c of params.containers) {
      if (!isMap(c)) continue;
      const ports = Array.isArray(c.ports)
        ? c.ports.filter((p): p is string => typeof p === "string")
        : [];
      out.push({
        id: str(c.id),
        name: (str(c.name) || "?").replace(/^\//, ""),
        image: str(c.image),
        state: str(c.state) || "unknown",
        status: str(c.status),
        project: str(c.project) || null,
        ports,
        cpu: num(c.cpu),
        memB: num(c.memB),
        memLimitB: num(c.memLimitB),
      });
    }
    return out;
  }, [params.containers]);

  if (engineStatus === "desktop-stopped") {
    return (
      <div className={styles.dkRoot} data-testid="docker-panel" aria-label={label ?? "Docker"}>
        <div className={styles.dkStoppedCard}>
          <Icon name="deployed_code" size={28} />
          <div>Docker Desktop is stopped</div>
          <button
            type="button"
            className={styles.dkStartDesktopBtn}
            onClick={() => {
              send({ cmd: "start-docker-desktop" });
            }}
          >
            <Icon name="play_arrow" size={16} />
            Start Docker Desktop
          </button>
          {errMsg ? <div role="status">{errMsg}</div> : null}
        </div>
      </div>
    );
  }

  const runningCount = all.filter((c) => c.state === "running").length;
  const filtered = all
    .filter((c) => {
      if (!showStoppedOpt && c.state !== "running") return false;
      if (filter === "running") return c.state === "running";
      if (filter === "stopped") return c.state !== "running";
      return true;
    })
    .sort(
      (a, b) =>
        (a.state === "running" ? 0 : 1) - (b.state === "running" ? 0 : 1) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, maxRows);

  // Group by Compose project when enabled and at least one container has a project.
  const hasProjects = groupByProject && filtered.some((c) => c.project !== null);
  const groups: { name: string; items: DockerRow[] }[] = [];
  if (hasProjects) {
    const map = new Map<string, DockerRow[]>();
    for (const c of filtered) {
      const key = c.project ?? "Standalone";
      const list = map.get(key) ?? [];
      list.push(c);
      map.set(key, list);
    }
    for (const [name, items] of map) groups.push({ name, items });
  } else {
    groups.push({ name: "", items: filtered });
  }

  const maxMem = Math.max(1, ...filtered.map((c) => c.memB ?? 0));

  return (
    <div className={styles.dkRoot} data-testid="docker-panel" aria-label={label ?? "Docker"}>
      <div className={styles.dkToolbar}>
        <span className={styles.dkSummary}>
          <Icon name="deployed_code" size={15} />
          {engineName}
          <span className={styles.dkCountPill}>
            {runningCount}/{all.length}
          </span>
        </span>
        {size !== "S" && size !== "4x1" ? (
          <div className={styles.dkFilters} role="group" aria-label="Container filter">
            {(["all", "running", "stopped"] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={`${styles.dkFilterBtn} ${filter === f ? styles.dkFilterActive : ""}`}
                onClick={() => {
                  setFilter(f);
                }}
              >
                {f === "all" ? "All" : f === "running" ? "Run" : "Stop"}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <div className={styles.calEmpty}>
          {filter === "running" ? "No running containers" : "No containers"}
        </div>
      ) : (
        <div className={styles.dkGroups}>
          {groups.map((grp) => (
            <div key={grp.name || "all"}>
              {grp.name ? (
                <div className={styles.dkGroupHead}>
                  <span className={styles.dkGroupLeft}>
                    <Icon name="stacks" size={13} />
                    {grp.name}
                  </span>
                  <span>
                    {grp.items.filter((i) => i.state === "running").length}/{grp.items.length}
                  </span>
                </div>
              ) : null}
              <ul className={styles.dkList}>
                {grp.items.map((c) => {
                  const running = c.state === "running";
                  const dotClass = running
                    ? styles.dkStateRunning
                    : c.state === "paused"
                      ? styles.dkStatePaused
                      : styles.dkStateExited;
                  const memPct =
                    c.memB !== null
                      ? Math.min(100, Math.max(4, (c.memB / (c.memLimitB ?? maxMem)) * 100))
                      : 0;
                  const trigger = (action: "start" | "stop" | "restart") => {
                    const key = `${c.id}:${action}`;
                    if (action !== "start" && asking !== key) {
                      setAsking(key);
                      return;
                    }
                    setAsking(null);
                    send({ cmd: "container", id: c.id, action });
                  };
                  return (
                    <li key={c.id || c.name} className={styles.dkRow}>
                      <span
                        className={`${styles.dkStatePill} ${dotClass}`}
                        aria-label={c.state}
                        title={c.status || c.state}
                      />
                      <div className={styles.dkInfo}>
                        <div className={styles.dkNameLine}>
                          <span className={styles.dkName}>{c.name}</span>
                          {c.ports[0] ? (
                            <span className={styles.dkPortChip}>{c.ports[0]}</span>
                          ) : null}
                        </div>
                        <div className={styles.dkSubLine}>
                          {showImage && c.image ? <span>{c.image}</span> : null}
                          {showStatus && c.status ? <span>· {c.status}</span> : null}
                        </div>
                        {running &&
                        (showCpu || showMemory) &&
                        (c.cpu !== null || c.memB !== null) ? (
                          <div className={styles.dkMiniBars}>
                            {showCpu && c.cpu !== null ? (
                              <span className={styles.dkBarWrap}>
                                <span>{c.cpu.toFixed(decimals)}%</span>
                                <span className={styles.dkBarTrack}>
                                  <span
                                    className={styles.dkBarFill}
                                    style={{ width: `${String(Math.min(100, c.cpu))}%` }}
                                  />
                                </span>
                              </span>
                            ) : null}
                            {showMemory && c.memB !== null ? (
                              <span className={styles.dkBarWrap}>
                                <span>{fmtBytes(c.memB, binary)}</span>
                                <span className={styles.dkBarTrack}>
                                  <span
                                    className={styles.dkBarFill}
                                    style={{ width: `${String(memPct)}%` }}
                                  />
                                </span>
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      {allowControls ? (
                        <div className={styles.dkActions}>
                          {running ? (
                            <>
                              <button
                                type="button"
                                className={`${styles.dkBtn} ${asking === `${c.id}:restart` ? styles.dkBtnAsk : ""}`}
                                aria-label={`Restart ${c.name}`}
                                onBlur={() => {
                                  if (asking === `${c.id}:restart`) setAsking(null);
                                }}
                                onClick={() => {
                                  trigger("restart");
                                }}
                              >
                                {asking === `${c.id}:restart` ? (
                                  "Restart?"
                                ) : (
                                  <Icon name="restart_alt" size={14} />
                                )}
                              </button>
                              <button
                                type="button"
                                className={`${styles.dkBtn} ${asking === `${c.id}:stop` ? styles.dkBtnAsk : ""}`}
                                aria-label={`Stop ${c.name}`}
                                onBlur={() => {
                                  if (asking === `${c.id}:stop`) setAsking(null);
                                }}
                                onClick={() => {
                                  trigger("stop");
                                }}
                              >
                                {asking === `${c.id}:stop` ? (
                                  "Stop?"
                                ) : (
                                  <Icon name="stop" size={14} />
                                )}
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className={styles.dkBtn}
                              aria-label={`Start ${c.name}`}
                              onClick={() => {
                                trigger("start");
                              }}
                            >
                              <Icon name="play_arrow" size={14} />
                            </button>
                          )}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
      {errMsg ? (
        <div className={styles.dkSubLine} role="status">
          {errMsg}
        </div>
      ) : null}
    </div>
  );
}

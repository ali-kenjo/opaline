// Clock visuals for the composition `canvas` block (PLAN-2 4.1, brief §8.1):
// - `analog-clock`: 6 dial styles (minimal, classic, numerals, roman, chronograph, railway),
//   per-element colors (handColor, tickColor, numeralColor), second-hand modes (tick/sweep/hide).
// - `clock-face`: stacked digital, expressive Material shapes, flip, word, typographic,
//   7-segment LCD, binary BCD, terminal (`date` style), day-ring, and big-date tile.
import { useEffect, useRef } from "react";
import { reducedMotion, scheduler } from "../../design-system/motion/scheduler";
import { cubicsToPath, materialShape } from "../../design-system/shapes";
import type { Value } from "../../expr";
import { cssColor } from "./context";
import styles from "./visuals.module.css";

export interface VisualProps {
  params: Readonly<Record<string, Value>>;
  label: string | undefined;
  animate?: boolean;
}

const str = (v: Value | undefined) => (typeof v === "string" ? v : undefined);
const bool = (v: Value | undefined) => v === true;

/** Hour (0-23), minute, second, weekday, day, month, year, tz short of `ms` in a zone. */
export function clockParts(ms: number, zone: string | undefined) {
  let parts: Intl.DateTimeFormatPart[];
  const opts: Intl.DateTimeFormatOptions = {
    ...(zone ? { timeZone: zone } : {}),
    year: "numeric",
    month: "short",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
    timeZoneName: "short",
  };
  try {
    parts = new Intl.DateTimeFormat("en-GB", opts).formatToParts(ms);
  } catch {
    parts = new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: undefined }).formatToParts(ms);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const num = (t: string) => Number(get(t)) || 0;
  return {
    h: num("hour"),
    m: num("minute"),
    s: num("second"),
    day: num("day"),
    month: get("month"),
    year: get("year"),
    weekday: get("weekday"),
    tz: get("timeZoneName"),
  };
}

/** Converts hour (0-23) + minute (0-59) into natural English words for the Word clock face. */
export function timeToWords(h24: number, m: number): { lead: string; main: string; sub?: string } {
  const HOURS = [
    "twelve",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
  ];
  const rounded = Math.round(m / 5) * 5;
  const pastHalf = rounded > 30;
  const hourIdx = (pastHalf ? h24 + 1 : h24) % 12;
  const hourWord = HOURS[hourIdx] ?? "twelve";
  const period = h24 < 12 ? "in the morning" : h24 < 18 ? "in the afternoon" : "in the evening";

  if (rounded === 0 || rounded === 60) {
    return { lead: "It is", main: `${hourWord} o'clock`, sub: period };
  }
  const phrases: Record<number, string> = {
    5: "five past",
    10: "ten past",
    15: "quarter past",
    20: "twenty past",
    25: "twenty-five past",
    30: "half past",
    35: "twenty-five to",
    40: "twenty to",
    45: "quarter to",
    50: "ten to",
    55: "five to",
  };
  return { lead: "It is", main: `${phrases[rounded] ?? ""} ${hourWord}`.trim(), sub: period };
}

const ROMAN = ["XII", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI"];

export function AnalogClock({ params, label, animate = false }: VisualProps) {
  const ms = params.ms;
  const secondRef = useRef<SVGLineElement>(null);
  const lolliRef = useRef<SVGCircleElement>(null);
  const dialStyle = str(params.dialStyle) ?? "minimal";
  const secondHandMode = str(params.secondHand) ?? "tick";
  const seconds = bool(params.seconds) && secondHandMode !== "hide";
  const handColor = cssColor(params.handColor ?? null);
  const tickColor = cssColor(params.tickColor ?? null);
  const numeralColor = cssColor(params.numeralColor ?? null);
  const sweep = seconds && secondHandMode === "sweep" && animate && !reducedMotion();

  useEffect(() => {
    if (!sweep) return;
    const isRailway = dialStyle === "railway";
    const len = isRailway ? 32 : 38;
    const animator = {
      ambient: true,
      step() {
        const now = Date.now();
        const sec = (now % 60_000) / 1000;
        const rad = (sec * 6 * Math.PI) / 180;
        const x2 = 50 + len * Math.sin(rad);
        const y2 = 50 - len * Math.cos(rad);
        secondRef.current?.setAttribute("x2", x2.toFixed(2));
        secondRef.current?.setAttribute("y2", y2.toFixed(2));
        if (isRailway && lolliRef.current) {
          lolliRef.current.setAttribute("cx", (50 + 28 * Math.sin(rad)).toFixed(2));
          lolliRef.current.setAttribute("cy", (50 - 28 * Math.cos(rad)).toFixed(2));
        }
        return true;
      },
    };
    scheduler.add(animator);
    return () => {
      scheduler.remove(animator);
    };
  }, [sweep, dialStyle]);

  if (typeof ms !== "number") return null;
  const { h, m, s, day } = clockParts(ms, str(params.zone));
  const secFrac = secondHandMode === "sweep" ? s + (ms % 1000) / 1000 : s;
  const hourDeg = ((h % 12) + m / 60) * 30;
  const minDeg = (m + secFrac / 60) * 6;
  const secDeg = secFrac * 6;

  const hand = (
    deg: number,
    len: number,
    w: number,
    cls: string | undefined,
    opts?: {
      back?: number;
      cap?: "round" | "butt";
      color?: string | undefined;
    },
  ) => {
    const rad = (deg * Math.PI) / 180;
    const back = opts?.back ?? 0;
    return (
      <line
        x1={50 - back * Math.sin(rad)}
        y1={50 + back * Math.cos(rad)}
        x2={50 + len * Math.sin(rad)}
        y2={50 - len * Math.cos(rad)}
        strokeWidth={w}
        strokeLinecap={opts?.cap ?? "round"}
        className={cls}
        style={opts?.color ? { stroke: opts.color } : undefined}
      />
    );
  };

  const secRad = (secDeg * Math.PI) / 180;

  // Preserve the exact minimal SVG structure for the existing Classic Lab baseline.
  if (dialStyle === "minimal") {
    return (
      <svg viewBox="0 0 100 100" className={styles.analog} role="img" aria-label={label}>
        <circle cx="50" cy="50" r="47" className={styles.face} />
        {Array.from({ length: 12 }, (_, i) => (
          <circle
            key={i}
            cx={50 + 40 * Math.sin((i * Math.PI) / 6)}
            cy={50 - 40 * Math.cos((i * Math.PI) / 6)}
            r={i % 3 === 0 ? 2.2 : 1.2}
            className={styles.tick}
            style={tickColor ? { fill: tickColor } : undefined}
          />
        ))}
        {hand(hourDeg, 24, 5, styles.hourHand, { color: handColor })}
        {hand(minDeg, 34, 3.5, styles.minuteHand, { color: handColor })}
        {seconds ? (
          <line
            ref={secondRef}
            x1="50"
            y1="50"
            x2={50 + 38 * Math.sin(secRad)}
            y2={50 - 38 * Math.cos(secRad)}
            strokeWidth={1.5}
            strokeLinecap="round"
            className={styles.secondHand}
          />
        ) : null}
        <circle cx="50" cy="50" r="3" className={styles.pin} />
      </svg>
    );
  }

  const isRailway = dialStyle === "railway";
  const isChrono = dialStyle === "chronograph";
  const isRoman = dialStyle === "roman";
  const isNumerals = dialStyle === "numerals";

  return (
    <svg viewBox="0 0 100 100" className={styles.analog} role="img" aria-label={label}>
      <circle cx="50" cy="50" r="47" className={styles.face} />
      {/* 60 minute ticks for classic, chronograph, and railway */}
      {dialStyle === "classic" || isChrono || isRailway
        ? Array.from({ length: 60 }, (_, i) => {
            const major = i % 5 === 0;
            const rad = (i * 6 * Math.PI) / 180;
            const rOuter = 44;
            const rInner = major ? (isRailway ? 34 : 37) : isRailway ? 40.5 : 41.5;
            return (
              <line
                key={i}
                x1={50 + rInner * Math.sin(rad)}
                y1={50 - rInner * Math.cos(rad)}
                x2={50 + rOuter * Math.sin(rad)}
                y2={50 - rOuter * Math.cos(rad)}
                strokeWidth={major ? (isRailway ? 3.2 : 2) : 0.85}
                strokeLinecap={isRailway ? "butt" : "round"}
                className={styles.tickLine}
                style={tickColor ? { stroke: tickColor } : undefined}
              />
            );
          })
        : Array.from({ length: 12 }, (_, i) => {
            const rad = (i * 30 * Math.PI) / 180;
            return (
              <line
                key={i}
                x1={50 + 40 * Math.sin(rad)}
                y1={50 - 40 * Math.cos(rad)}
                x2={50 + 44 * Math.sin(rad)}
                y2={50 - 44 * Math.cos(rad)}
                strokeWidth={i % 3 === 0 ? 1.8 : 1}
                strokeLinecap="round"
                className={styles.tickLine}
                style={tickColor ? { stroke: tickColor } : undefined}
              />
            );
          })}

      {/* Numerals / Roman */}
      {isNumerals || isRoman
        ? Array.from({ length: 12 }, (_, i) => {
            if (!isNumerals && i % 3 !== 0 && i % 1 !== 0) return null;
            const rad = (i * 30 * Math.PI) / 180;
            const r = 33.5;
            const txt = isRoman ? ROMAN[i] : String(i === 0 ? 12 : i);
            return (
              <text
                key={i}
                x={50 + r * Math.sin(rad)}
                y={50 - r * Math.cos(rad) + 3}
                className={isRoman ? styles.romanNum : styles.dialNum}
                style={numeralColor ? { fill: numeralColor } : undefined}
              >
                {txt}
              </text>
            );
          })
        : null}

      {/* Classic date window at 3 o'clock */}
      {dialStyle === "classic" ? (
        <g>
          <rect x="65" y="44" width="14" height="12" rx="2.5" className={styles.dateWin} />
          <text x="72" y="52.5" className={styles.dateWinText}>
            {day}
          </text>
        </g>
      ) : null}

      {/* Chronograph sub-dials: 24-hour left (9 o'clock), running seconds bottom (6 o'clock) */}
      {isChrono ? (
        <g>
          <circle cx="32" cy="50" r="10.5" className={styles.subDial} />
          <circle cx="50" cy="68" r="10.5" className={styles.subDial} />
          <line
            x1="32"
            y1="50"
            x2={32 + 7 * Math.sin(((h + m / 60) * 15 * Math.PI) / 180)}
            y2={50 - 7 * Math.cos(((h + m / 60) * 15 * Math.PI) / 180)}
            strokeWidth="1.4"
            strokeLinecap="round"
            className={styles.secondHand}
          />
          <line
            x1="50"
            y1="68"
            x2={50 + 7 * Math.sin((secDeg * Math.PI) / 180)}
            y2={68 - 7 * Math.cos((secDeg * Math.PI) / 180)}
            strokeWidth="1.3"
            strokeLinecap="round"
            className={styles.secondHand}
          />
          <rect x="66" y="45" width="12" height="10" rx="2" className={styles.dateWin} />
          <text x="72" y="52" className={styles.dateWinText}>
            {day}
          </text>
        </g>
      ) : null}

      {/* Hands */}
      {hand(hourDeg, isRailway ? 26 : 24, isRailway ? 5.2 : 4.6, styles.hourHand, {
        back: isRailway ? 8 : 5,
        cap: isRailway ? "butt" : "round",
        color: handColor,
      })}
      {hand(minDeg, isRailway ? 38 : 35, isRailway ? 3.8 : 3.2, styles.minuteHand, {
        back: isRailway ? 10 : 6,
        cap: isRailway ? "butt" : "round",
        color: handColor,
      })}
      {seconds ? (
        <>
          <line
            ref={secondRef}
            x1={50 - 10 * Math.sin(secRad)}
            y1={50 + 10 * Math.cos(secRad)}
            x2={50 + (isRailway ? 32 : 39) * Math.sin(secRad)}
            y2={50 - (isRailway ? 32 : 39) * Math.cos(secRad)}
            strokeWidth={1.4}
            strokeLinecap="round"
            className={styles.secondHand}
          />
          {isRailway ? (
            <circle
              ref={lolliRef}
              cx={50 + 28 * Math.sin(secRad)}
              cy={50 - 28 * Math.cos(secRad)}
              r="3.2"
              className={styles.railwayDot}
            />
          ) : null}
        </>
      ) : null}
      <circle cx="50" cy="50" r={isRailway ? 2.5 : 3} className={styles.pin} />
    </svg>
  );
}

/** 7-segment bitmask for digits 0-9: [a,b,c,d,e,f,g] (top, TR, BR, bottom, BL, TL, mid). */
const SEG_BITS: Record<string, number> = {
  "0": 0b1111110,
  "1": 0b0110000,
  "2": 0b1101101,
  "3": 0b1111001,
  "4": 0b0110011,
  "5": 0b1011011,
  "6": 0b1011111,
  "7": 0b1110000,
  "8": 0b1111111,
  "9": 0b1111011,
};

function SevenSegDigit({ ch, color }: { ch: string; color?: string | undefined }) {
  const mask = SEG_BITS[ch] ?? 0;
  const segs: [number, string][] = [
    [6, "M4 2 H20 L18 5 H6 Z"],
    [5, "M21 3 L23 5 V18 L20 20 L18 18 V6 Z"],
    [4, "M20 22 L23 24 V37 L21 39 L18 36 V24 Z"],
    [3, "M6 37 H18 L20 40 H4 Z"],
    [2, "M4 22 L6 24 V36 L3 39 L1 37 V24 Z"],
    [1, "M3 3 L6 6 V18 L4 20 L1 18 V5 Z"],
    [0, "M5 21 L7 19 H17 L19 21 L17 23 H7 Z"],
  ];
  return (
    <svg viewBox="0 0 24 42" className={styles.segDigit} aria-hidden>
      {segs.map(([bit, d]) => {
        const on = ((mask >> bit) & 1) === 1;
        return (
          <path
            key={bit}
            d={d}
            className={on ? styles.segOn : styles.segOff}
            style={on && color ? { fill: color } : undefined}
          />
        );
      })}
    </svg>
  );
}

/** All specialty clock faces (stacked, expressive, flip, word, typographic, segment, binary, terminal, day-ring, big-date). */
export function ClockFace({ params, label }: VisualProps) {
  const ms = params.ms;
  if (typeof ms !== "number") return null;
  const face = str(params.face) ?? "stacked";
  const h24 = params.h24 !== false;
  const seconds = bool(params.seconds);
  const zone = str(params.zone);
  const dateText = str(params.dateText) ?? "";
  const numeralColor = cssColor(params.numeralColor ?? null);
  const { h, m, s, day, month, year, weekday, tz } = clockParts(ms, zone);
  const displayH = h24 ? h : h % 12 || 12;
  const hh = String(displayH).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  const ampm = h24 ? "" : h < 12 ? "AM" : "PM";
  const numStyle = numeralColor ? { color: numeralColor } : undefined;

  switch (face) {
    case "stacked":
      return (
        <div className={styles.stackedWrap} role="img" aria-label={label}>
          <div className={styles.stackedDigits} style={numStyle}>
            <span className={styles.stackedRow}>{hh}</span>
            <span className={styles.stackedRow}>{mm}</span>
          </div>
          {dateText ? <span className={styles.faceMeta}>{dateText}</span> : null}
        </div>
      );

    case "expressive": {
      const hourPath = cubicsToPath(materialShape("cookie7Sided").cubics, 100);
      const minPath = cubicsToPath(materialShape("clover4Leaf").cubics, 100);
      return (
        <div className={styles.expressiveWrap} role="img" aria-label={label}>
          <div className={styles.shapeTile}>
            <svg viewBox="0 0 100 100" className={styles.shapeBg} aria-hidden>
              <path d={hourPath} className={styles.shapePrimary} />
            </svg>
            <span className={styles.shapeDigit} style={numStyle}>
              {hh}
            </span>
          </div>
          <div className={styles.shapeTile}>
            <svg viewBox="0 0 100 100" className={styles.shapeBg} aria-hidden>
              <path d={minPath} className={styles.shapeSecondary} />
            </svg>
            <span className={styles.shapeDigitAlt} style={numStyle}>
              {mm}
            </span>
          </div>
        </div>
      );
    }

    case "flip":
      return (
        <div className={styles.flipWrap} role="img" aria-label={label}>
          <div className={styles.flipTile}>
            <span className={styles.flipDigit} style={numStyle}>
              {hh}
            </span>
            <span className={styles.flipHinge} aria-hidden />
          </div>
          <div className={styles.flipTile}>
            <span className={styles.flipDigit} style={numStyle}>
              {mm}
            </span>
            <span className={styles.flipHinge} aria-hidden />
          </div>
          {seconds ? (
            <div className={`${styles.flipTile ?? ""} ${styles.flipSmall ?? ""}`}>
              <span className={styles.flipDigit} style={numStyle}>
                {ss}
              </span>
              <span className={styles.flipHinge} aria-hidden />
            </div>
          ) : null}
        </div>
      );

    case "word": {
      const w = timeToWords(h, m);
      return (
        <div className={styles.wordWrap} role="img" aria-label={label}>
          <span className={styles.wordLead}>{w.lead}</span>
          <span className={styles.wordMain} style={numStyle}>
            {w.main}
          </span>
          {w.sub ? <span className={styles.wordSub}>{w.sub}</span> : null}
        </div>
      );
    }

    case "typographic":
      return (
        <div className={styles.typoWrap} role="img" aria-label={label}>
          <span className={styles.typoHour} style={numStyle}>
            {hh}
          </span>
          <div className={styles.typoSide}>
            <span className={styles.typoMin} style={numStyle}>
              :{mm}
              {seconds ? `:${ss}` : ""}
            </span>
            {ampm ? <span className={styles.faceMeta}>{ampm}</span> : null}
            <span className={styles.faceMeta}>
              {weekday} {day} {month}
            </span>
          </div>
        </div>
      );

    case "segment": {
      const digits = seconds ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
      return (
        <div className={styles.segWrap} role="img" aria-label={label}>
          {digits.split("").map((ch, idx) =>
            ch === ":" ? (
              <span key={idx} className={styles.segColon} style={numStyle} aria-hidden>
                :
              </span>
            ) : (
              <SevenSegDigit key={idx} ch={ch} color={numeralColor} />
            ),
          )}
        </div>
      );
    }

    case "binary": {
      const cols = seconds
        ? [
            Math.floor(displayH / 10),
            displayH % 10,
            Math.floor(m / 10),
            m % 10,
            Math.floor(s / 10),
            s % 10,
          ]
        : [Math.floor(displayH / 10), displayH % 10, Math.floor(m / 10), m % 10];
      return (
        <div className={styles.binWrap} role="img" aria-label={label}>
          {cols.map((digit, ci) => (
            <div key={ci} className={styles.binCol}>
              {[8, 4, 2, 1].map((bit) => {
                const on = (digit & bit) !== 0;
                return (
                  <span
                    key={bit}
                    className={on ? styles.binOn : styles.binOff}
                    style={on && numeralColor ? { background: numeralColor } : undefined}
                  />
                );
              })}
            </div>
          ))}
        </div>
      );
    }

    case "terminal":
      return (
        <div className={styles.termWrap} role="img" aria-label={label}>
          <span className={styles.termPrompt}>$ date</span>
          <span className={styles.termLine} style={numStyle}>
            {hh}:{mm}
            {seconds ? `:${ss}` : ""} {tz}
          </span>
          <span className={styles.termSub}>
            {weekday} {day} {month} {year}
          </span>
        </div>
      );

    case "day-ring": {
      const progress = (h * 3600 + m * 60 + s) / 86400;
      const r = 42;
      const circ = 2 * Math.PI * r;
      const dash = circ * progress;
      return (
        <div className={styles.dayRingWrap} role="img" aria-label={label}>
          <svg viewBox="0 0 100 100" className={styles.dayRingSvg} aria-hidden>
            <circle cx="50" cy="50" r={r} className={styles.dayTrack} />
            <circle
              cx="50"
              cy="50"
              r={r}
              className={styles.dayValue}
              strokeDasharray={`${dash.toFixed(2)} ${circ.toFixed(2)}`}
              transform="rotate(-90 50 50)"
              style={numeralColor ? { stroke: numeralColor } : undefined}
            />
          </svg>
          <div className={styles.dayRingText}>
            <span className={styles.dayRingTime} style={numStyle}>
              {hh}:{mm}
            </span>
            <span className={styles.dayRingPct}>{Math.round(progress * 100)}% of day</span>
          </div>
        </div>
      );
    }

    case "big-date":
      return (
        <div className={styles.bigDateWrap} role="img" aria-label={label}>
          <div className={styles.bigDateHead}>
            <span className={styles.bigDateMonth}>{month}</span>
            <span className={styles.bigDateWeek}>{weekday}</span>
          </div>
          <span className={styles.bigDateNum} style={numStyle}>
            {day}
          </span>
          <span className={styles.bigDateTime}>
            {hh}:{mm}
            {ampm ? ` ${ampm}` : ""}
          </span>
        </div>
      );

    default:
      return null;
  }
}

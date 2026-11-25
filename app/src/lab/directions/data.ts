// P1 task 1.1: one fixed moment, shown by all three visual directions so they can be compared
// fairly. Mock data only (this is the Lab, never the product).
import { Blend, Hct, argbFromHex } from "@material/material-color-utilities";

export const SNAPSHOT = {
  clock: {
    hours: "10",
    minutes: "09",
    weekday: "Monday",
    date: "23 November",
    secondZone: { city: "New York", time: "04:09" },
    /** For analog faces: 10:09:30. */
    angles: { hour: (10 % 12) * 30 + 9 * 0.5, minute: 9 * 6 + 3, second: 30 * 6 },
  },
  cpu: {
    load: 43,
    temp: 57,
    freqGhz: "2.9",
    cores: [51, 40, 57, 37, 45, 42, 48, 39],
    /** The last 15 minutes, one point per 30 s (oldest first). */
    history: [
      22, 25, 31, 28, 24, 26, 35, 41, 38, 33, 30, 36, 44, 52, 47, 40, 37, 39, 45, 49, 43, 38, 35,
      41, 46, 50, 44, 40, 42, 43,
    ],
  },
  weather: {
    temp: 7,
    condition: "Partly cloudy",
    place: "Berlin",
    high: 8,
    low: 1,
    sunrise: "07:42",
    sunset: "16:03",
    /** Share of daylight passed (for the sun arc). */
    dayProgress: 0.29,
    hourly: [
      { time: "11", temp: 6, rain: 10, kind: "partly" },
      { time: "12", temp: 7, rain: 10, kind: "partly" },
      { time: "13", temp: 8, rain: 15, kind: "cloud" },
      { time: "14", temp: 8, rain: 20, kind: "cloud" },
      { time: "15", temp: 8, rain: 35, kind: "cloud" },
      { time: "16", temp: 7, rain: 60, kind: "rain" },
      { time: "17", temp: 6, rain: 65, kind: "rain" },
    ] as const,
  },
  media: {
    title: "Glass Hours",
    artist: "The Opaline Ensemble",
    elapsed: "1:37",
    remaining: "−2:28",
    total: "4:05",
    progress: 97 / 245,
  },
} as const;

/** A widget kind's own colors, harmonized with the wallpaper's source color (DESIGN-2 §6.2). */
export interface KindColors {
  /** Glass tint, 0–255 RGB. */
  tint: [number, number, number];
  /** A filled container (shape badges, chips). */
  container: string;
  onContainer: string;
  /** Strong accent for marks, arcs and lines. */
  accent: string;
  /** Text on the accent. */
  onAccent: string;
}

function rgb(argb: number): [number, number, number] {
  return [(argb >> 16) & 255, (argb >> 8) & 255, argb & 255];
}

function css(argb: number): string {
  const [r, g, b] = rgb(argb);
  return `rgb(${String(r)} ${String(g)} ${String(b)})`;
}

export function kindColors(hex: string, source: number, dark: boolean): KindColors {
  const hct = Hct.fromInt(Blend.harmonize(argbFromHex(hex), source));
  const hue = hct.hue;
  const chroma = Math.max(40, hct.chroma);
  return {
    tint: rgb(Hct.from(hue, Math.min(chroma, 28), dark ? 22 : 92).toInt()),
    container: css(Hct.from(hue, chroma, dark ? 78 : 86).toInt()),
    onContainer: css(Hct.from(hue, Math.min(chroma, 36), dark ? 18 : 14).toInt()),
    accent: css(Hct.from(hue, chroma + 10, dark ? 76 : 48).toInt()),
    onAccent: css(Hct.from(hue, Math.min(chroma, 20), dark ? 14 : 98).toInt()),
  };
}

/** The design colors each kind starts from (CPU thermal, weather sun and sky, media from art). */
export const KIND_HEX = {
  clock: "#8f7cf0",
  cpu: "#f2903a",
  sun: "#ffb648",
  sky: "#6aa8ff",
  media: "#e0609a",
} as const;

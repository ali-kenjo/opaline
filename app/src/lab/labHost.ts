// The Lab's widget host: mock sensor values (moving unless ?still) and settings kept in memory
// with the same merge-patch semantics as core. Real data only in the product; mocks only here.
import { create } from "zustand";
import type { Value } from "../layer/protocol";
import type { StoredSettings } from "../widgets/host";

const n = (v: number): Value => ({ kind: "num", v });
const ns = (v: number[]): Value => ({ kind: "nums", v });
const m = (v: Record<string, Value>): Value => ({ kind: "map", v });
const t = (v: string): Value => ({ kind: "text", v });
const b = (v: boolean): Value => ({ kind: "bool", v });

export function mockValues(load: number): Record<string, Value> {
  const temp = 38 + load * 0.45;
  return {
    "cpu.load": n(load),
    "cpu.temp": n(Math.round(temp)),
    "cpu.freq": n(1800 + load * 26),
    "cpu.perThread": ns(
      [load + 8, load - 3, load + 14, load - 6, load + 2, load - 1, load + 5, load - 4].map((x) =>
        Math.max(0, Math.min(100, x)),
      ),
    ),
    "cpu.packagePower": n(4 + load * 0.38),
    "cpu.pressure": m({ some10: n(load / 20), some60: n(load / 25), some300: n(load / 30) }),
    "cpu.throttle": m({ active: b(load > 92), certain: b(true) }),
    "cpu.info": m({
      model: t("Intel(R) Core(TM) i5-10300H CPU @ 2.50GHz"),
      cores: n(4),
      threads: n(8),
      maxMHz: n(4500),
      minMHz: n(800),
      governor: t("powersave"),
    }),
    "system.loadavg": ns([load / 30, load / 34, load / 40]),
    "clock.settings": m({
      format24h: b(true),
      showSeconds: b(false),
      timezone: t("Europe/Berlin"),
      weekStart: n(1),
    }),
  };
}

export const useLabValues = create<{ values: Readonly<Record<string, Value>> }>()(() => ({
  values: mockValues(42.5),
}));

/** Lab instances: every size, a few content choices, and two strong custom styles. */
export const LAB_SETTINGS: StoredSettings = {
  style: {},
  styles: {
    Night: { theme: "dark", transparency: 30, accentColor: "#8ab4f8", heroColor: "accent" },
  },
  widgets: {
    "clock-m": { kind: "clock" },
    "cpu-s": { kind: "cpu" },
    "cpu-m": {
      kind: "cpu",
      content: { fields: ["load", "temp", "freq", "busiest", "power", "pressure"] },
    },
    "cpu-1x1": { kind: "cpu" },
    "clock-2x1": { kind: "clock", content: { fields: ["time"] } },
    "cpu-4x1": { kind: "cpu", content: { heroStyle: "bar", fields: ["load", "temp", "freq"] } },
    "clock-analog": {
      kind: "clock",
      content: {
        face: "analog",
        fields: ["time", "weekday", "date", "zone2"],
        zone2: "America/New_York",
        zone2Label: "New York",
      },
    },
    "cpu-l": {
      kind: "cpu",
      content: {
        heroStyle: "sparkline",
        hero: "temp",
        fields: ["temp", "load", "freq", "power", "pressure", "throttle", "cores", "model"],
      },
    },
    "cpu-custom": {
      kind: "cpu",
      style: {
        surface: "color",
        surfaceColor: "#123c4a",
        transparency: 15,
        textScale: 1.1,
        fontWeight: 600,
        borderWidth: 2,
        borderColor: "#ffd166",
        accentColor: "#ffd166",
        heroColor: "accent",
        uppercaseLabels: true,
        radius: 12,
      },
      content: {
        title: "Prozessor",
        labels: { load: "Auslastung", temp: "Temperatur" },
        fields: ["load", "temp"],
      },
    },
    "clock-clear": {
      kind: "clock",
      style: {
        transparency: 100,
        blur: 60,
        textShadow: true,
        fontWidth: 40,
        numberFontFamily: "Roboto Flex",
        fontWeight: 250,
        legibility: false,
      },
      content: { title: "Clear glass", fields: ["time", "date"] },
    },
  },
};

/** Where each Lab instance sits (size class). */
export const LAB_LAYOUT: readonly { id: string; size: "1x1" | "2x1" | "4x1" | "S" | "M" | "L" }[] =
  [
    { id: "clock-m", size: "M" },
    { id: "cpu-s", size: "S" },
    { id: "cpu-1x1", size: "1x1" },
    { id: "clock-2x1", size: "2x1" },
    { id: "cpu-m", size: "M" },
    { id: "cpu-4x1", size: "4x1" },
    { id: "cpu-custom", size: "S" },
    { id: "clock-clear", size: "S" },
    { id: "cpu-l", size: "L" },
    { id: "clock-analog", size: "M" },
  ];

/** A fixed moment for screenshots: Monday 23 November 2026, 10:09:30 in Berlin. */
export const LAB_NOW = new Date("2026-11-23T09:09:30Z");

export const LAB_FONTS = [
  "DejaVu Sans",
  "DejaVu Serif",
  "Noto Sans",
  "Noto Serif",
  "Ubuntu",
  "Ubuntu Mono",
];

/** A plausible spectrum for the Lab: 32 levels then 32 peaks, moving with `t` (seconds). */
export function mockSpectrum(t: number): number[] {
  const levels = Array.from({ length: 32 }, (_, i) => {
    const bass = Math.max(0, 1 - i / 10) * (0.6 + 0.4 * Math.sin(t * 7.1));
    const mid = 0.45 + 0.35 * Math.sin(t * 3.3 + i * 0.7);
    const air = 0.25 * (1 + Math.sin(t * 11 + i * 1.9)) * (i / 32);
    return Math.round(Math.min(1, bass * 0.8 + mid * 0.5 + air) * 230);
  });
  return [...levels, ...levels.map((l) => Math.min(255, l + 18))];
}

// CPU widget: load, temperature, frequency, power, pressure, throttling and facts about the chip.
// Every field can be shown, hidden, reordered, renamed or made the hero.
import { defaultOptions } from "../compose/widget";
import { cpuComposition } from "./cpu.composition";
import {
  frequency,
  type FreqUnit,
  map,
  missingReason,
  num,
  nums,
  percent,
  temperature,
  type TempUnit,
  text,
} from "./format";
import type { CardStatus, ReadCtx, WidgetDef } from "./types";

const LOAD = "cpu.load";
const TEMP = "cpu.temp";
const FREQ = "cpu.freq";
const INFO = "cpu.info";
const PER_THREAD = "cpu.perThread";
const POWER = "cpu.packagePower";
const PRESSURE = "cpu.pressure";
const THROTTLE = "cpu.throttle";
const LOADAVG = "system.loadavg";
const UPTIME = "system.uptime";

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${String(d)} d ${String(h)} h`;
  if (h > 0) return `${String(h)} h ${String(m).padStart(2, "0")} m`;
  return `${String(m)} min`;
}

const tempUnit = (c: ReadCtx) => c.content.opt<TempUnit>("tempUnit");
const freqUnit = (c: ReadCtx) => c.content.opt<FreqUnit>("freqUnit");
const dec = (c: ReadCtx) => c.content.decimals;

function infoNum(c: ReadCtx, key: string): number | null {
  return num(map(c.get(INFO))?.[key]);
}

export const cpu: WidgetDef = {
  kind: "cpu",
  name: "CPU",
  icon: "developer_board",
  category: "system",
  sizes: ["1x1", "2x1", "4x1", "S", "M", "L", "XL"],
  defaultSize: "S",
  heroStyles: ["ring", "number", "bar", "sparkline"],
  defaultFields: ["load", "temp", "freq"],
  fields: [
    {
      id: "load",
      label: "Load",
      icon: "speed",
      topics: [LOAD],
      series: LOAD,
      read: (c) => {
        const v = num(c.get(LOAD));
        return v === null
          ? null
          : { text: percent(v, dec(c)), value: v, ratio: v / 100, ramp: "load" };
      },
    },
    {
      id: "temp",
      label: "Temperature",
      shortLabel: "Temp",
      icon: "thermostat",
      topics: [TEMP],
      series: TEMP,
      read: (c) => {
        const v = num(c.get(TEMP));
        return v === null
          ? null
          : {
              text: temperature(v, tempUnit(c), dec(c)),
              value: v,
              ratio: (v - 30) / 70,
              ramp: "thermal",
            };
      },
    },
    {
      id: "freq",
      label: "Frequency",
      shortLabel: "Clock",
      icon: "bolt",
      topics: [FREQ, INFO],
      series: FREQ,
      read: (c) => {
        const v = num(c.get(FREQ));
        if (v === null) return null;
        const max = infoNum(c, "maxMHz");
        return {
          text: frequency(v, freqUnit(c), dec(c)),
          value: v,
          ...(max
            ? {
                ratio: v / max,
                ramp: "load" as const,
                sub: `max ${frequency(max, freqUnit(c), dec(c))}`,
              }
            : {}),
        };
      },
    },
    {
      id: "busiest",
      label: "Busiest thread",
      shortLabel: "Busiest",
      icon: "local_fire_department",
      topics: [PER_THREAD],
      read: (c) => {
        const v = nums(c.get(PER_THREAD));
        if (!v?.length) return null;
        const max = Math.max(...v);
        return { text: percent(max, dec(c)), value: max, ratio: max / 100, ramp: "load" };
      },
    },
    {
      id: "power",
      label: "Power",
      icon: "electric_bolt",
      topics: [POWER],
      series: POWER,
      read: (c) => {
        const v = num(c.get(POWER));
        return v === null ? null : { text: `${v.toFixed(Math.max(1, dec(c)))} W`, value: v };
      },
    },
    {
      id: "pressure",
      label: "Pressure",
      icon: "hourglass_empty",
      topics: [PRESSURE],
      read: (c) => {
        const v = num(map(c.get(PRESSURE))?.some10);
        return v === null
          ? null
          : {
              text: percent(v, Math.max(1, dec(c))),
              value: v,
              ratio: v / 100,
              ramp: "load",
              sub: "waiting for CPU, 10 s",
            };
      },
    },
    {
      id: "throttle",
      label: "Throttling",
      shortLabel: "Throttle",
      icon: "warning",
      topics: [THROTTLE],
      hero: false,
      read: (c) => {
        const t = map(c.get(THROTTLE));
        if (!t) return null;
        const active = t.active?.kind === "bool" && t.active.v;
        return { text: active ? "Yes" : "No" };
      },
    },
    {
      id: "loadavg",
      label: "Load average",
      shortLabel: "Load avg",
      icon: "monitoring",
      topics: [LOADAVG],
      hero: false,
      read: (c) => {
        const v = nums(c.get(LOADAVG));
        return v
          ? {
              text: v
                .map((x) =>
                  x.toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                    minimumFractionDigits: 2,
                  }),
                )
                .join(" · "),
            }
          : null;
      },
    },
    {
      id: "cores",
      label: "Cores",
      icon: "grid_view",
      topics: [INFO],
      hero: false,
      read: (c) => {
        const cores = infoNum(c, "cores");
        const threads = infoNum(c, "threads");
        return cores === null
          ? null
          : { text: threads ? `${String(cores)} / ${String(threads)} threads` : String(cores) };
      },
    },
    {
      id: "model",
      label: "CPU model",
      shortLabel: "Model",
      icon: "memory",
      topics: [INFO],
      hero: false,
      read: (c) => {
        const m = text(map(c.get(INFO))?.model);
        return m
          ? {
              text: m
                .replace(/\(R\)|\(TM\)|CPU|@.*$/g, "")
                .replace(/\s+/g, " ")
                .trim(),
            }
          : null;
      },
    },
    {
      id: "cache",
      label: "Cache",
      icon: "layers",
      topics: [INFO],
      hero: false,
      read: (c) => {
        const v = text(map(c.get(INFO))?.cache);
        return v ? { text: v } : null;
      },
    },
    {
      id: "freqRange",
      label: "Clock range",
      shortLabel: "Range",
      icon: "bolt",
      topics: [INFO],
      hero: false,
      read: (c) => {
        const min = infoNum(c, "minMHz");
        const max = infoNum(c, "maxMHz");
        if (max === null) return null;
        const u = freqUnit(c);
        return {
          text:
            min !== null
              ? `${frequency(min, u, 1)} – ${frequency(max, u, 1)}`
              : frequency(max, u, 1),
        };
      },
    },
    {
      id: "driver",
      label: "Scaling driver",
      shortLabel: "Driver",
      icon: "developer_board",
      topics: [INFO],
      hero: false,
      read: (c) => {
        const d = text(map(c.get(INFO))?.driver);
        return d ? { text: d } : null;
      },
    },
    {
      id: "governor",
      label: "Governor",
      icon: "tune",
      topics: [INFO],
      hero: false,
      read: (c) => {
        const g = text(map(c.get(INFO))?.governor);
        return g ? { text: g } : null;
      },
    },
    {
      id: "arch",
      label: "Architecture",
      shortLabel: "Arch",
      icon: "info",
      topics: [INFO],
      hero: false,
      read: (c) => {
        const a = text(map(c.get(INFO))?.arch);
        const v = text(map(c.get(INFO))?.vendor);
        return a ? { text: v ? `${v} · ${a}` : a } : null;
      },
    },
    {
      id: "uptime",
      label: "Uptime",
      icon: "schedule",
      topics: [UPTIME],
      hero: false,
      read: (c) => {
        const s = num(c.get(UPTIME));
        return s === null ? null : { text: formatUptime(s), value: s };
      },
    },
  ],
  options: [
    {
      kind: "enum",
      key: "heroVisual",
      label: "Hero visual",
      options: [
        { value: "thermal", label: "Thermal badge" },
        { value: "ring", label: "Load gauge" },
        { value: "bars", label: "Per-core bars" },
        { value: "heatmap", label: "Per-core heatmap" },
        { value: "chart", label: "Load chart" },
      ],
      default: "thermal",
    },
    {
      kind: "enum",
      key: "tempSource",
      label: "Temperature source",
      options: [
        { value: "package", label: "Package / Tdie" },
        { value: "core-max", label: "Hottest core / Tccd" },
      ],
      default: "package",
    },
    {
      kind: "enum",
      key: "freqMode",
      label: "Frequency mode",
      options: [
        { value: "avg", label: "Average" },
        { value: "max", label: "Fastest core" },
      ],
      default: "avg",
    },
    {
      kind: "enum",
      key: "tempUnit",
      label: "Temperature unit",
      options: [
        { value: "c", label: "Celsius (°C)" },
        { value: "f", label: "Fahrenheit (°F)" },
      ],
      default: "c",
    },
    {
      kind: "enum",
      key: "freqUnit",
      label: "Frequency unit",
      options: [
        { value: "ghz", label: "GHz" },
        { value: "mhz", label: "MHz" },
      ],
      default: "ghz",
    },
    {
      kind: "thresholds",
      key: "levels",
      label: "Warning and critical levels",
      help: "For the main value (in % for load, °C for temperature). The card turns amber, then red.",
      min: 0,
      max: 5000,
      step: 1,
      unit: "",
      default: [85, 95],
    },
  ],
  composition: cpuComposition,
  useClassicStat: true,
  compositionOptions: (content) => defaultOptions(cpu, content),
  status(c): CardStatus {
    const load = c.get(LOAD);
    if (load === undefined) return { kind: "loading" };
    const reason = missingReason(load);
    return reason
      ? { kind: "unavailable", reason: `CPU load unavailable (${reason})` }
      : { kind: "ready" };
  },
};

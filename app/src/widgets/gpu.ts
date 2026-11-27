// GPU widget: one GPU (chosen, or the discrete one when there is one). Load, VRAM, temperature,
// clocks, power, fan, video engines and what uses it. A sleeping dGPU is shown asleep and never
// woken up (ADR 0003): core doesn't touch it, and neither do we.
import { defaultOptions } from "../compose/widget";
import type { Value } from "../layer/protocol";
import { gpuComposition } from "./gpu.composition";
import {
  type ByteUnit,
  bytes,
  fixed,
  frequency,
  map,
  missingReason,
  num,
  percent,
  temperature,
  type TempUnit,
  text,
} from "./format";
import { BYTE_UNIT, TEMP_UNIT, levels } from "./options";
import type { CardStatus, Choice, ReadCtx, Reading, WidgetDef } from "./types";

const LIST = "gpu.list";

interface GpuInfo {
  index: number;
  name: string;
  discrete: boolean;
  driver: string;
  pci: string;
  vendor: string;
}

function gpus(v: Value | undefined): GpuInfo[] {
  if (v?.kind !== "list") return [];
  return v.v.flatMap((g) => {
    if (g.kind !== "map") return [];
    const index = num(g.v.index);
    return index === null
      ? []
      : [
          {
            index,
            name: text(g.v.name) ?? `GPU ${String(index)}`,
            discrete: g.v.discrete?.kind === "bool" && g.v.discrete.v,
            driver: text(g.v.driver) ?? "",
            pci: text(g.v.pci) ?? "",
            vendor: text(g.v.vendor) ?? "",
          },
        ];
  });
}

/** The chosen GPU's index; "auto" prefers the discrete one. */
export function gpuIndex(c: ReadCtx): number | null {
  const list = gpus(c.get(LIST));
  const choice = c.content.opt<string>("gpu");
  if (choice !== "auto") {
    const n = Number(choice);
    return list.some((g) => g.index === n) ? n : (list[0]?.index ?? null);
  }
  return (list.find((g) => g.discrete) ?? list[0])?.index ?? null;
}

const t = (c: ReadCtx, metric: string) => {
  const i = gpuIndex(c);
  return i === null ? [] : [`gpu.${String(i)}.${metric}`];
};
const g = (c: ReadCtx, metric: string) => {
  const i = gpuIndex(c);
  return i === null ? undefined : c.get(`gpu.${String(i)}.${metric}`);
};
const tempUnit = (c: ReadCtx) => c.content.opt<TempUnit>("tempUnit");

function choices(v: Value | undefined): Choice {
  return [
    { value: "auto", label: "Automatic (discrete first)" },
    ...gpus(v).map((x) => ({ value: String(x.index), label: x.name })),
  ];
}

export const gpu: WidgetDef = {
  kind: "gpu",
  name: "GPU",
  icon: "graphic_eq",
  category: "system",
  sizes: ["1x1", "2x1", "4x1", "S", "M", "L", "XL"],
  defaultSize: "S",
  heroStyles: ["ring", "number", "bar", "sparkline"],
  topics: [LIST],
  extraTopics: (c) => {
    const list = gpus(c.get(LIST));
    const metrics = [
      "state",
      "load",
      "temp",
      "vram",
      "power",
      "clocks",
      "fan",
      "engines",
      "processes",
    ];
    const out = new Set<string>(t(c, "state"));
    for (const info of list.slice(0, 2)) {
      for (const m of metrics) out.add(`gpu.${String(info.index)}.${m}`);
    }
    return [...out];
  },
  defaultFields: ["load", "temp", "vram", "power"],
  fields: [
    {
      id: "load",
      label: "Load",
      icon: "speed",
      topics: (c) => t(c, "load"),
      read: (c) => {
        const v = num(g(c, "load"));
        if (v === null) return null;
        const approx = map(g(c, "state"))?.loadApprox;
        return {
          text: `${approx?.kind === "bool" && approx.v ? "≈ " : ""}${percent(v, c.content.decimals)}`,
          value: v,
          ratio: v / 100,
          ramp: "load",
        };
      },
    },
    {
      id: "temp",
      label: "Temperature",
      shortLabel: "Temp",
      icon: "thermostat",
      topics: (c) => t(c, "temp"),
      read: (c) => {
        const v = num(g(c, "temp"));
        return v === null
          ? null
          : {
              text: temperature(v, tempUnit(c), c.content.decimals),
              value: v,
              ratio: (v - 30) / 65,
              ramp: "thermal",
            };
      },
    },
    {
      id: "vram",
      label: "Video memory",
      shortLabel: "VRAM",
      icon: "memory",
      topics: (c) => t(c, "vram"),
      read: (c): Reading | null => {
        const m = map(g(c, "vram"));
        const used = num(m?.usedB);
        const total = num(m?.totalB);
        const p = num(m?.percent);
        if (used === null || !total)
          return missingReason(g(c, "vram")) === "shared-memory" ? { text: "Shared" } : null;
        const u = c.content.opt<ByteUnit>("byteUnit");
        return {
          text: `${bytes(used, u, 1)} / ${bytes(total, u, 1)}`,
          value: p ?? 0,
          ratio: (p ?? 0) / 100,
          ramp: "load",
        };
      },
    },
    {
      id: "clock",
      label: "Core clock",
      shortLabel: "Clock",
      icon: "bolt",
      topics: (c) => t(c, "clocks"),
      read: (c) => {
        const m = map(g(c, "clocks"));
        const v = num(m?.coreMHz);
        const max = num(m?.maxCoreMHz);
        return v === null
          ? null
          : {
              text: frequency(v, "mhz", 0),
              value: v,
              ...(max ? { ratio: v / max, ramp: "load" as const } : {}),
            };
      },
    },
    {
      id: "memClock",
      label: "Memory clock",
      shortLabel: "Mem clock",
      icon: "bolt",
      topics: (c) => t(c, "clocks"),
      read: (c) => {
        const v = num(map(g(c, "clocks"))?.memMHz);
        return v === null ? null : { text: frequency(v, "mhz", 0), value: v };
      },
    },
    {
      id: "power",
      label: "Power",
      icon: "electric_bolt",
      topics: (c) => t(c, "power"),
      read: (c) => {
        const m = map(g(c, "power"));
        const w = num(m?.watts);
        const limit = num(m?.limitW);
        return w === null
          ? null
          : {
              text: `${fixed(w, Math.max(1, c.content.decimals))} W`,
              value: w,
              ...(limit
                ? { ratio: w / limit, ramp: "load" as const, sub: `limit ${fixed(limit, 0)} W` }
                : {}),
            };
      },
    },
    {
      id: "fan",
      label: "Fan",
      icon: "mode_fan",
      topics: (c) => t(c, "fan"),
      read: (c) => {
        const m = map(g(c, "fan"));
        const rpm = num(m?.rpm);
        const p = num(m?.percent);
        if (rpm !== null)
          return {
            text: `${fixed(rpm, 0)} rpm`,
            value: rpm,
            ...(p !== null ? { ratio: p / 100, ramp: "load" as const } : {}),
          };
        return p === null ? null : { text: percent(p, 0), value: p, ratio: p / 100, ramp: "load" };
      },
    },
    {
      id: "video",
      label: "Video engines",
      shortLabel: "Video",
      icon: "graphic_eq",
      topics: (c) => t(c, "encdec"),
      read: (c) => {
        const m = map(g(c, "encdec"));
        const enc = num(m?.encoder);
        const dec = num(m?.decoder);
        return enc === null && dec === null
          ? null
          : {
              text: `enc ${percent(enc ?? 0, 0)} · dec ${percent(dec ?? 0, 0)}`,
              value: Math.max(enc ?? 0, dec ?? 0),
            };
      },
    },
    {
      id: "top",
      label: "Top app",
      icon: "apps",
      topics: (c) => t(c, "processes"),
      hero: false,
      read: (c) => {
        const p = g(c, "processes");
        if (p?.kind !== "list" || p.v.length === 0) return null;
        const first = p.v[0];
        return first?.kind === "map" ? { text: text(first.v.name) ?? "—" } : null;
      },
    },
    {
      id: "pstate",
      label: "Power state",
      shortLabel: "State",
      icon: "eco",
      topics: (c) => t(c, "state"),
      hero: false,
      read: (c) => {
        const s = map(g(c, "state"));
        if (!s) return null;
        const awake = s.awake?.kind === "bool" ? s.awake.v : true;
        return { text: awake ? (text(s.pstate) ?? "Awake") : "Asleep" };
      },
    },
    {
      id: "name",
      label: "GPU model",
      shortLabel: "Model",
      icon: "developer_board",
      topics: [],
      hero: false,
      read: (c) => {
        const i = gpuIndex(c);
        const info = gpus(c.get(LIST)).find((x) => x.index === i);
        return info ? { text: info.name.replace(/\[|\]/g, "") } : null;
      },
    },
    {
      id: "driver",
      label: "Driver",
      icon: "tune",
      topics: [],
      hero: false,
      read: (c) => {
        const i = gpuIndex(c);
        const info = gpus(c.get(LIST)).find((x) => x.index === i);
        return info?.driver ? { text: info.driver } : null;
      },
    },
    {
      id: "gpuType",
      label: "Type",
      icon: "info",
      topics: [],
      hero: false,
      read: (c) => {
        const i = gpuIndex(c);
        const info = gpus(c.get(LIST)).find((x) => x.index === i);
        return info ? { text: info.discrete ? "Discrete" : "Integrated" } : null;
      },
    },
    {
      id: "pci",
      label: "PCI slot",
      icon: "dns",
      topics: [],
      hero: false,
      read: (c) => {
        const i = gpuIndex(c);
        const info = gpus(c.get(LIST)).find((x) => x.index === i);
        return info?.pci ? { text: info.pci } : null;
      },
    },
  ],
  options: [
    { kind: "source", key: "gpu", label: "GPU", topic: LIST, choices, default: "auto" },
    {
      kind: "enum",
      key: "multiGpu",
      label: "Dual-GPU layout",
      options: [
        { value: "auto", label: "Side by side (M and larger)" },
        { value: "single", label: "Selected GPU only" },
      ],
      default: "auto",
    },
    TEMP_UNIT,
    BYTE_UNIT,
    levels([90, 98], "For the main value (% for load, °C for temperature)."),
  ],
  composition: gpuComposition,
  useClassicStat: true,
  compositionTopics(values) {
    const out: Record<string, Value | undefined> = { ...values };
    for (const [k, v] of Object.entries(values)) {
      if (k.startsWith("gpu.0.")) out[`gpu0.${k.slice(6)}`] = v;
      else if (k.startsWith("gpu.1.")) out[`gpu1.${k.slice(6)}`] = v;
    }
    return out;
  },
  compositionOptions(content) {
    const choice = content.opt<string>("gpu");
    const primaryIndex = choice === "auto" ? 1 : Number(choice) || 0;
    return {
      ...defaultOptions(gpu, content),
      primaryIndex,
    };
  },
  status(c): CardStatus {
    const list = c.get(LIST);
    if (list === undefined) return { kind: "loading" };
    const all = gpus(list);
    if (all.length === 0) return { kind: "unavailable", reason: "No GPU found" };
    // When showing multi-GPU side by side, a sleeping dGPU renders its own moon/"Asleep · 0 W"
    // pane beside the awake iGPU instead of replacing the entire card.
    const multi = all.length > 1 && c.content.opt<string>("multiGpu") !== "single";
    if (!multi) {
      const state = g(c, "state");
      const s = map(state);
      if (s?.awake?.kind === "bool" && !s.awake.v)
        return { kind: "asleep", reason: "Asleep · 0 W" };
      if (state?.kind === "missing" && state.v.state === "asleep")
        return { kind: "asleep", reason: "Asleep · 0 W" };
    }
    return { kind: "ready" };
  },
};

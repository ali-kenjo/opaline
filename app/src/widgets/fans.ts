// Fans widget: every fan the system reports (and the GPU's), the fastest as the main value.
import { defaultOptions } from "../compose/widget";
import type { Value } from "../layer/protocol";
import { fansComposition } from "./fans.composition";
import { fixed, map, num, percent, temperature, type TempUnit, text } from "./format";
import { gpuIndex } from "./gpu";
import { TEMP_UNIT } from "./options";
import type { CardStatus, ReadCtx, WidgetDef } from "./types";

const FANS = "fans.list";

interface Fan {
  name: string;
  rpm: number | null;
  max: number | null;
}

function fans(v: Value | undefined): Fan[] {
  if (v?.kind !== "list") return [];
  return v.v.flatMap((f) =>
    f.kind === "map"
      ? [{ name: text(f.v.name) ?? "Fan", rpm: num(f.v.rpm), max: num(f.v.maxRpm) }]
      : [],
  );
}

const scaleRpm = (c: ReadCtx, f: Fan) => f.max ?? c.content.opt<number>("maxRpm");

function fanField(n: number): WidgetDef["fields"][number] {
  return {
    id: `fan${String(n)}`,
    label: `Fan ${String(n)}`,
    icon: "mode_fan",
    topics: [FANS],
    read: (c) => {
      const f = fans(c.get(FANS))[n - 1];
      if (f?.rpm === null || f === undefined) return null;
      return {
        text: f.rpm === 0 ? "Off" : `${fixed(f.rpm, 0)} rpm`,
        value: f.rpm,
        ratio: f.rpm / scaleRpm(c, f),
        ramp: "load",
      };
    },
  };
}

export const fansWidget: WidgetDef = {
  kind: "fans",
  name: "Fans",
  icon: "mode_fan",
  category: "system",
  sizes: ["1x1", "2x1", "4x1", "S", "M", "L"],
  defaultSize: "S",
  heroStyles: ["ring", "number", "bar", "sparkline"],
  // gpu.list lets the GPU fan field find the GPU; it's a cheap, rarely changing topic.
  topics: [FANS, "gpu.list"],
  defaultFields: ["fastest", "fan1", "fan2", "cpuTemp"],
  fields: [
    {
      id: "fastest",
      label: "Fastest",
      icon: "mode_fan",
      topics: [FANS],
      read: (c) => {
        const list = fans(c.get(FANS)).filter((f) => f.rpm !== null);
        if (!list.length) return null;
        const top = list.reduce((a, b) => ((b.rpm ?? 0) > (a.rpm ?? 0) ? b : a));
        const rpm = top.rpm ?? 0;
        return {
          text: rpm === 0 ? "Quiet" : `${fixed(rpm, 0)} rpm`,
          value: rpm,
          ratio: rpm / scaleRpm(c, top),
          ramp: "load",
          sub: rpm === 0 ? "all fans stopped" : top.name,
        };
      },
    },
    fanField(1),
    fanField(2),
    fanField(3),
    fanField(4),
    {
      id: "gpuFan",
      label: "GPU fan",
      icon: "mode_fan",
      topics: (c) => {
        const i = gpuIndex(c);
        return i === null ? [] : ["gpu.list", `gpu.${String(i)}.fan`];
      },
      read: (c) => {
        const i = gpuIndex(c);
        const f = i === null ? null : map(c.get(`gpu.${String(i)}.fan`));
        const rpm = num(f?.rpm);
        const p = num(f?.percent);
        if (rpm !== null) return { text: `${fixed(rpm, 0)} rpm`, value: rpm };
        return p === null ? null : { text: percent(p, 0), value: p, ratio: p / 100, ramp: "load" };
      },
    },
    {
      id: "cpuTemp",
      label: "CPU temperature",
      shortLabel: "CPU temp",
      icon: "thermostat",
      topics: ["cpu.temp"],
      read: (c) => {
        const t = num(c.get("cpu.temp"));
        return t === null
          ? null
          : {
              text: temperature(t, c.content.opt<TempUnit>("tempUnit"), 0),
              value: t,
              ratio: (t - 30) / 70,
              ramp: "thermal",
            };
      },
    },
  ],
  options: [
    {
      kind: "range",
      key: "maxRpm",
      label: "Full speed",
      help: "For fans that don't report their maximum.",
      min: 1000,
      max: 12000,
      step: 100,
      unit: "rpm",
      default: 6000,
    },
    {
      kind: "enum",
      key: "gpu",
      label: "GPU (for the GPU fan)",
      options: [{ value: "auto", label: "Automatic" }],
      default: "auto",
    },
    TEMP_UNIT,
  ],
  extraTopics: (c) => {
    const i = gpuIndex(c);
    return i === null
      ? ["cpu.temp"]
      : ["cpu.temp", `gpu.${String(i)}.temp`, `gpu.${String(i)}.fan`];
  },
  composition: fansComposition,
  useClassicStat: true,
  compositionOptions: (content) => defaultOptions(fansWidget, content),
  compositionTopics(values, content) {
    const ctx: ReadCtx = { get: (k) => values[k], content };
    const list = fans(values[FANS]).filter((f) => f.rpm !== null);
    const top = list.length
      ? list.reduce((a, b) => ((b.rpm ?? 0) > (a.rpm ?? 0) ? b : a))
      : undefined;
    const gi = gpuIndex(ctx);
    const gpuTemp = gi === null ? null : num(values[`gpu.${String(gi)}.temp`]);
    const active: Record<string, Value> = {
      fastestRpm: { kind: "num", v: top?.rpm ?? 0 },
      fastestName: { kind: "text", v: top?.name ?? "Fan" },
      maxRpm: { kind: "num", v: top ? scaleRpm(ctx, top) : content.opt<number>("maxRpm") },
    };
    if (gpuTemp !== null) active.gpuTemp = { kind: "num", v: gpuTemp };
    return { ...values, fansActive: { kind: "map", v: active } };
  },
  status(c): CardStatus {
    const f = c.get(FANS);
    if (f === undefined) return { kind: "loading" };
    return fans(f).length
      ? { kind: "ready" }
      : { kind: "unavailable", reason: "No fan sensors found" };
  },
};

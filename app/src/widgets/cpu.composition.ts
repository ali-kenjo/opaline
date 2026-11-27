// CPU widget as a 2.0 composition (PLAN-2 4.2, brief §8.1). Kept equal to
// spec/compositions/cpu.json, which the Rust validator checks.
//
// Signature Opaline layouts across 1x1, 2x1, 4x1, S, M, L, XL:
// - Hero choice: thermal shape badge, load ring, per-core bars, heatmap, or load chart
// - Temperature source (package, core-max, core-avg) & frequency mode (avg, max, min)
// - Power when available, throttling badge when active, per-core grid at L/XL, top apps with icons
import type { Composition, Node } from "../compose/model.gen";

const thermalBadge = (id: string): Node => ({
  id,
  type: "canvas",
  visual: "thermal-badge",
  label: "CPU temperature {bind.tempText}",
  params: {
    tempC: "bind.tempC",
    text: "bind.tempText",
  },
});

const throttleBadge = (id: string): Node => ({
  id,
  type: "text",
  role: "badge",
  text: "Throttling",
  visible: "cpu.throttle.active == true",
});

const heroNum = (id: string): Node => ({
  id,
  type: "number",
  role: "hero",
  value: "cpu.load",
  text: "{round(cpu.load)}",
  unit: "%",
  motion: "odometer",
});

const coreBars = (id: string): Node => ({
  id,
  type: "canvas",
  visual: "core-bars",
  label: "Per-core CPU load",
  params: {
    values: "cpu.perThread",
    max: "100",
  },
});

const topApps = (id: string, max: number): Node => ({
  id,
  type: "canvas",
  visual: "app-list",
  label: "Top CPU apps",
  params: {
    apps: "processes.apps",
    metric: "'cpu'",
    max: String(max),
  },
});

export const cpuComposition: Composition = {
  version: 1,
  bindings: {
    loadRatio: "clamp((cpu.load ?? 0) / 100, 0, 1)",
    tempC:
      "if(opt.tempSource == 'core-max' && len(cpu.tempPerCore) > 0, max(cpu.tempPerCore[0], cpu.temp ?? 0), cpu.temp)",
    tempDisplay: "if(opt.tempUnit == 'f', bind.tempC * 9 / 5 + 32, bind.tempC)",
    tempUnitStr: "if(opt.tempUnit == 'f', '°F', '°')",
    tempText:
      "if(bind.tempDisplay != null, string(round(bind.tempDisplay)) + bind.tempUnitStr, '—')",
    freqMHz:
      "if(opt.freqMode == 'max' && len(cpu.freqPerThread) > 0, max(cpu.freqPerThread[0], cpu.freq ?? 0), cpu.freq)",
    freqText:
      "if(bind.freqMHz != null, if(opt.freqUnit == 'mhz', string(round(bind.freqMHz)) + ' MHz', fixed(bind.freqMHz / 1000, 2) + ' GHz'), '—')",
    powerText: "if(cpu.packagePower != null, fixed(cpu.packagePower, 1) + ' W', '')",
    heroVisual: "opt.heroVisual ?? 'thermal'",
  },
  layouts: [
    {
      sizes: ["1x1"],
      root: {
        id: "root",
        type: "column",
        align: "center",
        justify: "center",
        children: [heroNum("load")],
      },
    },
    {
      sizes: ["2x1"],
      root: {
        id: "root",
        type: "row",
        align: "center",
        justify: "between",
        gap: 2,
        children: [heroNum("load"), thermalBadge("temp")],
      },
    },
    {
      sizes: ["4x1"],
      root: {
        id: "root",
        type: "row",
        align: "center",
        justify: "between",
        gap: 3,
        children: [
          heroNum("load"),
          {
            id: "meta",
            type: "column",
            justify: "center",
            gap: 1,
            children: [
              { id: "freq", type: "text", role: "value", text: "{bind.freqText}" },
              {
                id: "power",
                type: "text",
                role: "caption",
                text: "{bind.powerText}",
                visible: "len(bind.powerText) > 0",
              },
            ],
          },
          throttleBadge("throttle"),
          thermalBadge("temp"),
        ],
      },
    },
    {
      sizes: ["S"],
      root: {
        id: "root",
        type: "column",
        justify: "between",
        gap: 2,
        children: [
          {
            id: "top",
            type: "row",
            align: "center",
            justify: "between",
            gap: 2,
            grow: 1,
            children: [
              {
                ...heroNum("load"),
                visible: "bind.heroVisual == 'thermal' || bind.heroVisual == 'chart'",
              },
              {
                id: "load-ring",
                type: "ring",
                value: "bind.loadRatio",
                sweep: 270,
                color: "ramp(bind.loadRatio, 'load')",
                visible: "bind.heroVisual == 'ring'",
              },
              {
                ...coreBars("s-bars"),
                visible: "bind.heroVisual == 'bars'",
              },
              {
                id: "s-heat",
                type: "heatmap",
                values: "cpu.perThread",
                columns: 4,
                max: 100,
                visible: "bind.heroVisual == 'heatmap'",
              },
              {
                ...thermalBadge("temp"),
                visible: "bind.heroVisual == 'thermal'",
              },
            ],
          },
          {
            id: "foot",
            type: "row",
            align: "center",
            justify: "between",
            gap: 2,
            children: [
              { id: "freq", type: "text", role: "value", text: "{bind.freqText}" },
              {
                id: "temp-inline",
                type: "text",
                role: "caption",
                text: "{bind.tempText}",
                visible: "bind.heroVisual != 'thermal'",
              },
              throttleBadge("throttle"),
            ],
          },
        ],
      },
    },
    {
      sizes: ["M"],
      root: {
        id: "root",
        type: "row",
        align: "stretch",
        gap: 3,
        children: [
          {
            id: "left",
            type: "column",
            justify: "between",
            gap: 1,
            children: [
              heroNum("load"),
              { id: "cap", type: "text", role: "caption", text: "Processor load" },
              throttleBadge("throttle"),
            ],
          },
          {
            id: "right",
            type: "column",
            justify: "between",
            gap: 2,
            grow: 1,
            children: [
              {
                id: "stats",
                type: "row",
                align: "center",
                justify: "between",
                gap: 2,
                children: [
                  {
                    id: "freq-col",
                    type: "column",
                    gap: 0,
                    children: [
                      { id: "freq", type: "text", role: "value", text: "{bind.freqText}" },
                      {
                        id: "power",
                        type: "text",
                        role: "caption",
                        text: "{bind.powerText}",
                        visible: "len(bind.powerText) > 0",
                      },
                    ],
                  },
                  thermalBadge("temp"),
                ],
              },
              {
                id: "m-chart",
                type: "chart",
                history: { path: "cpu.load", window: "15m" },
                plot: "area",
                smooth: true,
                min: 0,
                max: 100,
                visible: "bind.heroVisual == 'thermal' || bind.heroVisual == 'chart'",
              },
              {
                ...coreBars("m-bars"),
                visible: "bind.heroVisual == 'bars'",
              },
              {
                id: "m-heat",
                type: "heatmap",
                values: "cpu.perThread",
                columns: 4,
                max: 100,
                visible: "bind.heroVisual == 'heatmap'",
              },
              {
                id: "m-ring",
                type: "ring",
                value: "bind.loadRatio",
                sweep: 240,
                ticks: 9,
                needle: true,
                color: "ramp(bind.loadRatio, 'load')",
                visible: "bind.heroVisual == 'ring'",
              },
            ],
          },
        ],
      },
    },
    {
      sizes: ["L", "XL"],
      root: {
        id: "root",
        type: "column",
        gap: 3,
        children: [
          {
            id: "head",
            type: "row",
            align: "center",
            justify: "between",
            gap: 3,
            children: [
              {
                id: "hero-col",
                type: "column",
                gap: 1,
                children: [
                  heroNum("load"),
                  {
                    id: "model",
                    type: "text",
                    role: "caption",
                    text: "{cpu.info.model ?? 'Processor'}",
                  },
                ],
              },
              {
                id: "readouts",
                type: "column",
                align: "end",
                gap: 1,
                children: [
                  { id: "freq", type: "text", role: "value", text: "{bind.freqText}" },
                  {
                    id: "power",
                    type: "text",
                    role: "caption",
                    text: "{bind.powerText}",
                    visible: "len(bind.powerText) > 0",
                  },
                  throttleBadge("throttle"),
                ],
              },
              thermalBadge("temp"),
            ],
          },
          {
            id: "chart",
            type: "chart",
            history: { path: "cpu.load", window: "15m" },
            plot: "area",
            smooth: true,
            min: 0,
            max: 100,
          },
          {
            id: "cores-row",
            type: "row",
            gap: 3,
            grow: 1,
            children: [
              coreBars("cores"),
              {
                id: "heat",
                type: "heatmap",
                values: "cpu.perThread",
                columns: 4,
                max: 100,
              },
            ],
          },
          topApps("apps", 4),
        ],
      },
    },
  ],
};

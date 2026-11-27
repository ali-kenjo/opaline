// Memory widget as a 2.0 composition (PLAN-2 4.3, brief §8.1). Kept equal to
// spec/compositions/memory.json, which the Rust validator checks.
//
// Features:
// - Liquid-fill hero whose wave choppiness scales with memory pressure
// - Stacked composition bar (apps, shared, cache, buffers, compressed zram/zswap, swap, free)
// - Top memory apps with real app icons at L/XL
// - GB / GiB formatting
import type { Composition, Node } from "../compose/model.gen";

/** The liquid pill; `sub` adds "used / total" under the percentage (left out where the same line
 * stands right next to the pill). */
const liquid = (id: string, sub = true): Node => ({
  id,
  type: "canvas",
  visual: "liquid-fill",
  label: "Memory in use {bind.pctText}",
  params: {
    percent: "memory.usage.percent",
    pressure: "memory.pressure.some10",
    text: "bind.pctText",
    ...(sub ? { sub: "bind.usedOfTotal" } : {}),
    color: "ramp(bind.ratio, 'load')",
  },
});

const stacked = (id: string, legend: boolean): Node => ({
  id,
  type: "canvas",
  visual: "stacked-bar",
  label: "Memory composition",
  params: {
    total: "memory.usage.totalB",
    used: "memory.usage.usedB",
    cached: "memory.usage.cachedB",
    buffers: "memory.usage.buffersB",
    shared: "memory.usage.shmemB",
    swapUsed: "memory.swap.usedB",
    compressed: "bind.compressedB",
    legend: legend ? "true" : "false",
  },
});

const topApps = (id: string, max: number): Node => ({
  id,
  type: "canvas",
  visual: "app-list",
  label: "Top memory apps",
  params: {
    apps: "processes.apps",
    metric: "'mem'",
    binary: "bind.binary",
    max: String(max),
  },
});

export const memoryComposition: Composition = {
  version: 1,
  bindings: {
    ratio: "clamp((memory.usage.percent ?? 0) / 100, 0, 1)",
    binary: "opt.byteUnit == 'gib'",
    byteStyle: "if(bind.binary, 'iec', 'si')",
    pctText: "if(memory.usage.percent != null, string(round(memory.usage.percent)) + '%', '—')",
    usedText: "if(memory.usage.usedB != null, bytes(memory.usage.usedB, bind.byteStyle), '—')",
    totalText: "if(memory.usage.totalB != null, bytes(memory.usage.totalB, bind.byteStyle), '—')",
    availText:
      "if(memory.usage.availableB != null, bytes(memory.usage.availableB, bind.byteStyle), '—')",
    usedOfTotal: "bind.usedText + ' / ' + bind.totalText",
    swapText:
      "if(memory.swap.totalB != null && memory.swap.totalB > 0, bytes(memory.swap.usedB ?? 0, bind.byteStyle) + ' / ' + bytes(memory.swap.totalB, bind.byteStyle), 'No swap')",
    compressedB: "(memory.zram.comprDataB ?? 0) + (memory.zswap.poolB ?? 0)",
    compressedText:
      "if(memory.zram.origDataB != null, 'zram ' + bytes(memory.zram.origDataB, bind.byteStyle) + ' → ' + bytes(memory.zram.comprDataB ?? 0, bind.byteStyle), if(memory.zswap.storedB != null, 'zswap ' + bytes(memory.zswap.storedB, bind.byteStyle) + ' → ' + bytes(memory.zswap.poolB ?? 0, bind.byteStyle), ''))",
    specText:
      "if(memory.info.type != null, memory.info.type + if(memory.info.speedMTs != null, ' · ' + string(round(memory.info.speedMTs)) + ' MT/s', ''), 'Memory')",
    heroVisual: "opt.heroVisual ?? 'liquid'",
  },
  layouts: [
    {
      sizes: ["1x1"],
      root: {
        id: "root",
        type: "column",
        align: "center",
        justify: "center",
        children: [
          {
            id: "pct",
            type: "number",
            role: "hero",
            value: "memory.usage.percent",
            text: "{round(memory.usage.percent)}",
            unit: "%",
          },
        ],
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
        children: [
          {
            id: "pct",
            type: "number",
            role: "hero",
            value: "memory.usage.percent",
            text: "{round(memory.usage.percent)}",
            unit: "%",
          },
          { id: "used", type: "text", role: "caption", text: "{bind.usedText}" },
        ],
      },
    },
    {
      sizes: ["4x1"],
      root: {
        id: "root",
        type: "row",
        align: "center",
        gap: 3,
        children: [
          {
            id: "pct",
            type: "number",
            role: "hero",
            value: "memory.usage.percent",
            text: "{round(memory.usage.percent)}",
            unit: "%",
          },
          {
            id: "right",
            type: "column",
            justify: "center",
            gap: 1,
            grow: 1,
            children: [
              { id: "used", type: "text", role: "value", text: "{bind.usedOfTotal}" },
              stacked("bar", false),
            ],
          },
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
          { ...liquid("hero-liquid"), visible: "bind.heroVisual == 'liquid'" },
          {
            id: "hero-ring",
            type: "ring",
            value: "bind.ratio",
            color: "ramp(bind.ratio, 'load')",
            visible: "bind.heroVisual == 'ring'",
          },
          {
            id: "hero-num",
            type: "number",
            role: "hero",
            value: "memory.usage.percent",
            text: "{round(memory.usage.percent)}",
            unit: "%",
            visible: "bind.heroVisual == 'number'",
          },
          stacked("bar", false),
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
          { ...liquid("hero-liquid", false), visible: "bind.heroVisual == 'liquid'" },
          {
            id: "hero-ring",
            type: "ring",
            value: "bind.ratio",
            color: "ramp(bind.ratio, 'load')",
            visible: "bind.heroVisual == 'ring'",
          },
          {
            id: "hero-num",
            type: "number",
            role: "hero",
            value: "memory.usage.percent",
            text: "{round(memory.usage.percent)}",
            unit: "%",
            visible: "bind.heroVisual == 'number'",
          },
          {
            id: "details",
            type: "column",
            justify: "between",
            gap: 2,
            grow: 1,
            children: [
              {
                id: "nums",
                type: "column",
                gap: 0,
                children: [
                  { id: "used", type: "text", role: "value", text: "{bind.usedOfTotal}" },
                  {
                    id: "avail",
                    type: "text",
                    role: "caption",
                    text: "Available {bind.availText}",
                  },
                  { id: "swap", type: "text", role: "caption", text: "Swap {bind.swapText}" },
                  {
                    id: "comp",
                    type: "text",
                    role: "caption",
                    text: "{bind.compressedText}",
                    visible: "len(bind.compressedText) > 0",
                  },
                ],
              },
              stacked("bar", true),
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
            id: "top",
            type: "row",
            align: "stretch",
            gap: 3,
            grow: 1,
            children: [
              liquid("hero-liquid"),
              {
                id: "meta",
                type: "column",
                justify: "between",
                gap: 1,
                grow: 1,
                children: [
                  { id: "spec", type: "text", role: "title", text: "{bind.specText}" },
                  { id: "used", type: "text", role: "value", text: "{bind.usedOfTotal}" },
                  {
                    id: "avail",
                    type: "text",
                    role: "caption",
                    text: "Available {bind.availText}",
                  },
                  { id: "swap", type: "text", role: "caption", text: "Swap {bind.swapText}" },
                  {
                    id: "comp",
                    type: "text",
                    role: "caption",
                    text: "{bind.compressedText}",
                    visible: "len(bind.compressedText) > 0",
                  },
                ],
              },
            ],
          },
          stacked("bar", true),
          topApps("apps", 4),
        ],
      },
    },
  ],
};

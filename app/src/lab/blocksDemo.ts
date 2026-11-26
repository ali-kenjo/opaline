// A Lab-only widget that shows the composition blocks on mock data (PLAN-2 2.6): a gauge with
// ticks and a needle, a segmented ring, a morphing shape, bars, a heatmap, wavy progress and
// the controls. Screenshot, truncation and contrast tests run over it like over real widgets.
import type { Composition, Node } from "../compose/model.gen";
import type { WidgetDef } from "../widgets/types";

const gauge: Node = {
  id: "gauge",
  type: "column",
  grow: 1,
  align: "center",
  children: [
    {
      id: "gauge-ring",
      type: "ring",
      role: "meter",
      value: "cpu.load / 100",
      sweep: 270,
      ticks: 9,
      needle: true,
      color: "ramp(cpu.load / 100, 'load')",
      label: "Load {cpu.load | round} %",
    },
    {
      id: "gauge-value",
      type: "number",
      role: "title",
      value: "cpu.load",
      text: "{cpu.load | round}",
      unit: "%",
    },
  ],
};

const side: Node = {
  id: "side",
  type: "column",
  gap: 2,
  grow: 1,
  children: [
    {
      id: "temp-ring",
      type: "ring",
      value: "cpu.temp / 100",
      segments: 8,
      thickness: 8,
      label: "Temperature {cpu.temp} °C",
    },
    {
      id: "mood",
      type: "shape",
      shape: "{if(cpu.load > 50, 'cookie9Sided', 'flower')}",
      label: "Busy shape",
    },
  ],
};

const controls: Node = {
  id: "controls",
  type: "row",
  gap: 2,
  align: "center",
  children: [
    {
      id: "play",
      type: "toggle",
      value: "media.player.status == 'Playing'",
      text: "Playing",
      command: {
        cmd: "media",
        args: { player: "media.players[0].bus", action: "'play-pause'" },
      },
    },
    { id: "gap", type: "spacer" },
    {
      id: "next",
      type: "button",
      text: "Next",
      icon: "skip_next",
      command: { cmd: "media", args: { player: "media.players[0].bus", action: "'next'" } },
    },
  ],
};

export const blocksComposition: Composition = {
  version: 1,
  layouts: [
    {
      root: {
        id: "root",
        type: "column",
        gap: 2,
        children: [
          { id: "top", type: "row", gap: 3, grow: 2, children: [gauge, side] },
          {
            id: "threads",
            type: "chart",
            values: "cpu.perThread",
            plot: "bars",
            min: 0,
            max: 100,
            label: "Load per thread",
          },
          {
            id: "heat",
            type: "heatmap",
            values: "cpu.perThread",
            columns: 8,
            max: 100,
            label: "Threads",
          },
          {
            id: "load-wave",
            type: "progress",
            value: "cpu.load / 100",
            wavy: true,
            label: "Load",
          },
          controls,
        ],
      },
    },
  ],
};

export const blocksDemo: WidgetDef = {
  kind: "lab-blocks",
  name: "Blocks",
  icon: "widgets",
  category: "system",
  sizes: ["L"],
  defaultSize: "L",
  fields: [],
  defaultFields: [],
  composition: blocksComposition,
  status: () => ({ kind: "ready" }),
};

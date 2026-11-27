// Storage widget as a 2.0 composition (PLAN-2 4.5, brief §8.1). Kept equal to
// spec/compositions/storage.json, which the Rust validator checks.
//
// Reads `storageActive.*` (derived from the chosen volume in `storage.compositionTopics`) plus
// `storage.drives`, `storage.io`, `storage.temps`, `storage.health`:
// - Several drives as bars or rings with health badges, temperatures, sorting & mount filters
// - Live I/O read/write rates and chart at L/XL
// - Eject and Power off buttons for removable drives (with confirmation)
import type { Composition, Node } from "../compose/model.gen";

const driveList = (id: string, max: number): Node => ({
  id,
  type: "canvas",
  visual: "drive-list",
  label: "Storage drives",
  params: {
    drives: "storage.drives",
    temps: "storage.temps",
    health: "storage.health",
    mode: "opt.displayMode",
    sortBy: "opt.sortBy",
    binary: "bind.binary",
    tempUnit: "opt.tempUnit",
    include: "opt.includeMounts",
    exclude: "opt.excludeMounts",
    max: String(max),
  },
});

const healthBadge = (id: string): Node => ({
  id,
  type: "text",
  role: "badge",
  text: "{bind.healthText}",
  visible: "len(bind.healthText) > 0",
});

const ejectBtn = (id: string): Node => ({
  id,
  type: "button",
  text: "Eject",
  icon: "eject",
  confirm: "Eject?",
  visible: "storageActive.ejectable == true",
  command: {
    cmd: "drive-eject",
    args: { drive: "storageActive.drive" },
  },
});

const powerOffBtn = (id: string): Node => ({
  id,
  type: "button",
  text: "Power off",
  icon: "power_settings_new",
  confirm: "Power off?",
  visible: "storageActive.canPowerOff == true",
  command: {
    cmd: "drive-power-off",
    args: { drive: "storageActive.drive" },
  },
});

export const storageComposition: Composition = {
  version: 1,
  bindings: {
    binary: "opt.byteUnit == 'gib'",
    byteStyle: "if(bind.binary, 'iec', 'si')",
    ratio: "clamp((storageActive.percent ?? 0) / 100, 0, 1)",
    freeText:
      "if(storageActive.availB != null, bytes(storageActive.availB, bind.byteStyle) + ' free', '—')",
    totalText: "if(storageActive.totalB != null, bytes(storageActive.totalB, bind.byteStyle), '')",
    ioText:
      "if(storageActive.readBps != null || storageActive.writeBps != null, '↓ ' + bytes(storageActive.readBps ?? 0, bind.byteStyle) + '/s · ↑ ' + bytes(storageActive.writeBps ?? 0, bind.byteStyle) + '/s', '')",
    tempDisp: "if(opt.tempUnit == 'f', storageActive.tempC * 9 / 5 + 32, storageActive.tempC)",
    tempText:
      "if(bind.tempDisp != null, string(round(bind.tempDisp)) + if(opt.tempUnit == 'f', '°F', '°'), '')",
    healthText:
      "if(storageActive.healthStatus == 'good', 'Health OK' + if(storageActive.percentUsed != null, ' · ' + string(round(storageActive.percentUsed)) + '% worn', ''), storageActive.healthStatus ?? '')",
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
            value: "storageActive.percent",
            text: "{round(storageActive.percent)}",
            unit: "%",
          },
        ],
      },
    },
    {
      sizes: ["2x1", "4x1"],
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
            value: "storageActive.percent",
            text: "{round(storageActive.percent)}",
            unit: "%",
          },
          {
            id: "meta",
            type: "column",
            gap: 0,
            children: [
              { id: "mount", type: "text", role: "value", text: "{storageActive.mount ?? '/'}" },
              { id: "free", type: "text", role: "caption", text: "{bind.freeText}" },
            ],
          },
          healthBadge("health"),
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
            children: [
              {
                id: "pct",
                type: "number",
                role: "hero",
                value: "storageActive.percent",
                text: "{round(storageActive.percent)}",
                unit: "%",
              },
              {
                id: "temp",
                type: "text",
                role: "value",
                text: "{bind.tempText}",
                visible: "len(bind.tempText) > 0",
              },
            ],
          },
          {
            id: "bar",
            type: "bar",
            value: "bind.ratio",
            color: "ramp(bind.ratio, 'load')",
          },
          {
            id: "foot",
            type: "row",
            align: "center",
            justify: "between",
            gap: 2,
            children: [
              { id: "free", type: "text", role: "caption", text: "{bind.freeText}" },
              healthBadge("health"),
            ],
          },
        ],
      },
    },
    {
      sizes: ["M"],
      root: {
        id: "root",
        type: "column",
        justify: "between",
        gap: 2,
        children: [
          driveList("drives", 3),
          {
            id: "foot",
            type: "row",
            align: "center",
            justify: "between",
            gap: 2,
            children: [
              {
                id: "io",
                type: "text",
                role: "caption",
                text: "{bind.ioText}",
                visible: "len(bind.ioText) > 0",
              },
              {
                id: "actions",
                type: "row",
                gap: 1,
                children: [ejectBtn("eject"), powerOffBtn("power-off")],
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
            gap: 2,
            children: [
              {
                id: "title-col",
                type: "column",
                gap: 0,
                children: [
                  {
                    id: "model",
                    type: "text",
                    role: "title",
                    text: "{storageActive.model ?? 'Storage'}",
                  },
                  { id: "io", type: "text", role: "caption", text: "{bind.ioText}" },
                ],
              },
              healthBadge("health"),
            ],
          },
          driveList("drives", 5),
          {
            id: "actions",
            type: "row",
            gap: 2,
            children: [ejectBtn("eject"), powerOffBtn("power-off")],
          },
        ],
      },
    },
  ],
};

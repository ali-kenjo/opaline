// GPU widget as a 2.0 composition (PLAN-2 4.4, brief §8.1). Kept equal to
// spec/compositions/gpu.json, which the Rust validator checks.
//
// Reads `gpu0.*` and `gpu1.*` (aliased from `gpu.0.*` / `gpu.1.*` by `gpu.compositionTopics`):
// - iGPU (gpu0) and dGPU (gpu1) side by side at M/L/XL when multiple GPUs exist
// - Engine busyness bars (3D, video, copy, compute)
// - VRAM bar, power vs. limit gauge, clocks, fan, top apps
// - Elegant asleep state (moon icon + "Asleep · 0 W") — never wakes a sleeping dGPU (ADR 0003)
import type { Composition, Node } from "../compose/model.gen";

const thermalBadge = (id: string, tempExpr: string, textExpr: string): Node => ({
  id,
  type: "canvas",
  visual: "thermal-badge",
  label: "GPU temperature",
  params: {
    tempC: tempExpr,
    text: textExpr,
  },
});

const engines = (id: string, prefix: "gpu0" | "gpu1"): Node => ({
  id,
  type: "canvas",
  visual: "gpu-engines",
  label: "GPU engines",
  params: {
    render3d: `${prefix}.engines.render3d`,
    video: `${prefix}.engines.video`,
    copy: `${prefix}.engines.copy`,
    compute: `${prefix}.engines.compute`,
  },
});

const asleepBox = (id: string, nameExpr: string, visibleExpr: string): Node => ({
  id,
  type: "column",
  align: "center",
  justify: "center",
  gap: 1,
  grow: 1,
  visible: visibleExpr,
  children: [
    { id: `${id}-name`, type: "text", role: "caption", text: `{${nameExpr}}` },
    { id: `${id}-moon`, type: "icon", icon: "bedtime", filled: "true" },
    { id: `${id}-txt`, type: "text", role: "value", text: "Asleep · 0 W" },
  ],
});

const topApps = (id: string, appsExpr: string, max: number): Node => ({
  id,
  type: "canvas",
  visual: "app-list",
  label: "Top GPU apps",
  params: {
    apps: appsExpr,
    metric: "'gpu'",
    binary: "bind.binary",
    max: String(max),
  },
});

export const gpuComposition: Composition = {
  version: 1,
  bindings: {
    hasMulti: "len(gpu.list) > 1 && opt.multiGpu != 'single'",
    binary: "opt.byteUnit == 'gib'",
    byteStyle: "if(bind.binary, 'iec', 'si')",
    g0Name: "gpu.list[0].name ?? 'Integrated GPU'",
    g1Name: "gpu.list[1].name ?? 'Discrete GPU'",
    g0Awake: "gpu0.state.awake != false",
    g1Awake: "gpu1.state.awake != false",
    // Primary GPU mirrors `opt.primaryIndex` (discrete when auto & present, else 0).
    useOne: "opt.primaryIndex == 1 && len(gpu.list) > 1",
    pName: "if(bind.useOne, bind.g1Name, bind.g0Name)",
    pAwake: "if(bind.useOne, bind.g1Awake, bind.g0Awake)",
    pLoad: "if(bind.useOne, gpu1.load, gpu0.load)",
    pTemp: "if(bind.useOne, gpu1.temp, gpu0.temp)",
    pTempDisp: "if(opt.tempUnit == 'f', bind.pTemp * 9 / 5 + 32, bind.pTemp)",
    pTempText:
      "if(bind.pTempDisp != null, string(round(bind.pTempDisp)) + if(opt.tempUnit == 'f', '°F', '°'), '—')",
    g1TempDisp: "if(opt.tempUnit == 'f', gpu1.temp * 9 / 5 + 32, gpu1.temp)",
    g1TempText:
      "if(bind.g1TempDisp != null, string(round(bind.g1TempDisp)) + if(opt.tempUnit == 'f', '°F', '°'), '—')",
    pVramRatio: "clamp((if(bind.useOne, gpu1.vram.percent, gpu0.vram.percent) ?? 0) / 100, 0, 1)",
    pVramText:
      "if(if(bind.useOne, gpu1.vram.totalB, gpu0.vram.totalB) != null, bytes(if(bind.useOne, gpu1.vram.usedB, gpu0.vram.usedB) ?? 0, bind.byteStyle) + ' / ' + bytes(if(bind.useOne, gpu1.vram.totalB, gpu0.vram.totalB), bind.byteStyle), 'Shared memory')",
    g1VramRatio: "clamp((gpu1.vram.percent ?? 0) / 100, 0, 1)",
    g1VramText:
      "if(gpu1.vram.totalB != null, bytes(gpu1.vram.usedB ?? 0, bind.byteStyle) + ' / ' + bytes(gpu1.vram.totalB, bind.byteStyle), 'Shared')",
    pPowerW: "if(bind.useOne, gpu1.power.watts, gpu0.power.watts)",
    pLimitW: "if(bind.useOne, gpu1.power.limitW, gpu0.power.limitW)",
    pPowerRatio:
      "if(bind.pPowerW != null && bind.pLimitW != null && bind.pLimitW > 0, clamp(bind.pPowerW / bind.pLimitW, 0, 1), 0)",
    pPowerText:
      "if(bind.pPowerW != null, fixed(bind.pPowerW, 1) + ' W' + if(bind.pLimitW != null, ' / ' + string(round(bind.pLimitW)) + ' W', ''), '—')",
    g0ClockText:
      "if(gpu0.clocks.coreMHz != null, string(round(gpu0.clocks.coreMHz)) + ' MHz', '—')",
    g1ClockText:
      "if(gpu1.clocks.coreMHz != null, string(round(gpu1.clocks.coreMHz)) + ' MHz', '—')",
    pClockText: "if(bind.useOne, bind.g1ClockText, bind.g0ClockText)",
    pFanText:
      "if(if(bind.useOne, gpu1.fan.rpm, gpu0.fan.rpm) != null, string(round(if(bind.useOne, gpu1.fan.rpm, gpu0.fan.rpm))) + ' rpm', if(if(bind.useOne, gpu1.fan.percent, gpu0.fan.percent) != null, string(round(if(bind.useOne, gpu1.fan.percent, gpu0.fan.percent))) + '%', ''))",
    pApps: "if(bind.useOne, gpu1.processes, gpu0.processes)",
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
            id: "load",
            type: "number",
            role: "hero",
            value: "bind.pLoad",
            text: "{round(bind.pLoad)}",
            unit: "%",
            visible: "bind.pAwake",
          },
          { id: "moon", type: "icon", icon: "bedtime", filled: "true", visible: "!bind.pAwake" },
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
          asleepBox("asleep", "bind.pName", "!bind.pAwake"),
          {
            id: "awake-row",
            type: "row",
            align: "center",
            justify: "between",
            gap: 2,
            grow: 1,
            visible: "bind.pAwake",
            children: [
              {
                id: "load",
                type: "number",
                role: "hero",
                value: "bind.pLoad",
                text: "{round(bind.pLoad)}",
                unit: "%",
              },
              {
                id: "meta",
                type: "column",
                gap: 0,
                children: [
                  { id: "vram", type: "text", role: "caption", text: "{bind.pVramText}" },
                  { id: "pwr", type: "text", role: "caption", text: "{bind.pPowerText}" },
                ],
              },
              thermalBadge("temp", "bind.pTemp", "bind.pTempText"),
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
          asleepBox("asleep", "bind.pName", "!bind.pAwake"),
          {
            id: "awake",
            type: "column",
            justify: "between",
            gap: 2,
            grow: 1,
            visible: "bind.pAwake",
            children: [
              {
                id: "top",
                type: "row",
                align: "center",
                justify: "between",
                gap: 2,
                children: [
                  {
                    id: "load",
                    type: "number",
                    role: "hero",
                    value: "bind.pLoad",
                    text: "{round(bind.pLoad)}",
                    unit: "%",
                  },
                  thermalBadge("temp", "bind.pTemp", "bind.pTempText"),
                ],
              },
              {
                id: "vram-col",
                type: "column",
                gap: 1,
                children: [
                  {
                    id: "vram-lbl",
                    type: "text",
                    role: "caption",
                    text: "VRAM · {bind.pVramText}",
                  },
                  {
                    id: "vram-bar",
                    type: "bar",
                    value: "bind.pVramRatio",
                    color: "ramp(bind.pVramRatio, 'load')",
                  },
                ],
              },
              {
                id: "foot",
                type: "row",
                justify: "between",
                gap: 2,
                children: [
                  { id: "pwr", type: "text", role: "caption", text: "{bind.pPowerText}" },
                  { id: "clk", type: "text", role: "caption", text: "{bind.pClockText}" },
                ],
              },
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
            id: "dual",
            type: "row",
            align: "stretch",
            gap: 3,
            grow: 1,
            visible: "bind.hasMulti",
            children: [
              {
                id: "igpu",
                type: "column",
                justify: "between",
                gap: 1,
                grow: 1,
                children: [
                  { id: "igpu-name", type: "text", role: "caption", text: "{bind.g0Name}" },
                  {
                    id: "igpu-load",
                    type: "number",
                    role: "hero",
                    value: "gpu0.load",
                    text: "{if(gpu0.load != null, string(round(gpu0.load)), '—')}",
                    unit: "%",
                  },
                  { id: "igpu-clk", type: "text", role: "value", text: "{bind.g0ClockText}" },
                  { id: "igpu-mem", type: "text", role: "caption", text: "Shared memory" },
                ],
              },
              { id: "div", type: "divider", axis: "vertical" },
              asleepBox("dgpu-asleep", "bind.g1Name", "!bind.g1Awake"),
              {
                id: "dgpu",
                type: "column",
                justify: "between",
                gap: 1,
                grow: 1,
                visible: "bind.g1Awake",
                children: [
                  { id: "dgpu-name", type: "text", role: "caption", text: "{bind.g1Name}" },
                  {
                    id: "dgpu-top",
                    type: "row",
                    align: "center",
                    justify: "between",
                    gap: 1,
                    children: [
                      {
                        id: "dgpu-load",
                        type: "number",
                        role: "hero",
                        value: "gpu1.load",
                        text: "{if(gpu1.load != null, string(round(gpu1.load)), '—')}",
                        unit: "%",
                      },
                      thermalBadge("dgpu-temp", "gpu1.temp", "bind.g1TempText"),
                    ],
                  },
                  { id: "dgpu-vram-txt", type: "text", role: "caption", text: "{bind.g1VramText}" },
                  {
                    id: "dgpu-vram-bar",
                    type: "bar",
                    value: "bind.g1VramRatio",
                    color: "ramp(bind.g1VramRatio, 'load')",
                  },
                ],
              },
            ],
          },
          {
            id: "single",
            type: "row",
            align: "stretch",
            gap: 3,
            grow: 1,
            visible: "!bind.hasMulti",
            children: [
              asleepBox("single-asleep", "bind.pName", "!bind.pAwake"),
              {
                id: "single-awake",
                type: "row",
                align: "stretch",
                gap: 3,
                grow: 1,
                visible: "bind.pAwake",
                children: [
                  {
                    id: "s-left",
                    type: "column",
                    justify: "between",
                    gap: 1,
                    children: [
                      { id: "s-name", type: "text", role: "caption", text: "{bind.pName}" },
                      {
                        id: "s-load",
                        type: "number",
                        role: "hero",
                        value: "bind.pLoad",
                        text: "{round(bind.pLoad)}",
                        unit: "%",
                      },
                      { id: "s-vram-txt", type: "text", role: "caption", text: "{bind.pVramText}" },
                      {
                        id: "s-vram-bar",
                        type: "bar",
                        value: "bind.pVramRatio",
                        color: "ramp(bind.pVramRatio, 'load')",
                      },
                    ],
                  },
                  {
                    id: "s-right",
                    type: "column",
                    justify: "between",
                    gap: 2,
                    grow: 1,
                    children: [
                      {
                        id: "s-stats",
                        type: "row",
                        align: "center",
                        justify: "between",
                        gap: 2,
                        children: [
                          {
                            id: "s-pwr",
                            type: "column",
                            gap: 0,
                            children: [
                              { id: "s-w", type: "text", role: "value", text: "{bind.pPowerText}" },
                              {
                                id: "s-clk",
                                type: "text",
                                role: "caption",
                                text: "{bind.pClockText}",
                              },
                            ],
                          },
                          thermalBadge("s-temp", "bind.pTemp", "bind.pTempText"),
                        ],
                      },
                      { ...engines("eng1", "gpu1"), visible: "bind.useOne" },
                      { ...engines("eng0", "gpu0"), visible: "!bind.useOne" },
                    ],
                  },
                ],
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
            id: "top",
            type: "row",
            align: "stretch",
            gap: 3,
            children: [
              {
                id: "igpu",
                type: "column",
                justify: "between",
                gap: 1,
                grow: 1,
                visible: "bind.hasMulti",
                children: [
                  { id: "igpu-name", type: "text", role: "title", text: "{bind.g0Name}" },
                  {
                    id: "igpu-load",
                    type: "number",
                    role: "hero",
                    value: "gpu0.load",
                    text: "{if(gpu0.load != null, string(round(gpu0.load)), '—')}",
                    unit: "%",
                  },
                  {
                    id: "igpu-clk",
                    type: "text",
                    role: "caption",
                    text: "{bind.g0ClockText} · Shared",
                  },
                ],
              },
              { id: "div", type: "divider", axis: "vertical", visible: "bind.hasMulti" },
              asleepBox("p-asleep", "bind.pName", "!bind.pAwake"),
              {
                id: "primary",
                type: "column",
                justify: "between",
                gap: 1,
                grow: 1,
                visible: "bind.pAwake",
                children: [
                  { id: "p-name", type: "text", role: "title", text: "{bind.pName}" },
                  {
                    id: "p-row",
                    type: "row",
                    align: "center",
                    justify: "between",
                    gap: 2,
                    children: [
                      {
                        id: "p-load",
                        type: "number",
                        role: "hero",
                        value: "bind.pLoad",
                        text: "{round(bind.pLoad)}",
                        unit: "%",
                      },
                      thermalBadge("p-temp", "bind.pTemp", "bind.pTempText"),
                    ],
                  },
                  {
                    id: "p-vram-txt",
                    type: "text",
                    role: "caption",
                    text: "VRAM · {bind.pVramText}",
                  },
                  {
                    id: "p-vram-bar",
                    type: "bar",
                    value: "bind.pVramRatio",
                    color: "ramp(bind.pVramRatio, 'load')",
                  },
                ],
              },
            ],
          },
          {
            id: "mid",
            type: "row",
            align: "stretch",
            gap: 3,
            grow: 1,
            visible: "bind.pAwake",
            children: [
              {
                id: "pwr-box",
                type: "column",
                align: "center",
                justify: "center",
                gap: 1,
                children: [
                  {
                    id: "pwr-gauge",
                    type: "ring",
                    value: "bind.pPowerRatio",
                    sweep: 220,
                    ticks: 7,
                    color: "ramp(bind.pPowerRatio, 'load')",
                  },
                  { id: "pwr-val", type: "text", role: "caption", text: "{bind.pPowerText}" },
                  {
                    id: "fan-val",
                    type: "text",
                    role: "caption",
                    text: "Fan {bind.pFanText}",
                    visible: "len(bind.pFanText) > 0",
                  },
                ],
              },
              {
                id: "eng-box",
                type: "column",
                justify: "center",
                gap: 2,
                grow: 1,
                children: [
                  { ...engines("eng1", "gpu1"), visible: "bind.useOne" },
                  { ...engines("eng0", "gpu0"), visible: "!bind.useOne" },
                  { id: "clk-line", type: "text", role: "caption", text: "Core {bind.pClockText}" },
                ],
              },
            ],
          },
          topApps("apps", "bind.pApps", 3),
        ],
      },
    },
  ],
};

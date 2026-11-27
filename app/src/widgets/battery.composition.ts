// Battery & Power widget as a 2.0 composition (PLAN-2 4.7, brief §8.1). Kept equal to
// spec/compositions/battery.json, which the Rust validator checks.
//
// Features:
// - Liquid pill hero with bubbles while charging (0 frames when idle/still)
// - Time to full or empty, power draw W, battery health, charge-limit status (where supported)
// - Power-profile switch buttons (`set-power-profile`) at M and L
// - Connected peripheral batteries with device icons at L
import type { Composition, Node } from "../compose/model.gen";

const pill = (id: string): Node => ({
  id,
  type: "canvas",
  visual: "battery-pill",
  label: "Battery charge",
  params: {
    percent: "power.battery.percent",
    state: "power.battery.state",
    sub: "bind.timeText",
    color: "ramp(bind.ratio, 'health')",
  },
});

const profileBtn = (id: string, profile: string, label: string, icon: string): Node => ({
  id,
  type: "button",
  text: label,
  icon,
  visible: "opt.profileButtons == true && has(power.profile.available, '" + profile + "')",
  command: {
    cmd: "set-power-profile",
    args: { profile: `'${profile}'` },
  },
});

const peripherals = (id: string, max: number): Node => ({
  id,
  type: "canvas",
  visual: "peripheral-list",
  label: "Peripheral batteries",
  visible: "len(power.peripherals) > 0",
  params: {
    devices: "power.peripherals",
    max: String(max),
  },
});

export const batteryComposition: Composition = {
  version: 1,
  bindings: {
    ratio: "clamp((power.battery.percent ?? 0) / 100, 0, 1)",
    timeText:
      "if(power.battery.state == 'charging' && power.battery.timeToFullS != null, duration(power.battery.timeToFullS) + ' to full', if(power.battery.state == 'discharging' && power.battery.timeToEmptyS != null, duration(power.battery.timeToEmptyS) + ' left', power.battery.state ?? ''))",
    rateText: "if(power.battery.rateW != null, fixed(power.battery.rateW, 1) + ' W', '')",
    healthText:
      "if(power.battery.capacityPercent != null, 'Health ' + string(round(power.battery.capacityPercent)) + '%', '')",
    limitText:
      "if(power.battery.chargeThresholdEnabled == true && power.battery.chargeEndThreshold != null, 'Limit ' + string(round(power.battery.chargeEndThreshold)) + '%', '')",
    profileText: "power.profile.active ?? ''",
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
            value: "power.battery.percent",
            text: "{round(power.battery.percent)}",
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
          pill("pill"),
          {
            id: "meta",
            type: "column",
            align: "end",
            gap: 0,
            children: [
              { id: "rate", type: "text", role: "value", text: "{bind.rateText}" },
              { id: "health", type: "text", role: "caption", text: "{bind.healthText}" },
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
          pill("pill"),
          {
            id: "foot",
            type: "row",
            align: "center",
            justify: "between",
            gap: 2,
            children: [
              { id: "rate", type: "text", role: "value", text: "{bind.rateText}" },
              { id: "health", type: "text", role: "caption", text: "{bind.healthText}" },
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
          {
            id: "top",
            type: "row",
            align: "center",
            gap: 3,
            grow: 1,
            children: [
              pill("pill"),
              {
                id: "stats",
                type: "column",
                justify: "center",
                gap: 1,
                children: [
                  { id: "rate", type: "text", role: "value", text: "{bind.rateText}" },
                  { id: "health", type: "text", role: "caption", text: "{bind.healthText}" },
                  {
                    id: "limit",
                    type: "text",
                    role: "badge",
                    text: "{bind.limitText}",
                    visible: "len(bind.limitText) > 0",
                  },
                ],
              },
            ],
          },
          {
            id: "profiles",
            type: "row",
            gap: 1,
            visible: "opt.profileButtons == true && len(power.profile.available) > 0",
            children: [
              profileBtn("p-saver", "power-saver", "Saver", "eco"),
              profileBtn("p-balanced", "balanced", "Balanced", "tune"),
              profileBtn("p-perf", "performance", "Perf", "rocket_launch"),
            ],
          },
        ],
      },
    },
    {
      sizes: ["L"],
      root: {
        id: "root",
        type: "column",
        justify: "between",
        gap: 3,
        children: [
          {
            id: "top",
            type: "row",
            align: "center",
            gap: 3,
            children: [
              pill("pill"),
              {
                id: "stats",
                type: "column",
                gap: 1,
                children: [
                  { id: "rate", type: "text", role: "value", text: "{bind.rateText}" },
                  { id: "health", type: "text", role: "caption", text: "{bind.healthText}" },
                  {
                    id: "limit",
                    type: "text",
                    role: "badge",
                    text: "{bind.limitText}",
                    visible: "len(bind.limitText) > 0",
                  },
                ],
              },
            ],
          },
          {
            id: "profiles",
            type: "row",
            gap: 2,
            visible: "opt.profileButtons == true && len(power.profile.available) > 0",
            children: [
              profileBtn("p-saver", "power-saver", "Saver", "eco"),
              profileBtn("p-balanced", "balanced", "Balanced", "tune"),
              profileBtn("p-perf", "performance", "Performance", "rocket_launch"),
            ],
          },
          peripherals("devices", 4),
        ],
      },
    },
  ],
};

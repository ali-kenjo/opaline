// Battery & Power widget: charge, charging state and time, power draw, battery health, AC,
// the power profile (switchable on the card) and wireless devices' batteries.
import type { Value } from "../layer/protocol";
import { fixed, map, missingReason, num, percent, text } from "./format";
import type { CardStatus, ReadCtx, Reading, WidgetAction, WidgetDef } from "./types";

const BATTERY = "power.battery";
const AC = "power.ac";
const PROFILE = "power.profile";
const PERIPHERALS = "power.peripherals";

const bat = (c: ReadCtx) => map(c.get(BATTERY));

export function duration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${String(h)} h ${String(m).padStart(2, "0")} min` : `${String(m)} min`;
}

const STATE: Record<string, string> = {
  charging: "Charging",
  discharging: "On battery",
  full: "Full",
  "pending-charge": "Not charging",
  "pending-discharge": "Waiting",
  empty: "Empty",
  unknown: "Unknown",
};

const PROFILES: Record<string, { label: string; icon: "eco" | "tune" | "rocket_launch" }> = {
  "power-saver": { label: "Saver", icon: "eco" },
  balanced: { label: "Balanced", icon: "tune" },
  performance: { label: "Performance", icon: "rocket_launch" },
};

function peripherals(v: Value | undefined): { name: string; percent: number | null }[] {
  if (v?.kind !== "list") return [];
  return v.v.flatMap((p) =>
    p.kind === "map"
      ? [{ name: text(p.v.model) ?? text(p.v.kind) ?? "Device", percent: num(p.v.percent) }]
      : [],
  );
}

export const battery: WidgetDef = {
  kind: "battery",
  name: "Battery & Power",
  icon: "battery_full",
  category: "system",
  sizes: ["1x1", "2x1", "4x1", "S", "M", "L"],
  defaultSize: "S",
  heroStyles: ["ring", "number", "bar"],
  defaultFields: ["percent", "state", "time", "rate"],
  fields: [
    {
      id: "percent",
      label: "Charge",
      icon: "battery_full",
      topics: [BATTERY],
      read: (c) => {
        const p = num(bat(c)?.percent);
        return p === null
          ? null
          : { text: percent(p, c.content.decimals), value: p, ratio: p / 100, ramp: "health" };
      },
    },
    {
      id: "state",
      label: "State",
      icon: "battery_charging_full",
      topics: [BATTERY],
      hero: false,
      read: (c) => {
        const s = text(bat(c)?.state);
        return s ? { text: STATE[s] ?? s } : null;
      },
    },
    {
      id: "time",
      label: "Time left",
      icon: "timer",
      topics: [BATTERY],
      hero: false,
      read: (c): Reading | null => {
        const b = bat(c);
        const s = text(b?.state);
        const toEmpty = num(b?.timeToEmptyS);
        const toFull = num(b?.timeToFullS);
        if (s === "charging" && toFull) return { text: `${duration(toFull)} to full` };
        if (s === "discharging" && toEmpty) return { text: duration(toEmpty) };
        return null;
      },
    },
    {
      id: "rate",
      label: "Power draw",
      icon: "electric_bolt",
      topics: [BATTERY],
      read: (c) => {
        const w = num(bat(c)?.rateW);
        return w === null
          ? null
          : {
              text: `${fixed(w, Math.max(1, c.content.decimals))} W`,
              value: w,
              ratio: Math.min(1, w / 60),
              ramp: "load",
            };
      },
    },
    {
      id: "health",
      label: "Battery health",
      icon: "battery_alert",
      topics: [BATTERY],
      read: (c) => {
        const h = num(bat(c)?.capacityPercent);
        return h === null
          ? null
          : {
              text: percent(h, 0),
              value: h,
              ratio: h / 100,
              ramp: "health",
              sub: "capacity left vs. new",
            };
      },
    },
    {
      id: "energy",
      label: "Energy",
      icon: "bolt",
      topics: [BATTERY],
      hero: false,
      read: (c) => {
        const b = bat(c);
        const e = num(b?.energyWh);
        const full = num(b?.energyFullWh);
        return e === null ? null : { text: `${fixed(e, 1)} / ${fixed(full ?? 0, 1)} Wh` };
      },
    },
    {
      id: "cycles",
      label: "Cycles",
      icon: "refresh",
      topics: [BATTERY],
      hero: false,
      read: (c) => {
        const n = num(bat(c)?.cycles);
        return n === null ? null : { text: fixed(n, 0) };
      },
    },
    {
      id: "ac",
      label: "Power adapter",
      icon: "power",
      topics: [AC],
      hero: false,
      read: (c) => {
        const a = c.get(AC);
        return a?.kind === "bool" ? { text: a.v ? "Plugged in" : "Unplugged" } : null;
      },
    },
    {
      id: "profile",
      label: "Power mode",
      icon: "tune",
      topics: [PROFILE],
      hero: false,
      read: (c) => {
        const p = text(map(c.get(PROFILE))?.active);
        return p ? { text: PROFILES[p]?.label ?? p } : null;
      },
    },
    {
      id: "devices",
      label: "Devices",
      icon: "device_hub",
      topics: [PERIPHERALS],
      hero: false,
      read: (c) => {
        const list = peripherals(c.get(PERIPHERALS));
        return list.length
          ? {
              text: list
                .map((d) => `${d.name} ${d.percent === null ? "—" : percent(d.percent, 0)}`)
                .join(" · "),
            }
          : null;
      },
    },
    {
      id: "model",
      label: "Battery",
      icon: "info",
      topics: [BATTERY],
      hero: false,
      read: (c) => {
        const b = bat(c);
        const m = [text(b?.vendor), text(b?.model)].filter(Boolean).join(" ");
        return m ? { text: m } : null;
      },
    },
  ],
  options: [
    {
      kind: "bool",
      key: "profileButtons",
      label: "Power mode buttons",
      help: "Switch power mode from the card (M and larger).",
      default: true,
    },
  ],
  actions(c): WidgetAction[] {
    if (!c.content.opt<boolean>("profileButtons")) return [];
    const p = map(c.get(PROFILE));
    const active = text(p?.active);
    const available =
      p?.available?.kind === "list"
        ? p.available.v.flatMap((x) => (x.kind === "text" ? [x.v] : []))
        : [];
    return available.map((id) => ({
      id,
      label: PROFILES[id]?.label ?? id,
      icon: PROFILES[id]?.icon ?? "tune",
      command: { cmd: "set-power-profile", profile: id },
      active: id === active,
    }));
  },
  extraTopics: (c) => (c.content.opt<boolean>("profileButtons") ? [PROFILE] : []),
  status(c): CardStatus {
    const b = c.get(BATTERY);
    if (b === undefined) return { kind: "loading" };
    // Desktops have no battery; the card still works if it shows power mode or devices.
    const noBattery = missingReason(b) !== null;
    const other = c.content.fields.some((f) => f === "ac" || f === "profile" || f === "devices");
    if (noBattery && !other) return { kind: "unavailable", reason: "No battery on this device" };
    return { kind: "ready" };
  },
};

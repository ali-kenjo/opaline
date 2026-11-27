// Network widget: download and upload of one interface (or the primary connection), Wi-Fi,
// latency, connectivity, VPN, public IP and data used today / this billing period.
import { defaultOptions } from "../compose/widget";
import type { Value } from "../layer/protocol";
import { type ByteUnit, bytes, fixed, map, missingReason, num, text } from "./format";
import { networkComposition } from "./network.composition";
import { BYTE_UNIT, levels } from "./options";
import type { CardStatus, Choice, ReadCtx, Reading, WidgetDef } from "./types";

const IFACES = "network.interfaces";
const RATES = "network.rates";
const PRIMARY = "network.primary";
const WIFI = "network.wifi";
const LATENCY = "network.latency";
const CONNECTIVITY = "network.connectivity";
const VPN = "network.vpn";
const PUBLIC_IP = "network.publicIp";
const USAGE = "network.usage";

type RateUnit = "bits" | "bytes";

/** A rate in bit/s (Mbit/s…) or byte/s (MB/s…). */
export function netRate(bps: number, unit: RateUnit, decimals: number): string {
  if (unit === "bytes") return `${bytes(bps, "si", Math.max(1, decimals))}/s`;
  const bits = bps * 8;
  const names = ["bit/s", "kbit/s", "Mbit/s", "Gbit/s"];
  let v = bits;
  let i = 0;
  while (v >= 1000 && i < names.length - 1) {
    v /= 1000;
    i++;
  }
  return `${fixed(v, i === 0 ? 0 : Math.max(1, decimals))} ${names[i] ?? "bit/s"}`;
}

function interfaces(v: Value | undefined): { name: string; kind: string; up: boolean }[] {
  if (v?.kind !== "list") return [];
  return v.v.flatMap((i) =>
    i.kind === "map"
      ? [
          {
            name: text(i.v.name) ?? "?",
            kind: text(i.v.kind) ?? "",
            up: i.v.up?.kind === "bool" && i.v.up.v,
          },
        ]
      : [],
  );
}

/** The interface shown: the chosen one, else the primary connection's, else the first one up. */
export function iface(c: ReadCtx): string | null {
  const list = interfaces(c.get(IFACES));
  const want = c.content.opt<string>("interface");
  if (want !== "auto" && list.some((i) => i.name === want)) return want;
  const wifi = text(map(c.get(WIFI))?.interface);
  const primary = text(map(c.get(PRIMARY))?.type);
  if (primary === "wifi" && wifi) return wifi;
  return (
    (list.find((i) => i.up && i.kind === (primary ?? "")) ?? list.find((i) => i.up) ?? list[0])
      ?.name ?? null
  );
}

const unit = (c: ReadCtx) => c.content.opt<RateUnit>("rateUnit");
const rates = (c: ReadCtx) => {
  const i = iface(c);
  return i ? map(map(c.get(RATES))?.[i]) : null;
};
/** The graph and ring scale: the user's line speed. */
const scale = (c: ReadCtx) => c.content.opt<number>("lineMbps") * 125_000;

function rateField(
  id: string,
  label: string,
  key: "rxBps" | "txBps",
  icon: "download" | "upload",
): WidgetDef["fields"][number] {
  return {
    id,
    label,
    icon,
    topics: [RATES],
    read: (c): Reading | null => {
      const v = num(rates(c)?.[key]);
      return v === null
        ? null
        : {
            text: netRate(v, unit(c), c.content.decimals),
            value: v,
            ratio: Math.min(1, v / scale(c)),
            ramp: "load",
          };
    },
  };
}

function dataUsed(c: ReadCtx, rx: string, tx: string): Reading | null {
  const u = map(c.get(USAGE));
  const r = num(u?.[rx]);
  const t = num(u?.[tx]);
  const bu = c.content.opt<ByteUnit>("byteUnit");
  return r === null
    ? null
    : { text: `↓ ${bytes(r, bu, 1)} ↑ ${bytes(t ?? 0, bu, 1)}`, value: r + (t ?? 0) };
}

export const network: WidgetDef = {
  kind: "network",
  name: "Network",
  icon: "lan",
  category: "network",
  sizes: ["1x1", "2x1", "4x1", "S", "M", "L", "XL"],
  defaultSize: "S",
  heroStyles: ["sparkline", "number", "ring", "bar"],
  topics: [IFACES, PRIMARY, WIFI],
  defaultFields: ["down", "up", "wifi", "latency"],
  fields: [
    rateField("down", "Download", "rxBps", "download"),
    rateField("up", "Upload", "txBps", "upload"),
    {
      id: "wifi",
      label: "Wi-Fi",
      icon: "wifi",
      topics: [WIFI],
      read: (c) => {
        const w = map(c.get(WIFI));
        const signal = num(w?.signal);
        if (signal === null) return null;
        const ssid = c.content.opt<boolean>("showSsid") ? text(w?.ssid) : null;
        return {
          text: `${ssid ? `${ssid} · ` : ""}${fixed(signal, 0)} %`,
          value: signal,
          ratio: signal / 100,
          ramp: "health",
          sub: text(w?.band) ?? undefined,
        } as Reading;
      },
    },
    {
      id: "link",
      label: "Link speed",
      shortLabel: "Link",
      icon: "speed",
      topics: [WIFI],
      read: (c) => {
        const b = num(map(c.get(WIFI))?.bitrateMbps);
        return b === null ? null : { text: `${fixed(b, 0)} Mbit/s`, value: b };
      },
    },
    {
      id: "latency",
      label: "Latency",
      icon: "timer",
      topics: [LATENCY],
      read: (c) => {
        const l = map(c.get(LATENCY));
        const ms = num(l?.ms);
        const jitter = num(l?.jitterMs);
        return ms === null
          ? null
          : ({
              text: `${fixed(ms, ms < 10 ? 1 : 0)} ms${jitter !== null ? ` ± ${fixed(jitter, 1)}` : ""}`,
              value: ms,
              ratio: Math.min(1, ms / 200),
              ramp: "load",
              sub: text(l?.target) ?? undefined,
            } as Reading);
      },
    },
    {
      id: "connectivity",
      label: "Internet",
      shortLabel: "Online",
      icon: "public",
      topics: [CONNECTIVITY],
      hero: false,
      read: (c) => {
        const v = text(c.get(CONNECTIVITY));
        const words: Record<string, string> = {
          full: "Connected",
          limited: "Limited",
          portal: "Sign-in needed",
          none: "Offline",
          unknown: "Unknown",
        };
        return v ? { text: words[v] ?? v } : null;
      },
    },
    {
      id: "vpn",
      label: "VPN",
      icon: "vpn_lock",
      topics: [VPN],
      hero: false,
      read: (c) => {
        const v = map(c.get(VPN));
        if (!v) return null;
        const active = v.active?.kind === "bool" && v.active.v;
        const first = v.connections?.kind === "list" ? v.connections.v[0] : undefined;
        const name = first?.kind === "map" ? text(first.v.name) : null;
        return { text: active ? (name ?? "On") : "Off" };
      },
    },
    {
      id: "publicIp",
      label: "Public IP",
      shortLabel: "IP",
      icon: "language",
      topics: [PUBLIC_IP],
      hero: false,
      read: (c) => {
        const v = c.get(PUBLIC_IP);
        if (missingReason(v) === "disabled-in-settings") return { text: "Off in Settings" };
        const ip = text(map(v)?.ip);
        return ip ? { text: ip } : null;
      },
    },
    {
      id: "today",
      label: "Today",
      icon: "bar_chart",
      topics: [USAGE],
      hero: false,
      read: (c) => dataUsed(c, "todayRxB", "todayTxB"),
    },
    {
      id: "period",
      label: "This period",
      shortLabel: "Period",
      icon: "calendar_today",
      topics: [USAGE],
      hero: false,
      read: (c) => dataUsed(c, "periodRxB", "periodTxB"),
    },
    {
      id: "iface",
      label: "Interface",
      icon: "router",
      topics: [],
      hero: false,
      read: (c) => {
        const i = iface(c);
        return i ? { text: i } : null;
      },
    },
  ],
  options: [
    {
      kind: "source",
      key: "interface",
      label: "Interface",
      topic: IFACES,
      choices: (v): Choice => [
        { value: "auto", label: "Automatic (main connection)" },
        ...interfaces(v).map((i) => ({ value: i.name, label: `${i.name} (${i.kind})` })),
      ],
      default: "auto",
    },
    {
      kind: "enum",
      key: "rateUnit",
      label: "Speed units",
      options: [
        { value: "bits", label: "Mbit/s" },
        { value: "bytes", label: "MB/s" },
      ],
      default: "bits",
    },
    {
      kind: "range",
      key: "lineMbps",
      label: "Line speed",
      help: "Full scale of the ring, bar and graph.",
      min: 1,
      max: 10000,
      step: 1,
      unit: "Mbit/s",
      default: 100,
    },
    {
      kind: "bool",
      key: "showSsid",
      label: "Show network name",
      help: "Off keeps the Wi-Fi name off screen recordings.",
      default: true,
    },
    {
      kind: "bool",
      key: "showIp",
      label: "Show public IP",
      help: "Off hides the public IP address for privacy.",
      default: true,
    },
    {
      kind: "range",
      key: "monthlyCapGb",
      label: "Monthly data cap",
      help: "0 hides the cap ring; set a limit in GB to track billing-period usage.",
      min: 0,
      max: 5000,
      step: 10,
      unit: "GB",
      default: 0,
    },
    BYTE_UNIT,
    levels([150, 300], "For the main value (ms for latency)."),
  ],
  extraTopics: () => [RATES, LATENCY, VPN, USAGE, PUBLIC_IP],
  composition: networkComposition,
  useClassicStat: true,
  compositionOptions: (content) => defaultOptions(network, content),
  compositionTopics(values, content) {
    const ctx: ReadCtx = { get: (k) => values[k], content };
    const name = iface(ctx);
    const r = rates(ctx);
    const active: Record<string, Value> = {};
    if (name) active.name = { kind: "text", v: name };
    const rx = num(r?.rxBps);
    const tx = num(r?.txBps);
    if (rx !== null) active.rxBps = { kind: "num", v: rx };
    if (tx !== null) active.txBps = { kind: "num", v: tx };
    return { ...values, netActive: { kind: "map", v: active } };
  },
  status(c): CardStatus {
    const i = c.get(IFACES);
    if (i === undefined) return { kind: "loading" };
    const reason = missingReason(i);
    if (reason) return { kind: "unavailable", reason: `Network unavailable (${reason})` };
    return iface(c) ? { kind: "ready" } : { kind: "unavailable", reason: "No network interface" };
  },
};

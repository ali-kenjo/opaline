// Network widget as a 2.0 composition (PLAN-2 4.6, brief §8.1). Kept equal to
// spec/compositions/network.json, which the Rust validator checks.
//
// Reads `netActive.*` (derived from the active/chosen interface in `network.compositionTopics`):
// - Dual-wave hero whose speed scales with download/upload throughput
// - Daily & monthly usage against an optional cap as a ring
// - Wi-Fi signal shape, VPN badge, latency + jitter, privacy toggles (SSID and IP)
import type { Composition, Node } from "../compose/model.gen";

const netWave = (id: string): Node => ({
  id,
  type: "canvas",
  visual: "net-wave",
  label: "Network throughput",
  params: {
    rxBps: "netActive.rxBps",
    txBps: "netActive.txBps",
    lineMbps: "opt.lineMbps",
    rateUnit: "opt.rateUnit",
  },
});

const wifiShape = (id: string): Node => ({
  id,
  type: "canvas",
  visual: "wifi-shape",
  label: "Wi-Fi signal",
  visible: "network.wifi.signal != null",
  params: {
    signal: "network.wifi.signal",
    band: "network.wifi.band",
    ssid: "network.wifi.ssid",
    showSsid: "opt.showSsid",
  },
});

const vpnBadge = (id: string): Node => ({
  id,
  type: "text",
  role: "badge",
  text: "{bind.vpnText}",
  visible: "network.vpn.active == true",
});

export const networkComposition: Composition = {
  version: 1,
  bindings: {
    binary: "opt.byteUnit == 'gib'",
    byteStyle: "if(bind.binary, 'iec', 'si')",
    latencyText:
      "if(network.latency.ms != null, string(round(network.latency.ms)) + ' ms' + if(network.latency.jitterMs != null, ' · ±' + fixed(network.latency.jitterMs, 1) + ' ms', ''), '—')",
    vpnText:
      "if(network.vpn.active == true, 'VPN · ' + (network.vpn.connections[0].name ?? 'On'), '')",
    todayB: "(network.usage.todayRxB ?? 0) + (network.usage.todayTxB ?? 0)",
    periodB: "(network.usage.periodRxB ?? 0) + (network.usage.periodTxB ?? 0)",
    todayText:
      "if(network.usage.todayRxB != null, 'Today ' + bytes(bind.todayB, bind.byteStyle), '')",
    periodText:
      "if(network.usage.periodRxB != null, 'Month ' + bytes(bind.periodB, bind.byteStyle), '')",
    capB: "(opt.monthlyCapGb ?? 0) * 1000000000",
    hasCap: "bind.capB > 0 && network.usage.periodRxB != null",
    capRatio: "if(bind.hasCap, clamp(bind.periodB / bind.capB, 0, 1), 0)",
    ipText: "if(opt.showIp && network.publicIp.ip != null, network.publicIp.ip, '')",
  },
  layouts: [
    {
      sizes: ["1x1"],
      root: {
        id: "root",
        type: "column",
        align: "center",
        justify: "center",
        children: [netWave("wave")],
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
          netWave("wave"),
          {
            id: "meta",
            type: "column",
            align: "end",
            gap: 1,
            children: [
              vpnBadge("vpn"),
              { id: "lat", type: "text", role: "caption", text: "{bind.latencyText}" },
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
          netWave("wave"),
          {
            id: "foot",
            type: "row",
            align: "center",
            justify: "between",
            gap: 2,
            children: [
              { id: "lat", type: "text", role: "caption", text: "{bind.latencyText}" },
              vpnBadge("vpn"),
              {
                id: "iface",
                type: "text",
                role: "caption",
                text: "{netActive.name ?? ''}",
                visible: "network.vpn.active != true",
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
          netWave("wave"),
          {
            id: "side",
            type: "column",
            justify: "between",
            gap: 1,
            grow: 1,
            children: [
              wifiShape("wifi"),
              {
                id: "stats",
                type: "row",
                align: "center",
                justify: "between",
                gap: 2,
                children: [
                  { id: "lat", type: "text", role: "caption", text: "Ping {bind.latencyText}" },
                  vpnBadge("vpn"),
                ],
              },
              {
                id: "usage-row",
                type: "row",
                align: "center",
                justify: "between",
                gap: 2,
                children: [
                  {
                    id: "today",
                    type: "text",
                    role: "caption",
                    text: "{bind.todayText}",
                    visible: "len(bind.todayText) > 0",
                  },
                  {
                    id: "cap-ring",
                    type: "ring",
                    value: "bind.capRatio",
                    color: "ramp(bind.capRatio, 'load')",
                    visible: "bind.hasCap",
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
            grow: 1,
            children: [
              netWave("wave"),
              {
                id: "info",
                type: "column",
                justify: "between",
                gap: 1,
                grow: 1,
                children: [
                  wifiShape("wifi"),
                  vpnBadge("vpn"),
                  { id: "lat", type: "text", role: "value", text: "Ping {bind.latencyText}" },
                  {
                    id: "ip",
                    type: "text",
                    role: "caption",
                    text: "IP {bind.ipText}",
                    visible: "len(bind.ipText) > 0",
                  },
                ],
              },
            ],
          },
          {
            id: "bottom",
            type: "row",
            align: "center",
            justify: "between",
            gap: 3,
            children: [
              {
                id: "usage-col",
                type: "column",
                gap: 1,
                children: [
                  { id: "today", type: "text", role: "value", text: "{bind.todayText}" },
                  { id: "period", type: "text", role: "caption", text: "{bind.periodText}" },
                ],
              },
              {
                id: "cap-ring",
                type: "ring",
                value: "bind.capRatio",
                color: "ramp(bind.capRatio, 'load')",
                visible: "bind.hasCap",
              },
            ],
          },
        ],
      },
    },
  ],
};

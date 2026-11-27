// Round 2 compositions (PLAN-2 4.5–4.8): Storage, Network, Battery & Power, Fans.
// Each fixture in spec/compositions/ is also validated by Rust (`opaline-compose`).
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { netWavePath } from "../compose/render/round2Visuals";
import { Runtime, type Env } from "../compose/runtime";
import type { Value } from "../layer/protocol";
import { battery } from "./battery";
import { batteryComposition } from "./battery.composition";
import { resolveContent } from "./content";
import { fansWidget } from "./fans";
import { fansComposition } from "./fans.composition";
import { network } from "./network";
import { networkComposition } from "./network.composition";
import { storage } from "./storage";
import { storageComposition } from "./storage.composition";

const specDir = resolve(import.meta.dirname, "../../../spec/compositions");
const n = (v: number): Value => ({ kind: "num", v });
const t = (v: string): Value => ({ kind: "text", v });
const b = (v: boolean): Value => ({ kind: "bool", v });
const m = (v: Record<string, Value>): Value => ({ kind: "map", v });
const l = (v: Value[]): Value => ({ kind: "list", v });

function checkFixture(name: string, comp: unknown) {
  const path = resolve(specDir, `${name}.json`);
  const text = `${JSON.stringify(comp, null, 2)}\n`;
  if (process.env.OPALINE_UPDATE_FIXTURES) writeFileSync(path, text);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(comp);
}

describe("Round 2 compositions (Storage, Network, Battery, Fans)", () => {
  it("matches spec/compositions/{storage,network,battery,fans}.json fixtures", () => {
    checkFixture("storage", storageComposition);
    checkFixture("network", networkComposition);
    checkFixture("battery", batteryComposition);
    checkFixture("fans", fansComposition);
  });

  it("compiles and evaluates Storage composition with health, I/O, and removable drive actions", () => {
    const c = resolveContent(storage, { volume: "/media/lab/USB", byteUnit: "gb" });
    const raw: Record<string, Value> = {
      "storage.drives": l([
        m({
          name: t("sdb"),
          model: t("SanDisk Ultra"),
          sizeB: n(64e9),
          partitions: l([
            m({ mount: t("/media/lab/USB"), percent: n(71), availB: n(19e9), totalB: n(64e9) }),
          ]),
        }),
      ]),
      "storage.io": m({ sdb: m({ readBps: n(12e6), writeBps: n(4e6) }) }),
      "storage.temps": m({ sdb: m({ tempC: n(36) }) }),
      "storage.health": m({
        sdb: m({ status: t("good"), ejectable: b(true), canPowerOff: b(true) }),
      }),
    };
    const env: Env = {
      topics: storage.compositionTopics?.(raw, c) ?? raw,
      options: storage.compositionOptions?.(c) ?? {},
      locale: "en",
      now: () => 0,
    };
    const rt = new Runtime(storageComposition, env);
    expect(rt.problems()).toEqual([]);
    expect(rt.read("/bindings/healthText").value).toBe("Health OK");
    expect(rt.read("/bindings/tempText").value).toBe("36°");
    expect(rt.read("/bindings/freeText").value).toMatch(/19\.0/);
  });

  it("compiles and evaluates Network composition with jitter, VPN, cap ring, and privacy toggles", () => {
    const c = resolveContent(network, { monthlyCapGb: 100, showIp: false });
    const raw: Record<string, Value> = {
      "network.interfaces": l([m({ name: t("wlo1"), kind: t("wifi"), up: b(true) })]),
      "network.primary": m({ type: t("wifi") }),
      "network.rates": m({ wlo1: m({ rxBps: n(5e6), txBps: n(1e6) }) }),
      "network.wifi": m({
        interface: t("wlo1"),
        ssid: t("HomeNet"),
        signal: n(82),
        band: t("5 GHz"),
      }),
      "network.latency": m({ ms: n(18.2), jitterMs: n(1.4) }),
      "network.vpn": m({ active: b(true), connections: l([m({ name: t("wg-home") })]) }),
      "network.usage": m({
        todayRxB: n(2e9),
        todayTxB: n(0.5e9),
        periodRxB: n(40e9),
        periodTxB: n(10e9),
      }),
      "network.publicIp": m({ ip: t("203.0.113.42") }),
    };
    const env: Env = {
      topics: network.compositionTopics?.(raw, c) ?? raw,
      options: network.compositionOptions?.(c) ?? {},
      locale: "en",
      now: () => 0,
    };
    const rt = new Runtime(networkComposition, env);
    expect(rt.problems()).toEqual([]);
    expect(rt.read("/bindings/latencyText").value).toBe("18 ms · ±1.4 ms");
    expect(rt.read("/bindings/vpnText").value).toBe("VPN · wg-home");
    expect(rt.read("/bindings/capRatio").value).toBeCloseTo(0.5, 4);
    expect(rt.read("/bindings/ipText").value).toBe("");
    expect(netWavePath(8, 0, 50)).toMatch(/^M 0 80 .* Z$/);
  });

  it("compiles and evaluates Battery composition with charge limit, time to full, and profiles", () => {
    const c = resolveContent(battery, { profileButtons: true });
    const env: Env = {
      topics: {
        "power.battery": m({
          percent: n(78),
          state: t("charging"),
          timeToFullS: n(2400),
          rateW: n(32.5),
          capacityPercent: n(89),
          chargeThresholdEnabled: b(true),
          chargeEndThreshold: n(80),
        }),
        "power.profile": m({
          active: t("balanced"),
          available: l([t("power-saver"), t("balanced"), t("performance")]),
        }),
        "power.peripherals": l([m({ kind: t("mouse"), model: t("MX Master 3"), percent: n(64) })]),
      },
      options: battery.compositionOptions?.(c) ?? {},
      locale: "en",
      now: () => 0,
    };
    const rt = new Runtime(batteryComposition, env);
    expect(rt.problems()).toEqual([]);
    expect(rt.read("/bindings/limitText").value).toBe("Limit 80%");
    expect(rt.read("/bindings/healthText").value).toBe("Health 89%");
    expect(rt.read("/bindings/rateText").value).toBe("32.5 W");
  });

  it("compiles and evaluates Fans composition with fastest RPM and CPU/GPU temps", () => {
    const c = resolveContent(fansWidget, { maxRpm: 5000, tempUnit: "c" });
    const raw: Record<string, Value> = {
      "fans.list": l([
        m({ name: t("Fan 1"), rpm: n(2600) }),
        m({ name: t("Fan 2"), rpm: n(3100) }),
      ]),
      "cpu.temp": n(58),
      "gpu.list": l([m({ index: n(0), discrete: b(true) })]),
      "gpu.0.temp": n(51),
    };
    const env: Env = {
      topics: fansWidget.compositionTopics?.(raw, c) ?? raw,
      options: fansWidget.compositionOptions?.(c) ?? {},
      locale: "en",
      now: () => 0,
    };
    const rt = new Runtime(fansComposition, env);
    expect(rt.problems()).toEqual([]);
    expect(rt.read("/bindings/cpuText").value).toBe("CPU 58°");
    expect(rt.read("/bindings/gpuText").value).toBe("GPU 51°");
  });
});

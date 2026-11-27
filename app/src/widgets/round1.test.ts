// Round 1 compositions (PLAN-2 4.2–4.4): CPU, Memory, and GPU.
// Each fixture in spec/compositions/ is also validated by Rust (`opaline-compose`).
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { liquidWavePath, thermalShapeFor } from "../compose/render/monitorVisuals";
import { Runtime, type Env } from "../compose/runtime";
import type { Value } from "../layer/protocol";
import { resolveContent } from "./content";
import { cpu } from "./cpu";
import { cpuComposition } from "./cpu.composition";
import { gpu } from "./gpu";
import { gpuComposition } from "./gpu.composition";
import { memory } from "./memory";
import { memoryComposition } from "./memory.composition";

const specDir = resolve(import.meta.dirname, "../../../spec/compositions");
const n = (v: number): Value => ({ kind: "num", v });
const ns = (v: number[]): Value => ({ kind: "nums", v });
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

describe("Round 1 compositions (CPU, Memory, GPU)", () => {
  it("matches spec/compositions/{cpu,memory,gpu}.json fixtures", () => {
    checkFixture("cpu", cpuComposition);
    checkFixture("memory", memoryComposition);
    checkFixture("gpu", gpuComposition);
  });

  it("compiles and evaluates CPU composition across hero modes and throttling", () => {
    const c = resolveContent(cpu, { heroVisual: "thermal", tempUnit: "c" });
    const env: Env = {
      topics: {
        "cpu.load": n(64.2),
        "cpu.temp": n(71.4),
        "cpu.freq": n(3620),
        "cpu.perThread": ns([50, 70, 62, 80]),
        "cpu.packagePower": n(28.4),
        "cpu.throttle": m({ active: b(true), certain: b(true) }),
      },
      options: cpu.compositionOptions?.(c) ?? {},
      locale: "en",
      now: () => 0,
    };
    const rt = new Runtime(cpuComposition, env);
    expect(rt.problems()).toEqual([]);
    expect(rt.read("/bindings/tempText").value).toBe("71°");
    expect(rt.read("/bindings/freqText").value).toBe("3.62 GHz");
    expect(rt.read("/bindings/powerText").value).toBe("28.4 W");
    expect(thermalShapeFor(38)).toBe("circle");
    expect(thermalShapeFor(55)).toBe("cookie7Sided");
    expect(thermalShapeFor(71)).toBe("softBurst");
    expect(thermalShapeFor(88)).toBe("burst");
  });

  it("compiles and evaluates Memory composition with zram, swap, and liquid fill", () => {
    const c = resolveContent(memory, { byteUnit: "gb", heroVisual: "liquid" });
    const GB = 1e9;
    const env: Env = {
      topics: {
        "memory.usage": m({
          totalB: n(16 * GB),
          usedB: n(8 * GB),
          availableB: n(8 * GB),
          cachedB: n(4 * GB),
          buffersB: n(0.2 * GB),
          shmemB: n(1 * GB),
          percent: n(50),
        }),
        "memory.swap": m({ totalB: n(4 * GB), usedB: n(0.5 * GB), percent: n(12.5) }),
        "memory.zram": m({
          origDataB: n(1.2 * GB),
          comprDataB: n(0.3 * GB),
          memUsedB: n(0.35 * GB),
        }),
        "memory.pressure": m({ some10: n(2.4) }),
      },
      options: memory.compositionOptions?.(c) ?? {},
      locale: "en",
      now: () => 0,
    };
    const rt = new Runtime(memoryComposition, env);
    expect(rt.problems()).toEqual([]);
    expect(rt.read("/bindings/pctText").value).toBe("50%");
    expect(rt.read("/bindings/compressedText").value).toMatch(/zram/);
    expect(liquidWavePath(0.5, 3, 0)).toMatch(/^M 0 100 .* Z$/);
  });

  it("compiles and evaluates GPU composition in dual-GPU mode with a sleeping dGPU", () => {
    const c = resolveContent(gpu, { gpu: "auto", multiGpu: "auto" });
    const rawTopics: Record<string, Value> = {
      "gpu.list": l([
        m({ index: n(0), name: t("UHD Graphics 630"), discrete: b(false) }),
        m({ index: n(1), name: t("GTX 1660 Ti"), discrete: b(true) }),
      ]),
      "gpu.0.state": m({ awake: b(true) }),
      "gpu.0.load": n(14),
      "gpu.0.clocks": m({ coreMHz: n(650) }),
      "gpu.1.state": m({ awake: b(false) }),
    };
    const env: Env = {
      topics: gpu.compositionTopics?.(rawTopics) ?? rawTopics,
      options: gpu.compositionOptions?.(c) ?? {},
      locale: "en",
      now: () => 0,
    };
    const rt = new Runtime(gpuComposition, env);
    expect(rt.problems()).toEqual([]);
    expect(rt.read("/bindings/hasMulti").value).toBe(true);
    expect(rt.read("/bindings/g0Awake").value).toBe(true);
    expect(rt.read("/bindings/g1Awake").value).toBe(false);
    expect(rt.read("/bindings/g0ClockText").value).toBe("650 MHz");
  });
});

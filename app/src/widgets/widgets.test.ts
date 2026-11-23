import { describe, expect, it } from "vitest";
import { mockValues } from "../lab/labHost";
import { resolveContent } from "./content";
import { clock } from "./clock";
import { cpu } from "./cpu";
import { bytes, frequency, temperature } from "./format";
import { fromJson, mergePatch, toJson } from "./json";
import { storedSettings } from "./layerHost";
import { WIDGETS } from "./registry";

describe("content", () => {
  it("falls back to the widget's defaults", () => {
    const c = resolveContent(cpu, undefined);
    expect(c.fields).toEqual(["load", "temp", "freq"]);
    expect(c.hero).toBe("load");
    expect(c.heroStyle).toBe("ring");
    expect(c.title).toBe("CPU");
    expect(c.opt("tempUnit")).toBe("c");
    expect(c.opt("levels")).toEqual([85, 95]);
  });

  it("keeps valid choices and drops invalid ones", () => {
    const c = resolveContent(cpu, {
      fields: ["temp", "bogus", "load", "temp"],
      labels: { load: "Auslastung", nope: "x", temp: "" },
      hero: "cores",
      heroStyle: "pie",
      decimals: 7,
      tempUnit: "f",
      levels: [90, 80],
      title: "Prozessor",
    });
    expect(c.fields).toEqual(["temp", "load"]);
    expect(c.label("load", "Load")).toBe("Auslastung");
    expect(c.label("temp", "Temperature")).toBe("Temperature");
    expect(c.hero).toBe("temp");
    expect(c.heroStyle).toBe("ring");
    expect(c.decimals).toBe(0);
    expect(c.opt("tempUnit")).toBe("f");
    expect(c.opt("levels")).toEqual([85, 95]);
    expect(c.title).toBe("Prozessor");
  });

  it("every widget declares consistent fields", () => {
    for (const w of WIDGETS) {
      const ids = w.fields.map((f) => f.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const d of w.defaultFields) expect(ids).toContain(d);
      expect(w.sizes).toContain(w.defaultSize);
      expect(resolveContent(w, null).fields.length).toBeGreaterThan(0);
    }
  });
});

describe("cpu fields", () => {
  const values = mockValues(50);
  const ctx = (content: unknown) => ({
    get: (t: string) => values[t],
    content: resolveContent(cpu, content),
  });
  const read = (id: string, content: unknown = {}) =>
    cpu.fields.find((f) => f.id === id)?.read(ctx(content));

  it("reads and formats with the chosen units", () => {
    expect(read("load")?.ratio).toBeCloseTo(0.5);
    expect(read("temp", { tempUnit: "f" })?.text).toMatch(/°F$/);
    expect(read("freq", { freqUnit: "mhz" })?.text).toMatch(/MHz$/);
    expect(read("model")?.text).toBe("Intel Core i5-10300H");
    expect(read("throttle")?.text).toBe("No");
  });

  it("is loading without data and unavailable with a reason", () => {
    expect(cpu.status({ get: () => undefined, content: resolveContent(cpu, {}) })).toEqual({
      kind: "loading",
    });
    const missing = {
      kind: "missing" as const,
      v: { state: "unavailable" as const, reason: "no-procfs" },
    };
    expect(cpu.status({ get: () => missing, content: resolveContent(cpu, {}) }).kind).toBe(
      "unavailable",
    );
  });

  it("the clock never needs core", () => {
    expect(clock.status({ get: () => undefined, content: resolveContent(clock, {}) })).toEqual({
      kind: "ready",
    });
  });
});

describe("format", () => {
  it("units", () => {
    expect(temperature(100, "f", 0)).toBe("212 °F");
    expect(frequency(4242, "ghz", 0)).toMatch(/^4[.,]2 GHz$/);
    expect(bytes(1536, "iec", 1)).toMatch(/^1[.,]5 KiB$/);
    expect(bytes(999, "si", 1)).toBe("999 B");
  });
});

describe("json", () => {
  it("merge patch like core", () => {
    expect(mergePatch({ a: 1, b: { c: 2, d: 3 } }, { b: { c: null, e: 4 }, f: [1] })).toEqual({
      a: 1,
      b: { d: 3, e: 4 },
      f: [1],
    });
    expect(mergePatch({ a: 1 }, { a: null })).toEqual({});
  });

  it("round-trips values and turns settings into the host shape", () => {
    const j = {
      style: { blur: 20 },
      widgets: { "cpu-1": { kind: "cpu", content: { fields: ["load"] } }, bad: { x: 1 } },
    };
    expect(toJson(fromJson(j))).toEqual(j);
    const s = storedSettings(fromJson(j));
    expect(s.style).toEqual({ blur: 20 });
    expect(Object.keys(s.widgets)).toEqual(["cpu-1"]);
    expect(s.widgets["cpu-1"]?.content).toEqual({ fields: ["load"] });
    expect(fromJson(null).kind).toBe("missing");
  });
});

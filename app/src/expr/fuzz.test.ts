// Hostile input never throws, compiles or not (docs/EXPRESSIONS.md §4: errors never escape).
import { describe, expect, it } from "vitest";
import { Diagnostic, mapHost, Program } from ".";
import { rng, soup } from "./testInput";

const host = mapHost({ "cpu.load": 43.4, "gpu.list": ["a", 1], t: "x" }, { nowMs: () => 1e12 });

function exercise(src: string) {
  for (const kind of ["expression", "template"] as const) {
    const p = Program.compile(src, kind);
    if (p instanceof Diagnostic) continue;
    const out = p.eval(host);
    if (typeof out.value === "number") expect(Number.isFinite(out.value)).toBe(true);
    if (kind === "template") expect(typeof out.value).toBe("string");
  }
}

describe("expressions under hostile input", () => {
  it("token soup", () => {
    const next = rng(1);
    for (let i = 0; i < 4000; i++) exercise(soup(next));
  });

  it("arbitrary text", () => {
    const next = rng(2);
    for (let i = 0; i < 2000; i++) {
      const len = Math.floor(next() * 60);
      let s = "";
      for (let j = 0; j < len; j++) s += String.fromCodePoint(Math.floor(next() * 0x2fff));
      exercise(s);
    }
  });

  it("nesting limit", () => {
    expect(Program.expression(`${"(".repeat(60)}1${")".repeat(60)}`).eval(host).value).toBe(1);
    expect(Program.expression(Array(64).fill("1").join("+")).eval(host).value).toBe(64);
    const long = Program.compile(Array(66).fill("1").join("+"), "expression");
    expect(long instanceof Diagnostic && long.code).toBe("too-deep");
  });

  it("reads own fields only", () => {
    const p = Program.expression("m.constructor ?? m['__proto__'] ?? 'none'");
    expect(p.eval(mapHost({ m: {} })).value).toBe("none");
  });

  it("paths and clock", () => {
    const p = Program.template("{gpu.list[0] | upper} {until(now() + 5000)}");
    expect(p.paths()).toEqual(["gpu.list"]);
    expect(p.usesNow()).toBe(true);
    expect(p.eval(host).value).toBe("A 5");
  });
});

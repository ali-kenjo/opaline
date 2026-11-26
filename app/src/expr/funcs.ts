// The function table (docs/EXPRESSIONS.md §6). Rust twin: crates/opaline-expr/src/funcs.rs.
import type { Type } from "./value";

export type Func =
  | "round" | "floor" | "ceil" | "abs" | "sqrt" | "min" | "max" | "clamp" | "map" | "if"
  | "upper" | "lower" | "trim" | "len" | "string" | "join" | "has" | "pad"
  | "fixed" | "percent" | "unit" | "bytes" | "duration"
  | "mix" | "alpha" | "lighten" | "now" | "until"
  // Layer only (they need ICU data and the scheme).
  | "date" | "ramp"
  // History forms: a path and a window, folded at compile time.
  | "hist-avg" | "hist-min" | "hist-max" | "hist-delta"; // prettier-ignore

/** What a parameter accepts. A statically known value of another kind is a compile error. */
export type Param = "num" | "str" | "any" | "list";

export interface Sig {
  func: Func;
  params: readonly Param[];
  optional: number;
  variadic: boolean;
  ret: Type;
}

const sig = (func: Func, params: Param[], optional: number, ret: Type): Sig => ({
  func,
  params,
  optional,
  variadic: false,
  ret,
});

const TABLE: Record<string, Sig> = {
  round: sig("round", ["num", "num"], 1, "num"),
  floor: sig("floor", ["num"], 0, "num"),
  ceil: sig("ceil", ["num"], 0, "num"),
  abs: sig("abs", ["num"], 0, "num"),
  sqrt: sig("sqrt", ["num"], 0, "num"),
  min: { func: "min", params: ["num", "num"], optional: 0, variadic: true, ret: "num" },
  max: { func: "max", params: ["num", "num"], optional: 0, variadic: true, ret: "num" },
  clamp: sig("clamp", ["num", "num", "num"], 0, "num"),
  map: sig("map", ["num", "num", "num", "num", "num"], 0, "num"),
  if: sig("if", ["any", "any", "any"], 0, "any"),
  upper: sig("upper", ["str"], 0, "str"),
  lower: sig("lower", ["str"], 0, "str"),
  trim: sig("trim", ["str"], 0, "str"),
  len: sig("len", ["any"], 0, "num"),
  string: sig("string", ["any"], 0, "str"),
  join: sig("join", ["list", "str"], 1, "str"),
  has: sig("has", ["any", "any"], 0, "bool"),
  pad: sig("pad", ["any", "num", "str"], 1, "str"),
  fixed: sig("fixed", ["num", "num"], 0, "str"),
  percent: sig("percent", ["num", "num"], 1, "str"),
  unit: sig("unit", ["num", "str", "num"], 1, "str"),
  bytes: sig("bytes", ["num", "str"], 1, "str"),
  duration: sig("duration", ["num", "str"], 1, "str"),
  mix: sig("mix", ["str", "str", "num"], 0, "str"),
  alpha: sig("alpha", ["str", "num"], 0, "str"),
  lighten: sig("lighten", ["str", "num"], 0, "str"),
  now: sig("now", [], 0, "num"),
  until: sig("until", ["num"], 0, "num"),
  date: sig("date", ["num", "str", "str"], 2, "str"),
  ramp: sig("ramp", ["num", "str"], 0, "str"),
};

export function lookup(name: string): Sig | undefined {
  return Object.hasOwn(TABLE, name) ? TABLE[name] : undefined;
}

export function arityOk(s: Sig, n: number): boolean {
  const max = s.params.length;
  return n >= max - s.optional && (s.variadic || n <= max);
}

export function paramAt(s: Sig, i: number): Param {
  return s.params[i] ?? s.params[s.params.length - 1] ?? "any";
}

export function accepts(p: Param, ty: Type): boolean {
  if (ty === "null" || ty === "any" || p === "any") return true;
  if (p === "num") return ty === "num";
  if (p === "str") return ty === "str";
  return false;
}

/** A duration literal ('30s', '5m', '2h', '1d') in seconds. */
export function durationSecs(s: string): number | null {
  const m = /^([0-9.]+)(s|m|h|d)$/.exec(s.trim());
  if (!m?.[1] || !/^(\d+\.?\d*|\.\d+)$/.test(m[1])) return null;
  const n = Number(m[1]);
  const k = { s: 1, m: 60, h: 3600, d: 86400 }[m[2] as "s" | "m" | "h" | "d"];
  return Number.isFinite(n) && n > 0 ? n * k : null;
}

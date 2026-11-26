// Evaluation (docs/EXPRESSIONS.md §4). Rust twin: crates/opaline-expr/src/eval.rs. `null`
// propagates, mismatches in data give `null` and a recorded error, nothing escapes.
import { Diagnostic } from "./diagnostic";
import * as fmt from "./format";
import type { BinOp, Expr, Part, PathRef } from "./parser";
import { compareStrings, get, isList, num, same, type Key, type Locale, type Value } from "./value";

export type Agg = "avg" | "min" | "max" | "delta";

/** What a program can see. */
export interface Host {
  /** Whether a topic of this name exists (paths resolve by longest prefix, §5). */
  hasTopic(name: string): boolean;
  /** The value inside a topic at `keys`; `null` when anything along the way is missing. */
  topic(name: string, keys: readonly Key[]): Value;
  nowMs?(): number | null;
  history?(path: string, agg: Agg, windowSecs: number): number | null;
  locale?(): Locale;
  /** Layer only: a date by ICU skeleton, in a time zone (`undefined` = the system's). */
  date?(ms: number, skeleton: string, zone: string | undefined): string | null;
  /** Layer only: a color on one of the scheme's ramps (`ramp()`). */
  ramp?(t: number, name: string): string | null;
}

export interface Outcome {
  value: Value;
  /** Run-time errors (type mismatches in data), each once. */
  errors: Diagnostic[];
  /** A path the program read had no value (templates show `—` for it). */
  missing: boolean;
}

export type Body = { expr: Expr } | { template: Part[] };

/** Thrown inside one function call to make its result `null`; never leaves `call`. */
class NullResult extends Error {}
const NUL = new NullResult("null");

class Cx {
  readonly errors: Diagnostic[] = [];
  missing = false;
  readonly locale: Locale;

  constructor(readonly host: Host) {
    this.locale = host.locale?.() ?? "en";
  }

  error(at: number, message: string) {
    if (!this.errors.some((e) => e.at === at && e.message === message)) {
      this.errors.push(new Diagnostic("type-error", at, message));
    }
  }

  truth(v: Value, at: number): boolean | null {
    if (v === null) return false;
    if (typeof v === "boolean") return v;
    this.error(at, "expected true or false");
    return null;
  }

  path(p: PathRef): Value {
    for (const [name, keys] of p.candidates) {
      if (this.host.hasTopic(name)) {
        const v = this.host.topic(name, keys);
        if (v === null) this.missing = true;
        return v;
      }
    }
    this.missing = true;
    return null;
  }

  eval(e: Expr): Value {
    const k = e.kind;
    switch (k.k) {
      case "lit":
        return k.v;
      case "path":
        return this.path(k.p);
      case "neg": {
        const v = this.eval(k.e);
        if (v === null) return null;
        if (typeof v === "number") return num(-v);
        this.error(k.e.at, "expected a number");
        return null;
      }
      case "not": {
        const b = this.truth(this.eval(k.e), k.e.at);
        return b === null ? null : !b;
      }
      case "bin":
        return this.binary(k.op, k.a, k.b, e.at);
      case "field":
        return get(this.eval(k.e), { field: k.name }) ?? null;
      case "index": {
        const v = this.eval(k.e);
        const i = this.eval(k.i);
        if (typeof i === "number") return get(v, { index: i }) ?? null;
        if (typeof i === "string") return get(v, { field: i }) ?? null;
        return null;
      }
      case "call":
        return this.call(e, k.args);
    }
  }

  binary(op: BinOp, a: Expr, b: Expr, at: number): Value {
    if (op === "&&" || op === "||") {
      const x = this.truth(this.eval(a), a.at);
      if (x === null) return null;
      if ((op === "&&") !== x) return x;
      return this.truth(this.eval(b), b.at);
    }
    if (op === "??") {
      return this.eval(a) ?? this.eval(b);
    }
    const va = this.eval(a);
    const vb = this.eval(b);
    if (op === "==") return same(va, vb);
    if (op === "!=") return !same(va, vb);
    if (va === null || vb === null) return null;
    if (typeof va === "number" && typeof vb === "number") {
      switch (op) {
        case "+":
          return num(va + vb);
        case "-":
          return num(va - vb);
        case "*":
          return num(va * vb);
        case "/":
          return num(va / vb);
        case "%":
          return num(va % vb);
        case "<":
          return va < vb;
        case "<=":
          return va <= vb;
        case ">":
          return va > vb;
        case ">=":
          return va >= vb;
      }
    }
    if (typeof va === "string" && typeof vb === "string") {
      if (op === "+") return va + vb;
      const o = compareStrings(va, vb);
      if (op === "<") return o < 0;
      if (op === "<=") return o <= 0;
      if (op === ">") return o > 0;
      if (op === ">=") return o >= 0;
    }
    this.error(at, "these values can't be combined");
    return null;
  }

  call(e: Expr, args: Expr[]): Value {
    if (e.kind.k !== "call") return null;
    const f = e.kind.f;
    if (f === "if") {
      const [c, a, b] = args;
      if (!c || !a || !b) return null;
      const t = this.truth(this.eval(c), c.at);
      return t === null ? null : this.eval(t ? a : b);
    }
    if (f === "hist-avg" || f === "hist-min" || f === "hist-max" || f === "hist-delta") {
      const [p, w] = args;
      if (p?.kind.k !== "path" || w?.kind.k !== "lit" || typeof w.kind.v !== "number") return null;
      const agg = f.slice(5) as Agg;
      const v = this.host.history?.(p.kind.p.segments.join("."), agg, w.kind.v) ?? null;
      return v === null ? null : num(v);
    }
    const vals = args.map((a) => this.eval(a));
    try {
      return this.apply(f, vals, args, e.at);
    } catch (err) {
      if (err === NUL) return null;
      throw err;
    }
  }

  apply(f: string, v: Value[], args: Expr[], callAt: number): Value {
    const pos = (i: number) => args[i]?.at ?? callAt;
    const arg = (i: number): Value => v[i] ?? null;
    const number = (i: number): number => {
      const x = arg(i);
      if (typeof x === "number") return x;
      if (x !== null) this.error(pos(i), "expected a number");
      throw NUL;
    };
    const string = (i: number): string => {
      const x = arg(i);
      if (typeof x === "string") return x;
      if (x !== null) this.error(pos(i), "expected a string");
      throw NUL;
    };
    const color = (i: number): fmt.Rgba => {
      const c = fmt.parseColor(string(i));
      if (c) return c;
      this.error(pos(i), "expected a color such as '#4285f4'");
      throw NUL;
    };
    const has = (i: number) => v.length > i;
    const digits = (d: number) => Math.trunc(Math.min(10, Math.max(0, d)));
    const loc = this.locale;
    switch (f) {
      case "round": {
        const x = number(0);
        return num(fmt.roundTo(x, digits(has(1) ? number(1) : 0)));
      }
      case "floor":
        return num(Math.floor(number(0)));
      case "ceil":
        return num(Math.ceil(number(0)));
      case "abs":
        return num(Math.abs(number(0)));
      case "sqrt":
        return num(Math.sqrt(number(0)));
      case "min":
      case "max": {
        let acc: number | null = null;
        for (let i = 0; i < v.length; i++) {
          const x = number(i);
          acc = acc === null ? x : f === "min" ? Math.min(acc, x) : Math.max(acc, x);
        }
        return acc === null ? null : num(acc);
      }
      case "clamp": {
        const [x, lo, hi] = [number(0), number(1), number(2)];
        return num(Math.min(Math.max(x, lo), hi));
      }
      case "map": {
        const [x, a, b, c, d] = [number(0), number(1), number(2), number(3), number(4)];
        return a === b ? null : num(c + ((x - a) * (d - c)) / (b - a));
      }
      case "upper":
        return string(0).toUpperCase();
      case "lower":
        return string(0).toLowerCase();
      case "trim":
        return string(0).trim();
      case "len": {
        const x = arg(0);
        if (typeof x === "string") return Array.from(x).length;
        if (isList(x)) return x.length;
        return null;
      }
      case "string":
        return fmt.text(arg(0), loc);
      case "join": {
        const sep = has(1) ? string(1) : ", ";
        const x = arg(0);
        if (x === null) return null;
        if (!isList(x)) {
          this.error(pos(0), "expected a list");
          return null;
        }
        return x.map((y) => fmt.text(y, loc)).join(sep);
      }
      case "pad": {
        if (arg(0) === null) return null;
        const s = fmt.text(arg(0), loc);
        const width = Math.trunc(Math.min(256, Math.max(0, number(1))));
        const fill = has(2) ? (Array.from(string(2))[0] ?? "0") : "0";
        return fill.repeat(Math.max(0, width - Array.from(s).length)) + s;
      }
      case "fixed":
        return fmt.fixed(number(0), digits(number(1)), loc);
      case "percent": {
        const x = number(0);
        return `${fmt.fixed(x, digits(has(1) ? number(1) : 0), loc)}${fmt.NNBSP}%`;
      }
      case "unit": {
        const x = number(0);
        const u = string(1);
        const n = has(2) ? fmt.fixed(x, digits(number(2)), loc) : fmt.plain(x, loc);
        return `${n}${fmt.NNBSP}${u}`;
      }
      case "bytes": {
        const x = number(0);
        let iec = false;
        if (has(1)) {
          const base = string(1);
          if (base !== "si" && base !== "iec") {
            this.error(pos(1), "expected 'si' or 'iec'");
            return null;
          }
          iec = base === "iec";
        }
        return fmt.bytes(x, iec, loc);
      }
      case "duration": {
        const x = number(0);
        let clock = false;
        if (has(1)) {
          const style = string(1);
          if (style !== "short" && style !== "clock") {
            this.error(pos(1), "expected 'short' or 'clock'");
            return null;
          }
          clock = style === "clock";
        }
        return fmt.duration(x, clock, loc);
      }
      case "mix": {
        const [a, b] = [color(0), color(1)];
        return fmt.color(fmt.mix(a, b, number(2), 4));
      }
      case "alpha": {
        const c = color(0);
        c[3] = fmt.roundHalfAway(Math.min(1, Math.max(0, number(1))) * 255);
        return fmt.color(c);
      }
      case "lighten": {
        const c = color(0);
        const amount = Math.min(1, Math.max(-1, number(1)));
        const target: fmt.Rgba = amount >= 0 ? [255, 255, 255, 255] : [0, 0, 0, 255];
        return fmt.color(fmt.mix(c, target, Math.abs(amount), 3));
      }
      case "now": {
        const now = this.host.nowMs?.() ?? null;
        return now === null ? null : num(now);
      }
      case "until": {
        const ms = number(0);
        const now = this.host.nowMs?.() ?? null;
        return now === null ? null : num((ms - now) / 1000);
      }
      case "date": {
        const ms = number(0);
        const skeleton = has(1) ? string(1) : "yMMMd";
        const zone = has(2) ? string(2) : undefined;
        return this.host.date?.(ms, skeleton, zone) ?? null;
      }
      case "ramp": {
        const t = number(0);
        return this.host.ramp?.(Math.min(1, Math.max(0, t)), string(1)) ?? null;
      }
      default:
        return null;
    }
  }
}

export function run(body: Body, host: Host): Outcome {
  const cx = new Cx(host);
  let value: Value;
  if ("expr" in body) {
    value = cx.eval(body.expr);
  } else {
    let out = "";
    for (const p of body.template) {
      if ("text" in p) {
        out += p.text;
      } else {
        const v = cx.eval(p.hole);
        if (v === null) cx.missing = true;
        out += fmt.text(v, cx.locale);
      }
    }
    value = out;
  }
  return { value, errors: cx.errors, missing: cx.missing };
}

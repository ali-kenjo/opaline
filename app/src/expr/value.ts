// Values of the expression language (docs/EXPRESSIONS.md §2): JSON-like, with `null` for "no
// value". The Rust twin is crates/opaline-expr/src/value.rs.

export type Value = null | boolean | number | string | Value[] | ValueMap;

// An interface, not `Record`: a recursive type can't go through `Record`.
export interface ValueMap {
  [key: string]: Value;
}

/** Static types the checker knows. `any` is a value from data, checked at run time. */
export type Type = "num" | "str" | "bool" | "null" | "any";

export type Key = { field: string } | { index: number };

export type Locale = "en" | "de" | "ar";

export function localeFromTag(tag: string): Locale {
  const base = tag.split(/[-_]/)[0];
  return base === "de" ? "de" : base === "ar" ? "ar" : "en";
}

/** A number, or `null` when it isn't finite (no NaN or infinity escapes). */
export function num(x: number): Value {
  return Number.isFinite(x) ? x : null;
}

export function isList(v: Value): v is Value[] {
  return Array.isArray(v);
}

export function isMap(v: Value): v is ValueMap {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function typeOf(v: Value): Type {
  if (v === null) return "null";
  if (typeof v === "number") return "num";
  if (typeof v === "string") return "str";
  if (typeof v === "boolean") return "bool";
  return "any";
}

/** One step inside: a map field or a list index (negative from the end); `undefined` on a miss. */
export function get(v: Value, key: Key): Value | undefined {
  if ("field" in key) {
    // Own fields only: a topic map must never reach the prototype ("constructor", "__proto__").
    return isMap(v) && Object.hasOwn(v, key.field) ? v[key.field] : undefined;
  }
  if (!isList(v) || !Number.isInteger(key.index)) return undefined;
  const i = key.index < 0 ? v.length + key.index : key.index;
  return i >= 0 && i < v.length ? v[i] : undefined;
}

/** The value at `keys`; `null` on a miss. */
export function at(v: Value, keys: readonly Key[]): Value {
  let cur: Value = v;
  for (const k of keys) {
    const next = get(cur, k);
    if (next === undefined) return null;
    cur = next;
  }
  return cur;
}

/** Value equality: numbers by value, lists and maps deeply, `null == null`. */
export function same(a: Value, b: Value): boolean {
  if (a === b) return true;
  if (isList(a) && isList(b)) {
    return a.length === b.length && a.every((x, i) => same(x, b[i] ?? null));
  }
  if (isMap(a) && isMap(b)) {
    const ka = Object.keys(a);
    return (
      ka.length === Object.keys(b).length &&
      ka.every((k) => Object.hasOwn(b, k) && same(a[k] ?? null, b[k] ?? null))
    );
  }
  return false;
}

/** Strings in code-point order, as Rust compares them (JS compares UTF-16 units). */
export function compareStrings(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const p = x[i]?.codePointAt(0) ?? 0;
    const q = y[i]?.codePointAt(0) ?? 0;
    if (p !== q) return p - q;
  }
  return x.length - y.length;
}

// Protocol values ↔ plain JSON (mirrors `crates/opaline-core/src/json.rs`).
import type { Value } from "../layer/protocol";

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** A value as JSON; missing values become `null`. */
export function toJson(v: Value | undefined): Json {
  if (!v) return null;
  switch (v.kind) {
    case "num":
    case "text":
    case "bool":
      return v.v;
    case "nums":
      return v.v;
    case "list":
      return v.v.map(toJson);
    case "map": {
      const o: Record<string, Json> = {};
      for (const [k, x] of Object.entries(v.v)) o[k] = toJson(x);
      return o;
    }
    case "missing":
      return null;
  }
}

/** JSON as a value; `null` becomes "not reported", which a settings patch reads as "clear". */
export function fromJson(j: Json): Value {
  if (j === null) return { kind: "missing", v: { state: "unavailable", reason: "not-reported" } };
  if (typeof j === "boolean") return { kind: "bool", v: j };
  if (typeof j === "number") return { kind: "num", v: j };
  if (typeof j === "string") return { kind: "text", v: j };
  if (Array.isArray(j)) return { kind: "list", v: j.map(fromJson) };
  const o: Record<string, Value> = {};
  for (const [k, x] of Object.entries(j)) o[k] = fromJson(x);
  return { kind: "map", v: o };
}

/** RFC 7396 JSON merge patch (mirrors core's `store::merge`). */
export function mergePatch(target: Json, patch: Json): Json {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return patch;
  const base = new Map(
    typeof target === "object" && target !== null && !Array.isArray(target)
      ? Object.entries(target)
      : [],
  );
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) base.delete(k);
    else base.set(k, mergePatch(base.get(k) ?? null, v));
  }
  return Object.fromEntries(base);
}

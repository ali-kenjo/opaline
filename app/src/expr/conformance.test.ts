// Runs the shared corpus (spec/expressions/*.json, docs/EXPRESSIONS.md §8); the Rust crate runs
// the same files (crates/opaline-expr/tests/conformance.rs).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Diagnostic, localeFromTag, mapHost, Program, type Agg, type Value } from ".";

interface Case {
  name: string;
  expr?: string;
  template?: string;
  data?: Record<string, Value>;
  topics?: string[];
  locale?: string;
  now?: number;
  history?: Record<string, number[]>;
  expect?: Value;
  error?: string;
}

const dir = join(import.meta.dirname, "../../../spec/expressions");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort();

function host(c: Case) {
  const topics: Record<string, Value> = { ...c.data };
  for (const t of c.topics ?? []) topics[t] ??= null;
  return mapHost(topics, {
    nowMs: () => c.now ?? null,
    locale: () => localeFromTag(c.locale ?? "en"),
    history: (path: string, agg: Agg) => {
      const xs = c.history?.[path];
      if (!xs?.length) return null;
      if (agg === "avg") return xs.reduce((a, b) => a + b, 0) / xs.length;
      if (agg === "min") return Math.min(...xs);
      if (agg === "max") return Math.max(...xs);
      return (xs[xs.length - 1] ?? 0) - (xs[0] ?? 0);
    },
  });
}

function run(c: Case): string | null {
  const src = c.expr ?? c.template;
  if (src === undefined) return "case has neither expr nor template";
  const p = Program.compile(src, c.expr !== undefined ? "expression" : "template");
  if (p instanceof Diagnostic) {
    return c.error === p.code ? null : `compile error ${p.code} at ${p.at}: ${p.message}`;
  }
  const out = p.eval(host(c));
  if (c.error !== undefined) {
    if (!out.errors.some((e) => e.code === c.error)) {
      return `expected ${c.error}, got ${JSON.stringify(out.errors.map((e) => e.code))}`;
    }
  } else if (out.errors.length > 0) {
    return `unexpected errors ${out.errors.map((e) => e.message).join("; ")}`;
  }
  if ("expect" in c) {
    const want = c.expect ?? null;
    const ok =
      typeof want === "number" && typeof out.value === "number"
        ? Math.abs(out.value - want) <= 1e-9 * Math.max(1, Math.abs(want))
        : JSON.stringify(out.value) === JSON.stringify(want);
    if (!ok) return `got ${JSON.stringify(out.value)}, want ${JSON.stringify(want)}`;
  }
  return null;
}

describe("expression corpus", () => {
  it("has the corpus", () => {
    expect(files.length).toBeGreaterThan(0);
  });
  for (const file of files) {
    const { cases } = JSON.parse(readFileSync(join(dir, file), "utf8")) as { cases: Case[] };
    describe(file, () => {
      for (const c of cases) {
        it(c.name, () => {
          expect(run(c)).toBeNull();
        });
      }
    });
  }
});

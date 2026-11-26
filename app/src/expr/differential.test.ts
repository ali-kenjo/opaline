// Rust and TypeScript agree on random input: same compile errors (code and position), same
// values, same run-time errors. Needs the Rust side built:
//   cargo build -p opaline-expr --example lines
//   OPALINE_EXPR_LINES=target/debug/examples/lines pnpm exec vitest run src/expr
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Diagnostic, mapHost, Program } from ".";
import { rng, soup } from "./testInput";

const bin = process.env.OPALINE_EXPR_LINES;

/** JSON with sorted keys (serde_json sorts map keys). */
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)))
      : x,
  );

describe.skipIf(!bin)("Rust and TypeScript agree", () => {
  it("on random programs", { timeout: 120_000 }, () => {
    const next = rng(7);
    const reqs: { kind: "expression" | "template"; src: string }[] = [];
    for (let i = 0; i < Number(process.env.OPALINE_EXPR_N ?? 10000); i++) {
      const src = soup(next);
      reqs.push({ kind: "expression", src }, { kind: "template", src });
    }
    const input = reqs.map((r) => JSON.stringify(r)).join("\n") + "\n";
    const lines = execFileSync(resolve(import.meta.dirname, "../../..", bin ?? ""), {
      input,
      maxBuffer: 1 << 28,
    })
      .toString()
      .trim()
      .split("\n");
    expect(lines.length).toBe(reqs.length);
    const host = mapHost({ "cpu.load": 43.4, "gpu.list": ["a", 1], t: "x" }, { nowMs: () => 1e12 });
    const diffs: string[] = [];
    reqs.forEach((r, i) => {
      const p = Program.compile(r.src, r.kind);
      const ts =
        p instanceof Diagnostic
          ? { compile: p.code, at: p.at }
          : (({ value, errors, missing }) => ({
              value,
              errors: errors.map((e) => e.code),
              missing,
            }))(p.eval(host));
      const rust: unknown = JSON.parse(lines[i] ?? "null");
      if (canonical(ts) !== canonical(rust)) {
        diffs.push(
          `${r.kind} ${JSON.stringify(r.src)}\n  ts:   ${JSON.stringify(ts)}\n  rust: ${JSON.stringify(rust)}`,
        );
      }
    });
    expect(diffs.slice(0, 15).join("\n")).toBe("");
  });
});

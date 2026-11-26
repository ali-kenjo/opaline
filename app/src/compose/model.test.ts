// The generated types follow the Rust model (crates/opaline-compose): the generator's check mode
// fails when spec/composition.schema.json changed and `pnpm gen:types` wasn't run.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("model.gen.ts is current", () => {
  const script = resolve(import.meta.dirname, "../../scripts/schema-to-ts.mjs");
  expect(() =>
    execFileSync(process.execPath, [script, "--check"], { stdio: "pipe" }),
  ).not.toThrow();
});

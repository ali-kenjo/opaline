// The layer and core allow the same commands for composed controls.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { COMMANDS, buildCommand } from "./commands";

it("matches the Rust validator's list", () => {
  const rust = readFileSync(
    resolve(import.meta.dirname, "../../../crates/opaline-compose/src/lib.rs"),
    "utf8",
  );
  const list = /pub const COMMANDS: &\[\(&str, bool\)\] = &\[([^\]]*)\]/.exec(rust)?.[1] ?? "";
  const entries = [...list.matchAll(/\("([a-z-]+)", (true|false)\)/g)].map((m) => [
    m[1],
    { confirm: m[2] === "true" },
  ]);
  expect(Object.fromEntries(entries)).toEqual(COMMANDS);
});

it("builds allowed commands only, and never lets an argument rename them", () => {
  expect(buildCommand("media", { player: "p", action: "next" }, false)).toEqual({
    cmd: "media",
    player: "p",
    action: "next",
  });
  expect(buildCommand("update-settings", {}, true)).toBeNull();
  expect(buildCommand("end-task", { pid: 1 }, false)).toBeNull();
  expect(buildCommand("media", { cmd: "update-settings" }, false)?.cmd).toBe("media");
});

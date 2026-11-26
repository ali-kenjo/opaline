// The Clock on the composition engine (PLAN-2 2.8): the same composition the Rust validator
// checks (spec/compositions/clock.json), no compile errors, today's lines, and a minute clock
// that wakes once a minute.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { formatDate } from "../compose/dates";
import { Runtime, type Env } from "../compose/runtime";
import { clock } from "./clock";
import { clockComposition } from "./clock.composition";
import { resolveContent } from "./content";

const fixture = resolve(import.meta.dirname, "../../../spec/compositions/clock.json");

// 2026-11-23 09:09:07 UTC, a Monday.
const T = Date.UTC(2026, 10, 23, 9, 9, 7);

function runtime(content: Record<string, unknown>, now = T, settings = {}) {
  const c = resolveContent(clock, content);
  const options = clock.compositionOptions?.(c) ?? {};
  const env: Env = {
    topics: { "clock.settings": { kind: "map", v: settings } },
    options,
    locale: "en",
    now: () => now,
    date: (ms, sk, zone) => formatDate(ms, sk, zone, "en-US"),
  };
  return new Runtime(clockComposition, env);
}

describe("clock composition", () => {
  it("is the fixture the Rust validator checks", () => {
    const text = `${JSON.stringify(clockComposition, null, 2)}\n`;
    if (process.env.OPALINE_UPDATE_FIXTURES) writeFileSync(fixture, text);
    expect(JSON.parse(readFileSync(fixture, "utf8"))).toEqual(clockComposition);
  });

  it("compiles and subscribes to GNOME's clock settings", () => {
    const rt = runtime({});
    expect(rt.problems()).toEqual([]);
    expect(rt.topics()).toContain("clock.settings");
  });

  it("shows the time and the chosen lines in the user's order", () => {
    const rt = runtime({
      zone: "UTC",
      fields: ["week", "time", "date", "zone2"],
      zone2: "America/New_York",
      format: "24",
    });
    expect(rt.read("/layouts/3/root/children/1/children/0/value").value).toBe("09:09");
    const items = rt.read("/layouts/3/root/children/1/children/1/items").value;
    expect(items).toEqual(["week", "date", "zone2"]);
    const line = (i: number) =>
      rt.read("/layouts/3/root/children/1/children/1/item/text", {
        item: (items as string[])[i] ?? null,
        index: i,
      }).value;
    expect([line(0), line(1), line(2)]).toEqual([
      "Week 48",
      "Monday, November 23, 2026",
      "New York 04:09",
    ]);
  });

  it("follows GNOME's 12/24 h and seconds settings unless overridden", () => {
    const rt = runtime({ zone: "UTC" }, T, {
      format24h: { kind: "bool", v: false },
      showSeconds: { kind: "bool", v: true },
    });
    expect(rt.read("/bindings/timeSeconds").value).toBe("9:09:07 AM");
  });

  it("wakes once a minute without seconds and every second with them", () => {
    const minute = runtime({ zone: "UTC", seconds: "off" });
    minute.read("/layouts/3/root/children/1/children/0/value");
    expect(minute.nextWake()).toBe(Math.floor(T / 60_000 + 1) * 60_000);
    const second = runtime({ zone: "UTC", seconds: "on" });
    second.read("/layouts/3/root/children/1/children/0/value");
    expect(second.nextWake()).toBe(Math.floor(T / 1000 + 1) * 1000);
  });
});

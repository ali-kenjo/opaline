// Round 4 compositions & helpers (PLAN-2 4.12–4.14): Weather, Calendar, Docker.
// Each fixture in spec/compositions/ is also validated by Rust (`opaline-compose`).
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildMonthGrid, formatCountdown, sunProgress } from "../compose/render/round4Visuals";
import { Runtime, type Env } from "../compose/runtime";
import type { Value } from "../layer/protocol";
import { calendar } from "./calendar";
import { calendarComposition } from "./calendar.composition";
import { resolveContent } from "./content";
import { docker } from "./docker";
import { dockerComposition } from "./docker.composition";
import { weather } from "./weather";
import { weatherComposition } from "./weather.composition";

const specDir = resolve(import.meta.dirname, "../../../spec/compositions");
const n = (v: number): Value => ({ kind: "num", v });
const t = (v: string): Value => ({ kind: "text", v });
const b = (v: boolean): Value => ({ kind: "bool", v });
const m = (v: Record<string, Value>): Value => ({ kind: "map", v });
const l = (v: Value[]): Value => ({ kind: "list", v });

function checkFixture(name: string, comp: unknown) {
  const path = resolve(specDir, `${name}.json`);
  const text = `${JSON.stringify(comp, null, 2)}\n`;
  if (process.env.OPALINE_UPDATE_FIXTURES) writeFileSync(path, text);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(comp);
}

describe("Round 4 compositions (Weather, Calendar, Docker)", () => {
  it("matches spec/compositions/{weather,calendar,docker}.json fixtures", () => {
    checkFixture("weather", weatherComposition);
    checkFixture("calendar", calendarComposition);
    checkFixture("docker", dockerComposition);
  });

  it("compiles and evaluates Weather composition and daylight sun progress", () => {
    const c = resolveContent(weather, { tempUnit: "c", windUnit: "kmh", skyScene: true });
    const raw: Record<string, Value> = {
      "weather.current": m({
        location: t("Berlin"),
        tempC: n(11.4),
        feelsC: n(9.8),
        humidity: n(64),
        isDay: b(true),
        code: n(2),
        windKmh: n(16),
        windDir: n(240),
        timezone: t("Europe/Berlin"),
      }),
      "weather.hourly": l([
        m({
          time: t("2026-11-27T12:00"),
          tempC: n(12),
          precipProb: n(20),
          code: n(2),
          isDay: n(1),
        }),
      ]),
      "weather.daily": l([
        m({
          date: t("2026-11-27"),
          code: n(2),
          maxC: n(13),
          minC: n(5),
          sunrise: t("2026-11-27T07:45"),
          sunset: t("2026-11-27T16:00"),
          precipProb: n(20),
          uv: n(2),
        }),
      ]),
      "weather.air": m({ europeanAqi: n(18) }),
    };
    const env: Env = {
      topics: weather.compositionTopics?.(raw, c) ?? raw,
      options: { tempUnit: "c", windUnit: "kmh", skyScene: true, showSunArc: true },
      locale: "en",
      now: () => 0,
    };
    const rt = new Runtime(weatherComposition, env);
    expect(rt.problems()).toEqual([]);
    expect(rt.read("/layouts/0/root/children/0/params/skyScene").value).toBe(true);

    const noon = new Date(2026, 10, 27, 11, 52);
    const frac = sunProgress("2026-11-27T07:45", "2026-11-27T16:00", noon);
    expect(frac).not.toBeNull();
    expect(frac ?? 0).toBeGreaterThan(0.45);
    expect(frac ?? 0).toBeLessThan(0.55);
  });

  it("compiles and evaluates Calendar composition, month grid, and countdown helper", () => {
    const c = resolveContent(calendar, { view: "month", weekStart: "mon", days: "7", max: 8 });
    const nowMs = new Date(2026, 10, 27, 10, 0).getTime();
    const raw: Record<string, Value> = {
      "calendar.events": l([
        m({
          title: t("Design review"),
          startMs: n(nowMs + 25 * 60_000),
          endMs: n(nowMs + 85 * 60_000),
          allDay: b(false),
          location: t("Room 4"),
          calendar: t("Work"),
          color: t("#62a0ea"),
        }),
      ]),
    };
    const env: Env = {
      topics: calendar.compositionTopics?.(raw, c) ?? raw,
      options: { view: "month", weekStart: "mon", days: "7", max: 8, timeFormat: "24" },
      locale: "en",
      now: () => nowMs,
    };
    const rt = new Runtime(calendarComposition, env);
    expect(rt.problems()).toEqual([]);
    expect(rt.read("/layouts/0/root/children/0/params/view").value).toBe("month");

    expect(formatCountdown(nowMs + 25 * 60_000, nowMs + 85 * 60_000, nowMs)).toBe("In 25 min");
    expect(formatCountdown(nowMs - 10 * 60_000, nowMs + 20 * 60_000, nowMs)).toBe("Happening now");
    expect(formatCountdown(nowMs - 60 * 60_000, nowMs - 10 * 60_000, nowMs)).toBeNull();

    const grid = buildMonthGrid(2026, 10, "mon"); // Nov 2026
    expect(grid).toHaveLength(42);
    expect(grid.filter((g) => !g.outside)).toHaveLength(30);
  });

  it("compiles and evaluates Docker composition with Compose projects and ports", () => {
    const c = resolveContent(docker, { showStopped: true, groupByProject: true, controls: true });
    const raw: Record<string, Value> = {
      "docker.state": m({ status: t("running"), engine: t("docker"), version: t("29.8.2") }),
      "docker.containers": l([
        m({
          id: t("0123456789ab"),
          name: t("api"),
          image: t("node:22-alpine"),
          state: t("running"),
          status: t("Up 3 hours"),
          project: t("shop"),
          ports: l([t("8080:80")]),
          cpu: n(4.2),
          memB: n(180e6),
          memLimitB: n(512e6),
        }),
      ]),
    };
    const env: Env = {
      topics: docker.compositionTopics?.(raw, c) ?? raw,
      options: { showStopped: true, controls: true, groupByProject: true, byteUnit: "gb" },
      locale: "en",
      now: () => 0,
    };
    const rt = new Runtime(dockerComposition, env);
    expect(rt.problems()).toEqual([]);
    expect(rt.read("/layouts/0/root/children/0/params/groupByProject").value).toBe(true);
  });
});

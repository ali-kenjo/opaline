// Round 3 compositions & helpers (PLAN-2 4.9–4.11): Processes, Now Playing, Visualizer.
// Each fixture in spec/compositions/ is also validated by Rust (`opaline-compose`).
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { activeLyricLine } from "../compose/render/round3Visuals";
import { Runtime, type Env } from "../compose/runtime";
import type { Value } from "../layer/protocol";
import { resolveContent } from "./content";
import { media } from "./media";
import { mediaComposition } from "./media.composition";
import { processes } from "./processes";
import { processesComposition } from "./processes.composition";
import { synthesizeStereo, synthesizeWaveform } from "./visualizer";

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

describe("Round 3 compositions (Processes, Now Playing, Visualizer)", () => {
  it("matches spec/compositions/{processes,media}.json fixtures", () => {
    checkFixture("processes", processesComposition);
    checkFixture("media", mediaComposition);
  });

  it("compiles and evaluates Processes composition with real app icons, I/O, and GPU badge", () => {
    const c = resolveContent(processes, { group: "apps", sort: "io", showIo: true });
    const raw: Record<string, Value> = {
      "processes.apps": l([
        m({
          id: t("firefox"),
          name: t("Firefox"),
          iconUrl: t("opaline-asset://icons/firefox.svg"),
          system: b(false),
          cpu: n(18.4),
          memB: n(1.6e9),
          ioBps: n(4.2e6),
          processes: n(6),
        }),
      ]),
      "processes.list": l([
        m({
          pid: n(4201),
          start: n(987654),
          name: t("firefox"),
          app: t("firefox"),
          iconUrl: t("opaline-asset://icons/firefox.svg"),
          own: b(true),
          cpu: n(12.2),
          memB: n(900e6),
          ioBps: n(3.1e6),
        }),
      ]),
      "gpu.0.load": n(24),
    };
    const env: Env = {
      topics: processes.compositionTopics?.(raw, c) ?? raw,
      options: {
        group: "apps",
        sort: "io",
        count: 8,
        showSystem: false,
        showSearch: true,
        showIo: true,
        endTask: true,
        byteUnit: "gb",
      },
      locale: "en",
      now: () => 0,
    };
    const rt = new Runtime(processesComposition, env);
    expect(rt.problems()).toEqual([]);
    expect(rt.read("/layouts/0/root/children/0/params/gpuLoad").value).toBe(24);
    expect(rt.read("/layouts/0/root/children/0/params/showIo").value).toBe(true);
  });

  it("compiles and evaluates Now Playing composition and syncs local .lrc lyrics", () => {
    const c = resolveContent(media, { look: "vinyl", artShape: "cookie", showLyrics: true });
    const raw: Record<string, Value> = {
      "media.player": m({
        bus: t("org.mpris.MediaPlayer2.spotify"),
        identity: t("Spotify"),
        status: t("Playing"),
        title: t("Midnight City"),
        artists: l([t("M83")]),
        album: t("Hurry Up, We're Dreaming"),
        lengthUs: n(243_000_000),
        positionUs: n(64_000_000),
        positionAtMs: n(0),
        rate: n(1),
        canPlay: b(true),
        canPause: b(true),
        canNext: b(true),
        canPrevious: b(true),
        canSeek: b(true),
        canControl: b(true),
        shuffle: b(true),
        loopStatus: t("Playlist"),
        volume: n(0.72),
        lyrics: l([
          m({ ms: n(15_000), text: t("Waiting in a car") }),
          m({ ms: n(58_000), text: t("Looking at the stars") }),
          m({ ms: n(90_000), text: t("The city is my church") }),
        ]),
      }),
      "media.players": l([]),
    };
    const env: Env = {
      topics: media.compositionTopics?.(raw, c) ?? raw,
      options: {
        look: "vinyl",
        artShape: "cookie",
        artBackdrop: true,
        showLyrics: true,
        showExtraControls: true,
      },
      locale: "en",
      now: () => 0,
    };
    const rt = new Runtime(mediaComposition, env);
    expect(rt.problems()).toEqual([]);
    expect(rt.read("/layouts/0/root/children/0/params/look").value).toBe("vinyl");

    const lines = [
      { ms: 15_000, text: "Waiting in a car" },
      { ms: 58_000, text: "Looking at the stars" },
      { ms: 90_000, text: "The city is my church" },
    ];
    expect(activeLyricLine(lines, 10_000)).toBeNull();
    expect(activeLyricLine(lines, 64_000)).toBe("Looking at the stars");
    expect(activeLyricLine(lines, 120_000)).toBe("The city is my church");
  });

  it("synthesizes clean oscilloscope waveform and stereo VU/split fallbacks", () => {
    const bands = Array.from({ length: 32 }, (_, i) => Math.max(0.1, 1 - i / 36));
    const wave = synthesizeWaveform(bands, 128);
    expect(wave).toHaveLength(128);
    expect(Math.min(...wave)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...wave)).toBeLessThanOrEqual(255);

    const stereo = synthesizeStereo(bands);
    expect(stereo.left).toHaveLength(32);
    expect(stereo.right).toHaveLength(32);
    expect(stereo.leftRms).toBeGreaterThan(0);
    expect(stereo.rightRms).toBeGreaterThan(0);
  });
});

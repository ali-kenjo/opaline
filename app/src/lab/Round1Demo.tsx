// Phase 4 Round 1 showcase in the Widget Lab (`lab.html?only=round1&still`):
// Renders Clock (all 11 faces + analog dials), CPU (S/M/L + hero modes), Memory (S/M/L with
// liquid fill, stacked composition bar, zram), and GPU (dual iGPU+dGPU awake & sleeping dGPU)
// under the Opaline 2.0 theme so Playwright can verify rendering, zero errors, and idle budgets.
import { sourceColorFromImageBytes } from "@material/material-color-utilities";
import { useEffect, useMemo } from "react";
import { GNOME_ACCENTS } from "../design-system/color/scheme";
import { GlassStage } from "../design-system/glass";
import { inksFor, resolveCascade, sanitizeStyle } from "../design-system/style";
import type { Value } from "../layer/protocol";
import { HostContext, type StoredSettings, type WidgetHost } from "../widgets/host";
import { widgetByKind } from "../widgets/registry";
import { WidgetFrame } from "../widgets/WidgetFrame";
import type { SizeClass } from "../design-system/tokens/tokens";
import { LAB_FONTS, LAB_NOW, mockSpectrum, mockValues, useLabValues } from "./labHost";
import { labTint } from "./labTint";
import styles from "./Lab.module.css";
import { makeWallpaper } from "./wallpapers";
import opalineTheme from "../../../spec/themes/opaline/theme.json";

/** The real Opaline type (hero roles, number font), so the showcase shows the desktop's sizes. */
const OPALINE_TYPE = sanitizeStyle(opalineTheme.style);

const OPALINE_THEME: NonNullable<WidgetHost["theme"]> = {
  id: "opaline",
  style: {
    surface: "glass",
    transparency: 80,
    blur: 30,
    refraction: 75,
    rim: 80,
    grain: 40,
    shadow: 40,
    legibility: true,
    headerStyle: "none",
    ...(OPALINE_TYPE.numberFontFamily ? { numberFontFamily: OPALINE_TYPE.numberFontFamily } : {}),
    ...(OPALINE_TYPE.roles ? { roles: OPALINE_TYPE.roles } : {}),
  },
  kinds: {
    clock: { accentColor: "#8f7cf0" },
    cpu: { accentColor: "#f2903a" },
    memory: { accentColor: "#6aa8ff" },
    gpu: { accentColor: "#50c896" },
  },
};

const ROUND1_SETTINGS: StoredSettings = {
  style: {},
  styles: {},
  widgets: {
    "r1-clock-stacked": { kind: "clock", content: { face: "digital", digitalLayout: "stacked" } },
    "r1-clock-expressive": { kind: "clock", content: { face: "expressive" } },
    "r1-clock-railway": {
      kind: "clock",
      content: { face: "analog", dialStyle: "railway", seconds: "on" },
    },
    "r1-clock-chrono": {
      kind: "clock",
      content: { face: "analog", dialStyle: "chronograph", seconds: "on" },
    },
    "r1-clock-flip": { kind: "clock", content: { face: "flip", seconds: "on" } },
    "r1-clock-word": { kind: "clock", content: { face: "word" } },
    "r1-clock-typo": { kind: "clock", content: { face: "typographic" } },
    "r1-clock-seg": { kind: "clock", content: { face: "segment" } },
    "r1-clock-bin": { kind: "clock", content: { face: "binary" } },
    "r1-clock-term": { kind: "clock", content: { face: "terminal" } },
    "r1-clock-day": { kind: "clock", content: { face: "day-ring" } },
    "r1-clock-date": { kind: "clock", content: { face: "big-date" } },
    "r1-cpu-s": { kind: "cpu", content: { heroVisual: "thermal" } },
    "r1-cpu-m": { kind: "cpu", content: { heroVisual: "thermal" } },
    "r1-cpu-bars": { kind: "cpu", content: { heroVisual: "bars" } },
    "r1-cpu-l": { kind: "cpu", content: { heroVisual: "thermal" } },
    "r1-mem-s": { kind: "memory", content: { heroVisual: "liquid" } },
    "r1-mem-m": { kind: "memory", content: { heroVisual: "liquid" } },
    "r1-mem-l": { kind: "memory", content: { heroVisual: "liquid" } },
    "r1-gpu-s": { kind: "gpu" },
    "r1-gpu-m": { kind: "gpu", content: { multiGpu: "auto" } },
    "r1-gpu-l": { kind: "gpu", content: { multiGpu: "auto" } },
  },
};

const CLOCK_ITEMS: readonly { id: string; size: SizeClass }[] = [
  { id: "r1-clock-stacked", size: "S" },
  { id: "r1-clock-expressive", size: "S" },
  { id: "r1-clock-railway", size: "S" },
  { id: "r1-clock-chrono", size: "S" },
  { id: "r1-clock-flip", size: "M" },
  { id: "r1-clock-word", size: "M" },
  { id: "r1-clock-typo", size: "M" },
  { id: "r1-clock-seg", size: "M" },
  { id: "r1-clock-bin", size: "S" },
  { id: "r1-clock-term", size: "M" },
  { id: "r1-clock-day", size: "S" },
  { id: "r1-clock-date", size: "S" },
];

const MONITOR_ITEMS: readonly { id: string; size: SizeClass }[] = [
  { id: "r1-cpu-s", size: "S" },
  { id: "r1-cpu-m", size: "M" },
  { id: "r1-cpu-bars", size: "S" },
  { id: "r1-cpu-l", size: "L" },
  { id: "r1-mem-s", size: "S" },
  { id: "r1-mem-m", size: "M" },
  { id: "r1-mem-l", size: "L" },
  { id: "r1-gpu-s", size: "S" },
  { id: "r1-gpu-m", size: "M" },
  { id: "r1-gpu-l", size: "L" },
];

function useMockValues<T>(sel: (v: Readonly<Record<string, Value>>) => T): T {
  return useLabValues((st) => sel(st.values));
}

export function Round1Demo({ value, still }: { value: number; still: boolean }) {
  const asleepDgpu = new URLSearchParams(location.search).has("asleep");
  useEffect(() => {
    const base = mockValues(value);
    if (asleepDgpu) {
      base["gpu.0.state"] = { kind: "map", v: { awake: { kind: "bool", v: true } } };
      base["gpu.0.load"] = { kind: "num", v: 18 };
      base["gpu.0.clocks"] = { kind: "map", v: { coreMHz: { kind: "num", v: 650 } } };
      base["gpu.1.state"] = { kind: "map", v: { awake: { kind: "bool", v: false } } };
    }
    useLabValues.setState({ values: base });
  }, [value, asleepDgpu]);

  const wallpaper = useMemo(() => makeWallpaper("dusk", 1100, 1200), []);
  const source = useMemo(() => sourceColorFromImageBytes(wallpaper.pixels), [wallpaper]);
  const tint = useMemo(() => labTint(source, "expressive", true), [source]);

  const host: WidgetHost = useMemo(
    () => ({
      useValues: useMockValues,
      subscribe: () => undefined,
      settings: ROUND1_SETTINGS,
      theme: OPALINE_THEME,
      updateSettings: () => Promise.resolve({ result: "ok" as const }),
      listFonts: () => Promise.resolve(LAB_FONTS),
      command: () => Promise.resolve({ result: "ok" as const }),
      onSpectrum: (listener) => {
        listener(mockSpectrum(1.2));
        return () => undefined;
      },
      colors: { wallpaper: source, accent: GNOME_ACCENTS.blue ?? source, systemDark: true },
      ...(still ? { now: () => LAB_NOW } : {}),
    }),
    [source, still],
  );

  const inks = useMemo(
    () => inksFor(resolveCascade({ theme: sanitizeStyle(OPALINE_THEME.style) }).style, host.colors),
    [host.colors],
  );

  const renderStage = (
    id: string,
    title: string,
    height: number,
    items: readonly { id: string; size: SizeClass }[],
  ) => (
    <section className={styles.section} aria-label={title}>
      <h2 className={styles.heading}>{title}</h2>
      <div
        className={styles.desktop}
        style={{ backgroundImage: `url(${wallpaper.url})`, width: 1100, height }}
      >
        <GlassStage
          wallpaper={wallpaper.blurred}
          wallpaperUrl={wallpaper.url}
          placement={{ offsetX: 0, offsetY: 0, monitorWidth: 1100, monitorHeight: height }}
          tint={tint.rgb}
          textLuminance={tint.textLuminance}
          luminance={wallpaper.luminance}
          inks={inks}
          slider={45}
        >
          <div className={styles.cards} style={{ width: 1100, height }} data-testid={id}>
            {items.map(({ id: wid, size }) => {
              const w = ROUND1_SETTINGS.widgets[wid];
              const def = w ? widgetByKind(w.kind) : undefined;
              return def ? <WidgetFrame key={wid} id={wid} def={def} size={size} /> : null;
            })}
          </div>
        </GlassStage>
      </div>
    </section>
  );

  return (
    <HostContext.Provider value={host}>
      {renderStage("round1-clocks", "Round 1 · Clock faces (Opaline)", 900, CLOCK_ITEMS)}
      {renderStage("round1-monitors", "Round 1 · CPU, Memory & GPU (Opaline)", 1200, MONITOR_ITEMS)}
    </HostContext.Provider>
  );
}

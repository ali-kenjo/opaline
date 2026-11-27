// Phase 4 Round 2 showcase in the Widget Lab (`lab.html?only=round2&still`):
// Storage (bars & rings + removable eject), Network (dual-wave + Wi-Fi + VPN + cap ring + jitter),
// Battery & Power (liquid pill charging bubbles + charge limit + profiles + peripherals), and
// Fans (spinning glyph + per-fan gauges + CPU/GPU temps) under the Opaline 2.0 theme.
import { sourceColorFromImageBytes } from "@material/material-color-utilities";
import { useEffect, useMemo } from "react";
import { GNOME_ACCENTS } from "../design-system/color/scheme";
import { GlassStage } from "../design-system/glass";
import { inksFor, resolveCascade, sanitizeStyle } from "../design-system/style";
import type { SizeClass } from "../design-system/tokens/tokens";
import type { Value } from "../layer/protocol";
import { HostContext, type StoredSettings, type WidgetHost } from "../widgets/host";
import { widgetByKind } from "../widgets/registry";
import { WidgetFrame } from "../widgets/WidgetFrame";
import { LAB_FONTS, LAB_NOW, mockSpectrum, mockValues, useLabValues } from "./labHost";
import { labTint } from "./labTint";
import styles from "./Lab.module.css";
import { makeWallpaper } from "./wallpapers";

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
  },
  kinds: {
    storage: { accentColor: "#6aa8ff" },
    network: { accentColor: "#50c896" },
    battery: { accentColor: "#f2c14e" },
    fans: { accentColor: "#f2903a" },
  },
};

const ROUND2_SETTINGS: StoredSettings = {
  style: {},
  styles: {},
  widgets: {
    "r2-storage-m": { kind: "storage", content: { displayMode: "bars" } },
    "r2-storage-rings": { kind: "storage", content: { displayMode: "rings" } },
    "r2-storage-usb": { kind: "storage", content: { volume: "/media/lab/USB" } },
    "r2-network-m": { kind: "network", content: { monthlyCapGb: 100 } },
    "r2-network-l": { kind: "network", content: { monthlyCapGb: 100, showSsid: true } },
    "r2-battery-m": { kind: "battery" },
    "r2-battery-l": { kind: "battery" },
    "r2-fans-s": { kind: "fans" },
    "r2-fans-m": { kind: "fans" },
    "r2-fans-l": { kind: "fans" },
  },
};

const ITEMS: readonly { id: string; size: SizeClass }[] = [
  { id: "r2-storage-m", size: "M" },
  { id: "r2-storage-rings", size: "M" },
  { id: "r2-storage-usb", size: "M" },
  { id: "r2-network-m", size: "M" },
  { id: "r2-network-l", size: "L" },
  { id: "r2-battery-m", size: "M" },
  { id: "r2-battery-l", size: "L" },
  { id: "r2-fans-s", size: "S" },
  { id: "r2-fans-m", size: "M" },
  { id: "r2-fans-l", size: "L" },
];

function useMockValues<T>(sel: (v: Readonly<Record<string, Value>>) => T): T {
  return useLabValues((st) => sel(st.values));
}

export function Round2Demo({ value, still }: { value: number; still: boolean }) {
  useEffect(() => {
    const base = mockValues(value);
    // Add jitter, active VPN, charging battery + charge limit for the Round 2 showcase.
    base["network.latency"] = {
      kind: "map",
      v: {
        ms: { kind: "num", v: 18.4 },
        jitterMs: { kind: "num", v: 1.2 },
        target: { kind: "text", v: "1.1.1.1" },
      },
    };
    base["network.vpn"] = {
      kind: "map",
      v: {
        active: { kind: "bool", v: true },
        connections: {
          kind: "list",
          v: [{ kind: "map", v: { name: { kind: "text", v: "wg-berlin" } } }],
        },
      },
    };
    const bat = base["power.battery"];
    if (bat?.kind === "map") {
      base["power.battery"] = {
        kind: "map",
        v: {
          ...bat.v,
          state: { kind: "text", v: "charging" },
          timeToFullS: { kind: "num", v: 2100 },
          chargeThresholdEnabled: { kind: "bool", v: true },
          chargeEndThreshold: { kind: "num", v: 80 },
        },
      };
    }
    useLabValues.setState({ values: base });
  }, [value]);

  const wallpaper = useMemo(() => makeWallpaper("dusk", 1100, 1200), []);
  const source = useMemo(() => sourceColorFromImageBytes(wallpaper.pixels), [wallpaper]);
  const tint = useMemo(() => labTint(source, "expressive", true), [source]);

  const host: WidgetHost = useMemo(
    () => ({
      useValues: useMockValues,
      subscribe: () => undefined,
      settings: ROUND2_SETTINGS,
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

  return (
    <HostContext.Provider value={host}>
      <section className={styles.section} aria-label="Round 2 · Storage, Network, Battery & Fans">
        <h2 className={styles.heading}>Round 2 · Storage, Network, Battery &amp; Fans (Opaline)</h2>
        <div
          className={styles.desktop}
          style={{ backgroundImage: `url(${wallpaper.url})`, width: 1100, height: 1200 }}
        >
          <GlassStage
            wallpaper={wallpaper.blurred}
            wallpaperUrl={wallpaper.url}
            placement={{ offsetX: 0, offsetY: 0, monitorWidth: 1100, monitorHeight: 1200 }}
            tint={tint.rgb}
            textLuminance={tint.textLuminance}
            luminance={wallpaper.luminance}
            inks={inks}
            slider={45}
          >
            <div
              className={styles.cards}
              style={{ width: 1100, height: 1200 }}
              data-testid="round2-stage"
            >
              {ITEMS.map(({ id, size }) => {
                const w = ROUND2_SETTINGS.widgets[id];
                const def = w ? widgetByKind(w.kind) : undefined;
                return def ? <WidgetFrame key={id} id={id} def={def} size={size} /> : null;
              })}
            </div>
          </GlassStage>
        </div>
      </section>
    </HostContext.Provider>
  );
}

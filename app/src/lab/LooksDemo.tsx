// Phase 4 Round 5 showcase in the Widget Lab (`lab.html?only=looks&lookTheme=<id>&still`):
// Renders any of the ten built-in first-party looks (Opaline, Crystal, Bloom, Instrument, Air,
// Terminal, Neon, Paper, Mono, Classic) from their real `spec/themes/<id>/theme.json` manifests
// using each look's curated starter layout. Used for per-theme visual review, contrast checks,
// and zero-truncation enforcement (PLAN-2 4.15–4.16).
import { sourceColorFromImageBytes } from "@material/material-color-utilities";
import { useEffect, useMemo, useState } from "react";
import airTheme from "../../../spec/themes/air/theme.json";
import bloomTheme from "../../../spec/themes/bloom/theme.json";
import classicTheme from "../../../spec/themes/classic/theme.json";
import crystalTheme from "../../../spec/themes/crystal/theme.json";
import instrumentTheme from "../../../spec/themes/instrument/theme.json";
import monoTheme from "../../../spec/themes/mono/theme.json";
import neonCss from "../../../spec/themes/neon/theme.css?raw";
import neonTheme from "../../../spec/themes/neon/theme.json";
import opalineTheme from "../../../spec/themes/opaline/theme.json";
import paperTheme from "../../../spec/themes/paper/theme.json";
import terminalCss from "../../../spec/themes/terminal/theme.css?raw";
import terminalTheme from "../../../spec/themes/terminal/theme.json";
import { GNOME_ACCENTS } from "../design-system/color/scheme";
import { GlassStage } from "../design-system/glass";
import { inksFor, resolveCascade, sanitizeStyle, type Style } from "../design-system/style";
import { BUILTIN_LOOK_IDS, type BuiltinLookId, starterLayoutForTheme } from "../layer/presets";
import type { Value } from "../layer/protocol";
import {
  HostContext,
  type StoredSettings,
  type StoredWidget,
  type ThemeStyleLayers,
  type WidgetHost,
} from "../widgets/host";
import { widgetByKind } from "../widgets/registry";
import { WidgetFrame } from "../widgets/WidgetFrame";
import { LAB_FONTS, LAB_NOW, mockSpectrum, mockValues, useLabValues } from "./labHost";
import { labTint } from "./labTint";
import styles from "./Lab.module.css";
import { type LabWallpaper, makeWallpaper } from "./wallpapers";

interface RawThemeJson {
  id: string;
  name: string;
  description?: string;
  style?: Record<string, unknown>;
  kinds?: Record<string, Record<string, unknown>>;
  elements?: Record<string, Record<string, unknown>>;
}

const RAW_THEMES: Readonly<Record<BuiltinLookId, { manifest: RawThemeJson; css: string }>> = {
  opaline: { manifest: opalineTheme, css: "" },
  crystal: { manifest: crystalTheme, css: "" },
  bloom: { manifest: bloomTheme, css: "" },
  instrument: { manifest: instrumentTheme, css: "" },
  air: { manifest: airTheme, css: "" },
  terminal: { manifest: terminalTheme, css: terminalCss },
  neon: { manifest: neonTheme, css: neonCss },
  paper: { manifest: paperTheme, css: "" },
  mono: { manifest: monoTheme, css: "" },
  classic: { manifest: classicTheme, css: "" },
};

function toThemeLayers(raw: RawThemeJson): ThemeStyleLayers {
  const kinds: Record<string, Style> = {};
  for (const [k, v] of Object.entries(raw.kinds ?? {})) kinds[k] = sanitizeStyle(v);
  const elements: Record<string, Style> = {};
  for (const [k, v] of Object.entries(raw.elements ?? {})) elements[k] = sanitizeStyle(v);
  return {
    id: raw.id,
    style: sanitizeStyle(raw.style ?? {}),
    ...(Object.keys(kinds).length ? { kinds } : {}),
    ...(Object.keys(elements).length ? { elements } : {}),
  };
}

function useMockValues<T>(sel: (v: Readonly<Record<string, Value>>) => T): T {
  return useLabValues((st) => sel(st.values));
}

export function LooksDemo({
  initialTheme,
  wallpaperId,
  dark,
  value,
  still,
}: {
  initialTheme: string | null;
  wallpaperId: LabWallpaper["id"];
  dark: boolean;
  value: number;
  still: boolean;
}) {
  const resolvedInitial: BuiltinLookId = BUILTIN_LOOK_IDS.includes(initialTheme as BuiltinLookId)
    ? (initialTheme as BuiltinLookId)
    : "opaline";
  const [lookId, setLookId] = useState<BuiltinLookId>(resolvedInitial);

  useEffect(() => {
    const base = mockValues(value);
    useLabValues.setState({ values: base });
  }, [value]);

  const entry = RAW_THEMES[lookId];
  const themeLayers = useMemo(() => toThemeLayers(entry.manifest), [entry]);
  const starter = useMemo(() => starterLayoutForTheme(lookId), [lookId]);

  useEffect(() => {
    document.documentElement.dataset.theme = lookId;
    const tagId = "opaline-lab-look-css";
    let tag = document.getElementById(tagId) as HTMLStyleElement | null;
    if (!entry.css.trim()) {
      tag?.remove();
    } else {
      if (!tag) {
        tag = document.createElement("style");
        tag.id = tagId;
        document.head.appendChild(tag);
      }
      tag.textContent = entry.css;
    }
    return () => {
      delete document.documentElement.dataset.theme;
      document.getElementById(tagId)?.remove();
    };
  }, [lookId, entry.css]);

  const settings: StoredSettings = useMemo(() => {
    const widgets: Record<string, StoredWidget> = {};
    starter.entries.forEach((e, i) => {
      widgets[`look-${lookId}-${String(i)}`] = {
        kind: e.kind,
        ...(e.content ? { content: e.content } : {}),
      };
    });
    return { theme: lookId, style: {}, styles: {}, widgets };
  }, [lookId, starter]);

  const wallpaper = useMemo(() => makeWallpaper(wallpaperId, 1140, 860), [wallpaperId]);
  const source = useMemo(() => sourceColorFromImageBytes(wallpaper.pixels), [wallpaper]);
  const tint = useMemo(() => labTint(source, "expressive", dark), [source, dark]);

  const host: WidgetHost = useMemo(
    () => ({
      useValues: useMockValues,
      subscribe: () => undefined,
      settings,
      theme: themeLayers,
      updateSettings: () => Promise.resolve({ result: "ok" as const }),
      listFonts: () => Promise.resolve(LAB_FONTS),
      command: () => Promise.resolve({ result: "ok" as const }),
      onSpectrum: (listener) => {
        listener(mockSpectrum(1.2));
        return () => undefined;
      },
      colors: { wallpaper: source, accent: GNOME_ACCENTS.blue ?? source, systemDark: dark },
      ...(still ? { now: () => LAB_NOW } : {}),
    }),
    [settings, themeLayers, source, dark, still],
  );

  const inks = useMemo(
    () => inksFor(resolveCascade({ theme: themeLayers.style }).style, host.colors),
    [themeLayers.style, host.colors],
  );

  return (
    <HostContext.Provider value={host}>
      <section className={styles.section} aria-label="The ten built-in looks">
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h2 className={styles.heading} style={{ margin: 0 }}>
            Look · {entry.manifest.name}
          </h2>
          <div
            role="tablist"
            aria-label="Choose a look"
            style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
          >
            {BUILTIN_LOOK_IDS.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={id === lookId}
                onClick={() => {
                  setLookId(id);
                }}
                style={{
                  padding: "4px 10px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: id === lookId ? "rgba(143,124,240,0.35)" : "rgba(255,255,255,0.06)",
                  color: "inherit",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                {RAW_THEMES[id].manifest.name}
              </button>
            ))}
          </div>
        </div>
        <div
          className={styles.desktop}
          style={{ backgroundImage: `url(${wallpaper.url})`, width: 1140, height: 860 }}
        >
          <GlassStage
            wallpaper={wallpaper.blurred}
            wallpaperUrl={wallpaper.url}
            placement={{ offsetX: 0, offsetY: 0, monitorWidth: 1140, monitorHeight: 860 }}
            tint={tint.rgb}
            textLuminance={tint.textLuminance}
            luminance={wallpaper.luminance}
            inks={inks}
            slider={45}
          >
            <div
              className={styles.cards}
              style={{ width: 1140, height: 860 }}
              data-testid="looks-stage"
              data-look-id={lookId}
            >
              {starter.entries.map((e, i) => {
                const id = `look-${lookId}-${String(i)}`;
                const def = widgetByKind(e.kind);
                return def ? <WidgetFrame key={id} id={id} def={def} size={e.size} /> : null;
              })}
            </div>
          </GlassStage>
        </div>
      </section>
    </HostContext.Provider>
  );
}

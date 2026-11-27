// Phase 4 Round 4 showcase in the Widget Lab (`lab.html?only=round4&still`):
// Weather (illustrated sky scene, hourly rain bars, 6-day range bars, wind compass, UV, AQI,
// sunrise/sunset arc), Calendar (mini month grid with event dots, live countdown, current-time
// rule, all-day chip), and Docker / Podman (Compose project groups, CPU/RAM bars, port chips,
// and honest Docker Desktop stopped card) under the Opaline 2.0 theme.
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
    weather: { accentColor: "#6db7ff" },
    calendar: { accentColor: "#a78bfa" },
    docker: { accentColor: "#38bdf8" },
  },
};

const ROUND4_SETTINGS: StoredSettings = {
  style: {},
  styles: {},
  widgets: {
    "r4-weather-m": { kind: "weather", content: { skyScene: true, showSunArc: true } },
    "r4-weather-l": { kind: "weather", content: { skyScene: true, showSunArc: true } },
    "r4-cal-m": { kind: "calendar", content: { view: "agenda", timeFormat: "24" } },
    "r4-cal-l": {
      kind: "calendar",
      content: { view: "month", weekStart: "mon", timeFormat: "24" },
    },
    "r4-docker-m": { kind: "docker", content: { groupByProject: true, showStopped: true } },
    "r4-docker-l": { kind: "docker", content: { groupByProject: true, showStopped: true } },
  },
};

const STOPPED_SETTINGS: StoredSettings = {
  style: {},
  styles: {},
  widgets: {
    "r4-docker-stopped": { kind: "docker" },
  },
};

const ITEMS: readonly { id: string; size: SizeClass }[] = [
  { id: "r4-weather-m", size: "M" },
  { id: "r4-weather-l", size: "L" },
  { id: "r4-cal-m", size: "M" },
  { id: "r4-cal-l", size: "L" },
  { id: "r4-docker-m", size: "M" },
  { id: "r4-docker-l", size: "L" },
];

const STOPPED_VALUES: Readonly<Record<string, Value>> = {
  "docker.state": { kind: "map", v: { status: { kind: "text", v: "desktop-stopped" } } },
  "docker.containers": { kind: "missing", v: { state: "unavailable", reason: "desktop-stopped" } },
};

function useMockValues<T>(sel: (v: Readonly<Record<string, Value>>) => T): T {
  return useLabValues((st) => sel(st.values));
}

function useStoppedValues<T>(sel: (v: Readonly<Record<string, Value>>) => T): T {
  return sel(STOPPED_VALUES);
}

export function Round4Demo({ value, still }: { value: number; still: boolean }) {
  useEffect(() => {
    const base = mockValues(value);
    const nowMs = LAB_NOW.getTime();
    base["weather.current"] = {
      kind: "map",
      v: {
        location: { kind: "text", v: "Berlin" },
        tempC: { kind: "num", v: 12.4 },
        feelsC: { kind: "num", v: 10.6 },
        humidity: { kind: "num", v: 64 },
        isDay: { kind: "bool", v: true },
        code: { kind: "num", v: 61 },
        windKmh: { kind: "num", v: 18 },
        windDir: { kind: "num", v: 245 },
        precipMm: { kind: "num", v: 1.4 },
        cloud: { kind: "num", v: 78 },
        pressureHpa: { kind: "num", v: 1012 },
        timezone: { kind: "text", v: "Europe/Berlin" },
        source: { kind: "text", v: "Open-Meteo" },
      },
    };
    base["weather.air"] = {
      kind: "map",
      v: {
        europeanAqi: { kind: "num", v: 18 },
        pm25: { kind: "num", v: 5.4 },
      },
    };
    base["calendar.events"] = {
      kind: "list",
      v: [
        {
          kind: "map",
          v: {
            title: { kind: "text", v: "Opaline 2.0 Sprint" },
            startMs: { kind: "num", v: nowMs },
            endMs: { kind: "num", v: nowMs + 86_400_000 },
            allDay: { kind: "bool", v: true },
            calendar: { kind: "text", v: "Product" },
            color: { kind: "text", v: "#a78bfa" },
          },
        },
        {
          kind: "map",
          v: {
            title: { kind: "text", v: "Design review" },
            location: { kind: "text", v: "Studio B" },
            startMs: { kind: "num", v: nowMs + 35 * 60_000 },
            endMs: { kind: "num", v: nowMs + 95 * 60_000 },
            allDay: { kind: "bool", v: false },
            calendar: { kind: "text", v: "Work" },
            color: { kind: "text", v: "#62a0ea" },
          },
        },
        {
          kind: "map",
          v: {
            title: { kind: "text", v: "Coffee with Sara" },
            location: { kind: "text", v: "Barn Roastery" },
            startMs: { kind: "num", v: nowMs + 180 * 60_000 },
            endMs: { kind: "num", v: nowMs + 225 * 60_000 },
            allDay: { kind: "bool", v: false },
            calendar: { kind: "text", v: "Personal" },
            color: { kind: "text", v: "#50c896" },
          },
        },
        {
          kind: "map",
          v: {
            title: { kind: "text", v: "Release planning" },
            startMs: { kind: "num", v: nowMs + 26 * 3_600_000 },
            endMs: { kind: "num", v: nowMs + 27 * 3_600_000 },
            allDay: { kind: "bool", v: false },
            calendar: { kind: "text", v: "Work" },
            color: { kind: "text", v: "#62a0ea" },
          },
        },
      ],
    };
    base["docker.state"] = {
      kind: "map",
      v: {
        status: { kind: "text", v: "running" },
        engine: { kind: "text", v: "docker" },
        version: { kind: "text", v: "29.8.2" },
      },
    };
    base["docker.containers"] = {
      kind: "list",
      v: [
        {
          kind: "map",
          v: {
            id: { kind: "text", v: "a1b2c3d4e5f6" },
            name: { kind: "text", v: "api-gateway" },
            image: { kind: "text", v: "nginx:1.27" },
            state: { kind: "text", v: "running" },
            status: { kind: "text", v: "Up 4 hours" },
            project: { kind: "text", v: "shop" },
            ports: { kind: "list", v: [{ kind: "text", v: "8080:80" }] },
            cpu: { kind: "num", v: 6.4 },
            memB: { kind: "num", v: 142e6 },
            memLimitB: { kind: "num", v: 512e6 },
          },
        },
        {
          kind: "map",
          v: {
            id: { kind: "text", v: "b2c3d4e5f6a7" },
            name: { kind: "text", v: "postgres" },
            image: { kind: "text", v: "postgres:17" },
            state: { kind: "text", v: "running" },
            status: { kind: "text", v: "Up 4 hours" },
            project: { kind: "text", v: "shop" },
            ports: { kind: "list", v: [{ kind: "text", v: "5432:5432" }] },
            cpu: { kind: "num", v: 11.2 },
            memB: { kind: "num", v: 320e6 },
            memLimitB: { kind: "num", v: 1024e6 },
          },
        },
        {
          kind: "map",
          v: {
            id: { kind: "text", v: "c3d4e5f6a7b8" },
            name: { kind: "text", v: "n8n" },
            image: { kind: "text", v: "n8nio/n8n:latest" },
            state: { kind: "text", v: "exited" },
            status: { kind: "text", v: "Exited (0) 2 days ago" },
            ports: { kind: "list", v: [] },
          },
        },
      ],
    };
    useLabValues.setState({ values: base });
  }, [value]);

  const wallpaper = useMemo(() => makeWallpaper("dusk", 1200, 1480), []);
  const source = useMemo(() => sourceColorFromImageBytes(wallpaper.pixels), [wallpaper]);
  const tint = useMemo(() => labTint(source, "expressive", true), [source]);

  const baseHost = useMemo(
    () => ({
      subscribe: () => undefined,
      theme: OPALINE_THEME,
      updateSettings: () => Promise.resolve({ result: "ok" as const }),
      listFonts: () => Promise.resolve(LAB_FONTS),
      command: () => Promise.resolve({ result: "ok" as const }),
      onSpectrum: (listener: (levels: readonly number[]) => void) => {
        listener(mockSpectrum(1.2));
        return () => undefined;
      },
      colors: { wallpaper: source, accent: GNOME_ACCENTS.blue ?? source, systemDark: true },
      ...(still ? { now: () => LAB_NOW } : {}),
    }),
    [source, still],
  );

  const host: WidgetHost = useMemo(
    () => ({ ...baseHost, useValues: useMockValues, settings: ROUND4_SETTINGS }),
    [baseHost],
  );
  const stoppedHost: WidgetHost = useMemo(
    () => ({ ...baseHost, useValues: useStoppedValues, settings: STOPPED_SETTINGS }),
    [baseHost],
  );

  const inks = useMemo(
    () => inksFor(resolveCascade({ theme: sanitizeStyle(OPALINE_THEME.style) }).style, host.colors),
    [host.colors],
  );
  const dockerDef = widgetByKind("docker");

  return (
    <HostContext.Provider value={host}>
      <section className={styles.section} aria-label="Round 4 · Weather, Calendar & Docker">
        <h2 className={styles.heading}>Round 4 · Weather, Calendar &amp; Docker (Opaline)</h2>
        <div
          className={styles.desktop}
          style={{ backgroundImage: `url(${wallpaper.url})`, width: 1200, height: 1480 }}
        >
          <GlassStage
            wallpaper={wallpaper.blurred}
            wallpaperUrl={wallpaper.url}
            placement={{ offsetX: 0, offsetY: 0, monitorWidth: 1200, monitorHeight: 1480 }}
            tint={tint.rgb}
            textLuminance={tint.textLuminance}
            luminance={wallpaper.luminance}
            inks={inks}
            slider={45}
          >
            <div
              className={styles.cards}
              style={{ width: 1200, height: 1480 }}
              data-testid="round4-stage"
            >
              {ITEMS.map(({ id, size }) => {
                const w = ROUND4_SETTINGS.widgets[id];
                const def = w ? widgetByKind(w.kind) : undefined;
                return def ? <WidgetFrame key={id} id={id} def={def} size={size} /> : null;
              })}
              {dockerDef ? (
                <HostContext.Provider value={stoppedHost}>
                  <WidgetFrame id="r4-docker-stopped" def={dockerDef} size="M" />
                </HostContext.Provider>
              ) : null}
            </div>
          </GlassStage>
        </div>
      </section>
    </HostContext.Provider>
  );
}

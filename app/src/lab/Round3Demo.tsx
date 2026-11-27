// Phase 4 Round 3 showcase in the Widget Lab (`lab.html?only=round3&still`):
// Processes (real app icons, Disk I/O, GPU pill, search, Apps/Procs & End task),
// Now Playing (Card with breathing Material cookie mask + blurred backdrop + synced .lrc lyrics +
// shuffle/repeat/volume + player switcher, Spinning Vinyl look, Retro Cassette look), and
// Visualizer (Circular album-ring, Spectrogram waterfall, Analog VU needles, LED segments,
// Bass particles, Oscilloscope, Stereo L/R split) under the Opaline 2.0 theme.
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

const svgUrl = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

const MOCK_ICON_FIREFOX = svgUrl(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#ff7139"/><circle cx="16" cy="16" r="7" fill="#592acb"/></svg>`,
);
const MOCK_ICON_CODE = svgUrl(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#007acc"/><path d="M11 10l-5 6 5 6M21 10l5 6-5 6" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round"/></svg>`,
);
const MOCK_ALBUM_ART = svgUrl(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#ff6b9d"/><stop offset="50%" stop-color="#6b6bff"/><stop offset="100%" stop-color="#22d3ee"/></linearGradient></defs><rect width="120" height="120" fill="url(#g)"/><circle cx="60" cy="54" r="28" fill="rgba(255,255,255,0.22)"/><circle cx="60" cy="54" r="12" fill="rgba(255,255,255,0.55)"/></svg>`,
);

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
    processes: { accentColor: "#7aa7ff" },
    media: { accentColor: "#f072b6" },
    visualizer: { accentColor: "#4fd1c5" },
  },
};

const ROUND3_SETTINGS: StoredSettings = {
  style: {},
  styles: {},
  widgets: {
    "r3-proc-apps": {
      kind: "processes",
      content: { group: "apps", showIo: true, showSearch: true },
    },
    "r3-proc-list": {
      kind: "processes",
      content: { group: "processes", endTask: true, showIo: true },
    },
    "r3-media-card": {
      kind: "media",
      content: { look: "card", artShape: "cookie", artBackdrop: true, showLyrics: true },
    },
    "r3-media-vinyl": {
      kind: "media",
      content: { look: "vinyl", artBackdrop: true, showLyrics: true },
    },
    "r3-media-cassette": {
      kind: "media",
      content: { look: "cassette", artBackdrop: false, showLyrics: false },
    },
    "r3-viz-album": { kind: "visualizer", content: { look: "album-ring", colorMode: "gradient" } },
    "r3-viz-spec": { kind: "visualizer", content: { look: "spectrogram", colorMode: "fire" } },
    "r3-viz-vu": { kind: "visualizer", content: { look: "vu", colorMode: "theme" } },
    "r3-viz-led": { kind: "visualizer", content: { look: "led", colorMode: "theme", bands: "16" } },
    "r3-viz-particles": { kind: "visualizer", content: { look: "particles", colorMode: "ocean" } },
    "r3-viz-scope": {
      kind: "visualizer",
      content: { look: "oscilloscope", colorMode: "spectrum" },
    },
    "r3-viz-stereo": {
      kind: "visualizer",
      content: { look: "stereo-split", colorMode: "gradient" },
    },
  },
};

const ITEMS: readonly { id: string; size: SizeClass }[] = [
  { id: "r3-proc-apps", size: "M" },
  { id: "r3-proc-list", size: "M" },
  { id: "r3-media-card", size: "M" },
  { id: "r3-media-vinyl", size: "M" },
  { id: "r3-media-cassette", size: "M" },
  { id: "r3-viz-album", size: "S" },
  { id: "r3-viz-spec", size: "M" },
  { id: "r3-viz-vu", size: "M" },
  { id: "r3-viz-led", size: "M" },
  { id: "r3-viz-particles", size: "S" },
  { id: "r3-viz-scope", size: "M" },
  { id: "r3-viz-stereo", size: "M" },
];

function useMockValues<T>(sel: (v: Readonly<Record<string, Value>>) => T): T {
  return useLabValues((st) => sel(st.values));
}

export function Round3Demo({ value, still }: { value: number; still: boolean }) {
  useEffect(() => {
    const base = mockValues(value);
    base["processes.apps"] = {
      kind: "list",
      v: [
        {
          kind: "map",
          v: {
            id: { kind: "text", v: "firefox" },
            name: { kind: "text", v: "Firefox" },
            iconUrl: { kind: "text", v: MOCK_ICON_FIREFOX },
            system: { kind: "bool", v: false },
            cpu: { kind: "num", v: 24.5 },
            memB: { kind: "num", v: 2.3e9 },
            ioBps: { kind: "num", v: 6.4e6 },
            processes: { kind: "num", v: 9 },
          },
        },
        {
          kind: "map",
          v: {
            id: { kind: "text", v: "code" },
            name: { kind: "text", v: "VS Code" },
            iconUrl: { kind: "text", v: MOCK_ICON_CODE },
            system: { kind: "bool", v: false },
            cpu: { kind: "num", v: 14.2 },
            memB: { kind: "num", v: 1.7e9 },
            ioBps: { kind: "num", v: 2.1e6 },
            processes: { kind: "num", v: 7 },
          },
        },
        {
          kind: "map",
          v: {
            id: { kind: "text", v: "spotify" },
            name: { kind: "text", v: "Spotify" },
            system: { kind: "bool", v: false },
            cpu: { kind: "num", v: 4.8 },
            memB: { kind: "num", v: 640e6 },
            ioBps: { kind: "num", v: 420e3 },
            processes: { kind: "num", v: 3 },
          },
        },
      ],
    };
    base["processes.list"] = {
      kind: "list",
      v: [
        {
          kind: "map",
          v: {
            pid: { kind: "num", v: 4210 },
            start: { kind: "num", v: 123456 },
            name: { kind: "text", v: "firefox-bin" },
            app: { kind: "text", v: "firefox" },
            iconUrl: { kind: "text", v: MOCK_ICON_FIREFOX },
            own: { kind: "bool", v: true },
            cpu: { kind: "num", v: 19.3 },
            memB: { kind: "num", v: 1.4e9 },
            ioBps: { kind: "num", v: 5.2e6 },
          },
        },
        {
          kind: "map",
          v: {
            pid: { kind: "num", v: 5102 },
            start: { kind: "num", v: 234567 },
            name: { kind: "text", v: "rust-analyzer" },
            app: { kind: "text", v: "code" },
            iconUrl: { kind: "text", v: MOCK_ICON_CODE },
            own: { kind: "bool", v: true },
            cpu: { kind: "num", v: 11.8 },
            memB: { kind: "num", v: 1.1e9 },
            ioBps: { kind: "num", v: 1.8e6 },
          },
        },
      ],
    };
    const primaryPlayer: Value = {
      kind: "map",
      v: {
        bus: { kind: "text", v: "org.mpris.MediaPlayer2.spotify" },
        identity: { kind: "text", v: "Spotify" },
        status: { kind: "text", v: "Playing" },
        title: { kind: "text", v: "Midnight City" },
        artists: { kind: "list", v: [{ kind: "text", v: "M83" }] },
        album: { kind: "text", v: "Hurry Up, We're Dreaming" },
        art: { kind: "text", v: MOCK_ALBUM_ART },
        lengthUs: { kind: "num", v: 243_000_000 },
        positionUs: { kind: "num", v: 64_000_000 },
        positionAtMs: { kind: "num", v: 0 },
        rate: { kind: "num", v: 1 },
        canPlay: { kind: "bool", v: true },
        canPause: { kind: "bool", v: true },
        canNext: { kind: "bool", v: true },
        canPrevious: { kind: "bool", v: true },
        canSeek: { kind: "bool", v: true },
        canControl: { kind: "bool", v: true },
        shuffle: { kind: "bool", v: true },
        loopStatus: { kind: "text", v: "Playlist" },
        volume: { kind: "num", v: 0.72 },
        lyrics: {
          kind: "list",
          v: [
            {
              kind: "map",
              v: { ms: { kind: "num", v: 15_000 }, text: { kind: "text", v: "Waiting in a car" } },
            },
            {
              kind: "map",
              v: {
                ms: { kind: "num", v: 58_000 },
                text: { kind: "text", v: "Looking at the stars" },
              },
            },
          ],
        },
      },
    };
    const secondPlayer: Value = {
      kind: "map",
      v: {
        bus: { kind: "text", v: "org.mpris.MediaPlayer2.firefox" },
        identity: { kind: "text", v: "Firefox" },
        status: { kind: "text", v: "Paused" },
        title: { kind: "text", v: "Ambient Study Stream" },
        artists: { kind: "list", v: [{ kind: "text", v: "Lofi Radio" }] },
        art: { kind: "text", v: MOCK_ALBUM_ART },
        lengthUs: { kind: "num", v: 3600_000_000 },
        positionUs: { kind: "num", v: 420_000_000 },
        positionAtMs: { kind: "num", v: 0 },
        rate: { kind: "num", v: 1 },
        canPlay: { kind: "bool", v: true },
        canPause: { kind: "bool", v: true },
        canNext: { kind: "bool", v: false },
        canPrevious: { kind: "bool", v: false },
        canSeek: { kind: "bool", v: false },
        canControl: { kind: "bool", v: true },
      },
    };
    base["media.player"] = primaryPlayer;
    base["media.players"] = { kind: "list", v: [primaryPlayer, secondPlayer] };
    useLabValues.setState({ values: base });
  }, [value]);

  const wallpaper = useMemo(() => makeWallpaper("dusk", 1200, 1480), []);
  const source = useMemo(() => sourceColorFromImageBytes(wallpaper.pixels), [wallpaper]);
  const tint = useMemo(() => labTint(source, "expressive", true), [source]);

  const host: WidgetHost = useMemo(
    () => ({
      useValues: useMockValues,
      subscribe: () => undefined,
      settings: ROUND3_SETTINGS,
      theme: OPALINE_THEME,
      updateSettings: () => Promise.resolve({ result: "ok" as const }),
      listFonts: () => Promise.resolve(LAB_FONTS),
      command: () => Promise.resolve({ result: "ok" as const }),
      onSpectrum: (listener) => {
        listener(mockSpectrum(1.2));
        return () => undefined;
      },
      onWaveform: (listener) => {
        const samples = Array.from({ length: 128 }, (_, i) => {
          const t = (i / 128) * Math.PI * 2;
          const s = Math.sin(t * 2) * 0.55 + Math.sin(t * 7) * 0.28;
          return Math.round((s * 0.5 + 0.5) * 255);
        });
        listener(samples);
        return () => undefined;
      },
      onStereo: (listener) => {
        const spec = mockSpectrum(1.2).slice(0, 32);
        listener({
          leftRms: 178,
          rightRms: 152,
          left: spec,
          right: spec.map((v, i) =>
            Math.max(0, Math.min(255, Math.round(v * (0.88 + (i % 3) * 0.08)))),
          ),
        });
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
      <section
        className={styles.section}
        aria-label="Round 3 · Processes, Now Playing & Visualizer"
      >
        <h2 className={styles.heading}>
          Round 3 · Processes, Now Playing &amp; Visualizer (Opaline)
        </h2>
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
              data-testid="round3-stage"
            >
              {ITEMS.map(({ id, size }) => {
                const w = ROUND3_SETTINGS.widgets[id];
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

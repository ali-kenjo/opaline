// The widget host backed by core: live values from the layer store, settings from core's
// `settings` topic, saved through commands. Used by the layer (and the Lab's ?live mode).
import { lookPrefs } from "../design-system/style";
import { argbFromRgb } from "@material/material-color-utilities";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_SOURCE } from "../design-system/color/scheme";
import { sourceFromWallpaper } from "../design-system/color/source";
import type { ColorContext } from "../design-system/style";
import { attach, command, inTauri, subscribe } from "../layer/bridge";
import type { ActivityClass, Value } from "../layer/protocol";
import { useLayer } from "../layer/store";
import type { StoredSettings, StoredWidget, ThemeStyleLayers } from "./host";
import { type Json, fromJson, toJson } from "./json";
import {
  emitSpectrum,
  emitStereo,
  emitWaveform,
  onSpectrum,
  onStereo,
  onWaveform,
} from "./spectrum";

import type { LayoutItem, LayoutsDoc } from "../layer/grid";

export const SETTINGS_TOPIC = "settings";
export const LAYOUTS_TOPIC = "layouts";
export const THEMES_TOPIC = "themes";
export const CSS_TOPIC = "style.css";
export const PROBLEMS_TOPIC = "config.problems";
export const APPEARANCE_TOPIC = "appearance.settings";
export const WALLPAPER_TOPIC = "wallpaper.monitors";

const subscribed = new Set<string>();

export function subscribeTopics(topics: readonly string[], activity: ActivityClass): void {
  if (!inTauri) return;
  for (const t of topics) {
    const key = `${t}|${activity}`;
    if (subscribed.has(key)) continue;
    subscribed.add(key);
    subscribe(t, activity).catch((e: unknown) => {
      subscribed.delete(key);
      console.error("subscribe failed", t, e);
    });
  }
}

function record(j: Json): Record<string, Json> {
  return typeof j === "object" && j !== null && !Array.isArray(j) ? j : {};
}

/** Core's settings value as the widget host's shape (missing parts → empty). */
export function storedSettings(v: Value | undefined): StoredSettings {
  const j = record(toJson(v));
  const widgets: Record<string, StoredWidget> = {};
  for (const [id, w] of Object.entries(record(j.widgets ?? null))) {
    const r = record(w);
    if (typeof r.kind === "string") {
      const elements: Record<string, Record<string, Json>> = {};
      for (const [ek, ev] of Object.entries(record(r.elements ?? null))) {
        elements[ek] = record(ev);
      }
      widgets[id] = {
        kind: r.kind,
        style: record(r.style ?? null),
        ...(Object.keys(elements).length ? { elements } : {}),
        content: record(r.content ?? null),
      };
    }
  }
  const styles: Record<string, Record<string, Json>> = {};
  for (const [name, s] of Object.entries(record(j.styles ?? null))) styles[name] = record(s);
  const kindStyles: Record<string, Record<string, Json>> = {};
  for (const [kind, s] of Object.entries(record(j.kindStyles ?? null)))
    kindStyles[kind] = record(s);
  return {
    ...(typeof j.theme === "string" ? { theme: j.theme } : {}),
    style: record(j.style ?? null),
    ...(Object.keys(kindStyles).length ? { kindStyles } : {}),
    styles,
    widgets,
    look: lookPrefs(j.appearance ?? null),
  };
}

export async function updateSettings(patch: Record<string, Json>) {
  return await command({ cmd: "update-settings", patch: fromJson(patch) });
}

function parseItem(raw: Json): LayoutItem | null {
  const r = record(raw);
  const id = typeof r.id === "string" ? r.id : null;
  const x = typeof r.x === "number" ? Math.round(r.x) : null;
  const y = typeof r.y === "number" ? Math.round(r.y) : null;
  const w = typeof r.w === "number" ? Math.round(r.w) : null;
  const h = typeof r.h === "number" ? Math.round(r.h) : null;
  if (!id || x === null || y === null || w === null || h === null) return null;
  if (r.type === "stack") {
    const children = Array.isArray(r.children)
      ? r.children.filter((c): c is string => typeof c === "string")
      : [];
    if (children.length === 0) return null;
    return {
      id,
      type: "stack",
      x,
      y,
      w,
      h,
      children,
      activeIndex: typeof r.activeIndex === "number" ? Math.round(r.activeIndex) : 0,
      smartRotate: Boolean(r.smartRotate),
    };
  }
  const kind = typeof r.kind === "string" ? r.kind : null;
  if (!kind) return null;
  return { id, type: "widget", kind, x, y, w, h };
}

/** Core's `layouts` topic value as a typed `LayoutsDoc`. */
export function storedLayouts(v: Value | undefined): LayoutsDoc {
  const j = record(toJson(v));
  const monitors: LayoutsDoc["monitors"] = {};
  for (const [key, m] of Object.entries(record(j.monitors ?? null))) {
    const mr = record(m);
    const items = Array.isArray(mr.items)
      ? mr.items.map(parseItem).filter((i): i is LayoutItem => i !== null)
      : [];
    monitors[key] = { items };
  }
  return {
    version: typeof j.version === "number" ? j.version : 1,
    showMissingOnPrimary: Boolean(j.showMissingOnPrimary),
    monitors,
  };
}

export async function updateLayouts(doc: LayoutsDoc) {
  const json: Json = {
    version: doc.version,
    showMissingOnPrimary: doc.showMissingOnPrimary,
    monitors: Object.fromEntries(
      Object.entries(doc.monitors).map(([k, m]) => [
        k,
        {
          items: m.items.map((it) =>
            it.type === "stack"
              ? {
                  id: it.id,
                  type: "stack",
                  x: it.x,
                  y: it.y,
                  w: it.w,
                  h: it.h,
                  children: it.children,
                  activeIndex: it.activeIndex ?? 0,
                  smartRotate: it.smartRotate ?? false,
                }
              : { id: it.id, type: "widget", kind: it.kind, x: it.x, y: it.y, w: it.w, h: it.h },
          ),
        },
      ]),
    ),
  };
  return await command({ cmd: "update-layouts", layouts: fromJson(json) });
}

export async function listFonts(): Promise<string[]> {
  const r = await command({ cmd: "list-fonts" });
  if (r.result !== "data" || r.value.kind !== "list") return [];
  return r.value.v.flatMap((x) => (x.kind === "text" ? [x.v] : []));
}

export function useLayerValues<T>(selector: (values: Readonly<Record<string, Value>>) => T): T {
  return useLayer((s) => selector(s.values));
}

/** Colors from core: GNOME accent, light/dark, and the source color of this monitor's wallpaper. */
export function useCoreColors(monitorKey: string | null): ColorContext {
  const appearance = useLayer((s) => s.values[APPEARANCE_TOPIC]);
  const wallpapers = useLayer((s) => s.values[WALLPAPER_TOPIC]);
  const [wallSource, setWallSource] = useState(DEFAULT_SOURCE);
  const a = record(toJson(appearance));
  const rgb = Array.isArray(a.accentRgb)
    ? a.accentRgb.map((c) => Math.round(Number(c) * 255))
    : null;
  const accent =
    rgb?.length === 3 ? argbFromRgb(rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0) : DEFAULT_SOURCE;
  const dark = a.colorScheme !== "light";
  const monitors = record(toJson(wallpapers));
  const entry = record((monitorKey ? monitors[monitorKey] : Object.values(monitors)[0]) ?? null);
  const glass = typeof entry.glass === "string" ? entry.glass : null;

  useEffect(() => {
    subscribeTopics(
      [
        APPEARANCE_TOPIC,
        WALLPAPER_TOPIC,
        SETTINGS_TOPIC,
        LAYOUTS_TOPIC,
        THEMES_TOPIC,
        CSS_TOPIC,
        PROBLEMS_TOPIC,
      ],
      "ambient",
    );
  }, []);
  useEffect(() => {
    if (!glass) return;
    let alive = true;
    sourceFromWallpaper(glass)
      .then((s) => {
        if (alive) setWallSource(s);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [glass]);

  return useMemo(
    () => ({ wallpaper: wallSource, accent, systemDark: dark }),
    [wallSource, accent, dark],
  );
}

/** Connects this window to the layer: spectrum frames go to the visualizer, the rest to the store. */
export async function attachLayer(): Promise<void> {
  const apply = useLayer.getState().apply;
  await attach((event) => {
    if (event.kind === "spectrum") emitSpectrum(event.levels);
    else if (event.kind === "waveform") emitWaveform(event.samples);
    else if (event.kind === "stereo")
      emitStereo({
        leftRms: event.leftRms,
        rightRms: event.rightRms,
        left: event.left,
        right: event.right,
      });
    else apply(event);
  });
}

/** Extracts the active theme's style layers from core's `themes` topic. */
export function activeThemeLayers(v: Value | undefined): ThemeStyleLayers | undefined {
  const catalog = record(toJson(v));
  const active = record(catalog.active ?? null);
  const pkg = record(active.package ?? null);
  const id = typeof pkg.id === "string" ? pkg.id : null;
  if (!id) return undefined;
  const kinds: Record<string, Record<string, Json>> = {};
  for (const [k, s] of Object.entries(record(pkg.kinds ?? null))) kinds[k] = record(s);
  const elements: Record<string, Record<string, Json>> = {};
  for (const [k, s] of Object.entries(record(pkg.elements ?? null))) elements[k] = record(s);
  return {
    id,
    style: record(pkg.style ?? null),
    ...(Object.keys(kinds).length ? { kinds } : {}),
    ...(Object.keys(elements).length ? { elements } : {}),
  };
}

export interface LiveConfigProblem {
  file: string;
  at: string;
  message: string;
}

/** Reads non-blocking config/theme/CSS problems published by core. */
export function storedProblems(v: Value | undefined): LiveConfigProblem[] {
  const raw = toJson(v);
  if (!Array.isArray(raw)) return [];
  const out: LiveConfigProblem[] = [];
  for (const item of raw) {
    const r = record(item);
    if (typeof r.file === "string" && typeof r.message === "string") {
      out.push({
        file: r.file,
        at: typeof r.at === "string" ? r.at : "/",
        message: r.message,
      });
    }
  }
  return out;
}

function upsertStyleTag(id: string, css: string) {
  let tag = document.getElementById(id) as HTMLStyleElement | null;
  if (!css.trim()) {
    tag?.remove();
    return;
  }
  if (!tag) {
    tag = document.createElement("style");
    tag.id = id;
    document.head.appendChild(tag);
  }
  if (tag.textContent !== css) tag.textContent = css;
}

/**
 * Live-injects active `theme.css` and `~/.config/opaline/user.css` after the design system
 * stylesheets (brief §5.3). Safe mode sends empty CSS and removes both tags automatically.
 */
export function useLiveCss(themeId: string | undefined): void {
  const cssVal = useLayer((s) => s.values[CSS_TOPIC]);
  useEffect(() => {
    if (themeId) document.documentElement.dataset.theme = themeId;
    else delete document.documentElement.dataset.theme;
  }, [themeId]);
  useEffect(() => {
    const bundle = record(toJson(cssVal));
    const themeCss = typeof bundle.themeCss === "string" ? bundle.themeCss : "";
    const userCss = typeof bundle.userCss === "string" ? bundle.userCss : "";
    upsertStyleTag("opaline-theme-css", themeCss);
    upsertStyleTag("opaline-user-css", userCss);
  }, [cssVal]);
}

/** The widget host for a layer window: everything from core. */
export function useCoreHost(monitorKey: string | null): import("./host").WidgetHost {
  const settingsValue = useLayer((s) => s.values[SETTINGS_TOPIC]);
  const themesValue = useLayer((s) => s.values[THEMES_TOPIC]);
  const settings = useMemo(() => storedSettings(settingsValue), [settingsValue]);
  const theme = useMemo(() => activeThemeLayers(themesValue), [themesValue]);
  const colors = useCoreColors(monitorKey);
  return useMemo(
    () => ({
      useValues: useLayerValues,
      subscribe: subscribeTopics,
      settings,
      theme,
      updateSettings,
      listFonts,
      command: (cmd) => command(cmd),
      onSpectrum,
      onWaveform,
      onStereo,
      colors,
    }),
    [settings, theme, colors],
  );
}

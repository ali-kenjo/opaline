// The widget host backed by core: live values from the layer store, settings from core's
// `settings` topic, saved through commands. Used by the layer (and the Lab's ?live mode).
import { argbFromRgb } from "@material/material-color-utilities";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_SOURCE } from "../design-system/color/scheme";
import { sourceFromWallpaper } from "../design-system/color/source";
import type { ColorContext } from "../design-system/style";
import { attach, command, inTauri, subscribe } from "../layer/bridge";
import type { ActivityClass, Value } from "../layer/protocol";
import { useLayer } from "../layer/store";
import type { StoredSettings, StoredWidget } from "./host";
import { type Json, fromJson, toJson } from "./json";
import { emitSpectrum, onSpectrum } from "./spectrum";

export const SETTINGS_TOPIC = "settings";
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
    if (typeof r.kind === "string")
      widgets[id] = {
        kind: r.kind,
        style: record(r.style ?? null),
        content: record(r.content ?? null),
      };
  }
  const styles: Record<string, Record<string, Json>> = {};
  for (const [name, s] of Object.entries(record(j.styles ?? null))) styles[name] = record(s);
  return { style: record(j.style ?? null), styles, widgets };
}

export async function updateSettings(patch: Record<string, Json>) {
  return await command({ cmd: "update-settings", patch: fromJson(patch) });
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
    subscribeTopics([APPEARANCE_TOPIC, WALLPAPER_TOPIC, SETTINGS_TOPIC], "ambient");
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
    else apply(event);
  });
}

/** The widget host for a layer window: everything from core. */
export function useCoreHost(monitorKey: string | null): import("./host").WidgetHost {
  const settingsValue = useLayer((s) => s.values[SETTINGS_TOPIC]);
  const settings = useMemo(() => storedSettings(settingsValue), [settingsValue]);
  const colors = useCoreColors(monitorKey);
  return useMemo(
    () => ({
      useValues: useLayerValues,
      subscribe: subscribeTopics,
      settings,
      updateSettings,
      listFonts,
      command: (cmd) => command(cmd),
      onSpectrum,
      colors,
    }),
    [settings, colors],
  );
}

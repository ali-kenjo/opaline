// Real widgets in the Lab: every size class, content choices and custom styles over the Lab
// wallpaper, with mock data. The tune button on a card opens its settings sheet; changes apply
// at once (kept in memory, with core's merge-patch rules).
import { sourceColorFromImageBytes } from "@material/material-color-utilities";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GNOME_ACCENTS, type Variant } from "../design-system/color/scheme";
import { GlassStage } from "../design-system/glass";
import { useLayer } from "../layer/store";
import type { CommandResult, Value } from "../layer/protocol";
import { type StoredSettings, HostContext, type WidgetHost } from "../widgets/host";
import { type Json, mergePatch } from "../widgets/json";
import { listFonts, subscribeTopics, useCoreColors, useLayerValues } from "../widgets/layerHost";
import { widgetByKind } from "../widgets/registry";
import { WidgetSettings } from "../widgets/settings/WidgetSettings";
import { WidgetFrame } from "../widgets/WidgetFrame";
import { labTint } from "./labTint";
import { LAB_FONTS, LAB_LAYOUT, LAB_NOW, LAB_SETTINGS, mockValues, useLabValues } from "./labHost";
import styles from "./Lab.module.css";
import { type LabWallpaper, makeWallpaper } from "./wallpapers";

const STAGE_W = 1100;
const STAGE_H = 1250;

function useMockValues<T>(sel: (v: Readonly<Record<string, Value>>) => T): T {
  return useLabValues((st) => sel(st.values));
}

export interface WidgetsDemoProps {
  wallpaperId: LabWallpaper["id"];
  dark: boolean;
  variant: Variant;
  value: number;
  still: boolean;
  /** Inside Opaline (debug, OPALINE_LAYER_PAGE=lab.html?live): real sensor data and fonts. */
  live: boolean;
}

export function WidgetsDemo({ wallpaperId, dark, variant, value, still, live }: WidgetsDemoProps) {
  const monitor = useLayer((st) => st.monitor);
  const coreColors = useCoreColors(live ? (monitor?.key ?? null) : null);
  const wallpaper = useMemo(() => makeWallpaper(wallpaperId, STAGE_W, STAGE_H), [wallpaperId]);
  const source = useMemo(() => sourceColorFromImageBytes(wallpaper.pixels), [wallpaper]);
  const [settings, setSettings] = useState<StoredSettings>(LAB_SETTINGS);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    useLabValues.setState({ values: mockValues(value) });
  }, [value]);

  const updateSettings = useCallback(
    async (patch: Record<string, Json>): Promise<CommandResult> => {
      setSettings((s) => mergePatch(s as unknown as Json, patch) as unknown as StoredSettings);
      return Promise.resolve({ result: "ok" });
    },
    [],
  );

  const host: WidgetHost = useMemo(
    () => ({
      useValues: live ? useLayerValues : useMockValues,
      subscribe: live ? subscribeTopics : () => undefined,
      settings: { style: settings.style, styles: settings.styles, widgets: settings.widgets },
      updateSettings,
      listFonts: live ? listFonts : () => Promise.resolve(LAB_FONTS),
      colors: live
        ? { ...coreColors, wallpaper: source, systemDark: dark }
        : { wallpaper: source, accent: GNOME_ACCENTS.blue ?? source, systemDark: dark },
      ...(still ? { now: () => LAB_NOW } : {}),
    }),
    [settings, updateSettings, source, dark, still, live, coreColors],
  );

  const tint = useMemo(() => labTint(source, variant, dark), [source, variant, dark]);
  const openWidget = open ? settings.widgets[open] : undefined;
  const openDef = openWidget ? widgetByKind(openWidget.kind) : undefined;

  return (
    <HostContext.Provider value={host}>
      <section className={styles.section} aria-label="Widgets">
        <h2 className={styles.heading}>Widgets</h2>
        <div
          className={styles.desktop}
          style={{ backgroundImage: `url(${wallpaper.url})`, width: STAGE_W, height: STAGE_H }}
        >
          <GlassStage
            wallpaper={wallpaper.blurred}
            wallpaperUrl={wallpaper.url}
            placement={{ offsetX: 0, offsetY: 0, monitorWidth: STAGE_W, monitorHeight: STAGE_H }}
            tint={tint.rgb}
            textLuminance={tint.textLuminance}
            luminance={wallpaper.luminance}
            slider={45}
          >
            <div
              className={styles.cards}
              style={{ width: STAGE_W, height: STAGE_H }}
              data-testid="widgets"
            >
              {LAB_LAYOUT.map(({ id, size }) => {
                const w = settings.widgets[id];
                const def = w ? widgetByKind(w.kind) : undefined;
                return def ? (
                  <WidgetFrame
                    key={id}
                    id={id}
                    def={def}
                    size={size}
                    onOpenSettings={() => {
                      setOpen(id);
                    }}
                  />
                ) : null;
              })}
            </div>
          </GlassStage>
        </div>
      </section>
      {open && openDef ? (
        <WidgetSettings
          id={open}
          def={openDef}
          open
          onClose={() => {
            setOpen(null);
          }}
        />
      ) : null}
    </HostContext.Provider>
  );
}

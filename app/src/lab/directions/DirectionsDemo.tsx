// P1 task 1.1 (docs/PLAN-2.md): three visual directions for the Opaline theme, shown on the same
// four widgets at S and M, over a dark and a light wallpaper. Lab only: `lab.html?only=directions`.
import { useMemo } from "react";
import { sourceColorFromImageBytes } from "@material/material-color-utilities";
import { buildRoles, cssVariables } from "../../design-system/color/scheme";
import { GlassStage } from "../../design-system/glass";
import { labTint } from "../labTint";
import { type LabWallpaper, makeWallpaper } from "../wallpapers";
import { KIND_HEX, kindColors } from "./data";
import { InstrumentClock, InstrumentCpu, InstrumentMedia, InstrumentWeather } from "./instrument";
import { LensClock, LensCpu, LensMedia, LensWeather } from "./lens";
import { OpalineClock, OpalineCpu, OpalineMedia, OpalineWeather } from "./opaline";
import { PebbleClock, PebbleCpu, PebbleMedia, PebbleWeather } from "./pebble";
import styles from "./Directions.module.css";

const STAGE_W = 4 * 756 + 3 * 48 + 80;
const STAGE_H = 690;

const HALO = {
  dark: {
    text: "0 0 1px rgb(0 0 0 / 0.35), 0 1px 12px rgb(0 0 0 / 0.3)",
    box: "0 0 10px rgb(0 0 0 / 0.25)",
    drop: "0 1px 6px rgb(0 0 0 / 0.35)",
  },
  light: {
    text: "0 0 1px rgb(255 255 255 / 0.5), 0 1px 12px rgb(255 255 255 / 0.45)",
    box: "0 0 10px rgb(255 255 255 / 0.4)",
    drop: "0 1px 6px rgb(255 255 255 / 0.5)",
  },
} as const;

function Stage({ wallpaperId, dark }: { wallpaperId: LabWallpaper["id"]; dark: boolean }) {
  const wallpaper = useMemo(() => makeWallpaper(wallpaperId, STAGE_W, STAGE_H), [wallpaperId]);
  const source = useMemo(() => sourceColorFromImageBytes(wallpaper.pixels), [wallpaper]);
  const tint = useMemo(() => labTint(source, "tonal-spot", dark), [source, dark]);
  const vars = useMemo(
    () => cssVariables(buildRoles({ source, variant: "tonal-spot", dark, contrast: 0 })),
    [source, dark],
  );
  const colors = useMemo(
    () => ({
      clock: kindColors(KIND_HEX.clock, source, dark),
      cpu: kindColors(KIND_HEX.cpu, source, dark),
      sun: kindColors(KIND_HEX.sun, source, dark),
      sky: kindColors(KIND_HEX.sky, source, dark),
      media: kindColors(KIND_HEX.media, source, dark),
    }),
    [source, dark],
  );
  // The instrument direction is always smoked, so its accents use the dark tones.
  const smokedColors = useMemo(
    () => ({
      clock: kindColors(KIND_HEX.clock, source, true),
      cpu: kindColors(KIND_HEX.cpu, source, true),
      sun: kindColors(KIND_HEX.sun, source, true),
      sky: kindColors(KIND_HEX.sky, source, true),
      media: kindColors(KIND_HEX.media, source, true),
    }),
    [source],
  );
  const halo = dark ? HALO.dark : HALO.light;
  const style = {
    ...vars,
    "--halo": halo.text,
    "--halo-box": halo.box,
    "--halo-drop": halo.drop,
    "--name-color": "rgb(var(--md-on-surface))",
    backgroundImage: `url(${wallpaper.url})`,
    width: STAGE_W,
    height: STAGE_H,
  } as React.CSSProperties;

  return (
    <div className={styles.desktop} style={style} data-testid={`directions-${wallpaperId}`}>
      <GlassStage
        wallpaper={wallpaper.blurred}
        wallpaperUrl={wallpaper.url}
        placement={{ offsetX: 0, offsetY: 0, monitorWidth: STAGE_W, monitorHeight: STAGE_H }}
        tint={tint.rgb}
        textLuminance={tint.textLuminance}
        luminance={wallpaper.luminance}
        slider={45}
      >
        <div className={styles.columns}>
          <div className={styles.direction}>
            <h3 className={styles.name}>
              Opaline (default)
              <small>The hybrid: Lens type, Pebble shapes, Instrument charts</small>
            </h3>
            <OpalineClock size="M" colors={colors} />
            <OpalineCpu size="M" colors={colors} />
            <OpalineWeather size="M" colors={colors} />
            <OpalineMedia size="M" colors={colors} />
            <OpalineClock size="S" colors={colors} />
            <OpalineCpu size="S" colors={colors} />
            <OpalineWeather size="S" colors={colors} />
            <OpalineMedia size="S" colors={colors} />
          </div>
          <div className={styles.direction}>
            <h3 className={styles.name}>
              Crystal (A · Lens)<small>Clear glass; the numbers are the design</small>
            </h3>
            <LensClock size="M" />
            <LensCpu size="M" />
            <LensWeather size="M" />
            <LensMedia size="M" />
            <LensClock size="S" />
            <LensCpu size="S" />
            <LensWeather size="S" />
            <LensMedia size="S" />
          </div>
          <div className={styles.direction}>
            <h3 className={styles.name}>
              Bloom (B · Pebble)<small>Tinted per widget; shapes carry the data</small>
            </h3>
            <PebbleClock size="M" colors={colors} />
            <PebbleCpu size="M" colors={colors} />
            <PebbleWeather size="M" colors={colors} />
            <PebbleMedia size="M" colors={colors} />
            <PebbleClock size="S" colors={colors} />
            <PebbleCpu size="S" colors={colors} />
            <PebbleWeather size="S" colors={colors} />
            <PebbleMedia size="S" colors={colors} />
          </div>
          <div className={styles.direction}>
            <h3 className={styles.name}>
              Instrument (C)<small>Smoked glass; dials, scales and charts</small>
            </h3>
            <InstrumentClock size="M" colors={smokedColors} />
            <InstrumentCpu size="M" colors={smokedColors} />
            <InstrumentWeather size="M" colors={smokedColors} />
            <InstrumentMedia size="M" colors={smokedColors} />
            <InstrumentClock size="S" colors={smokedColors} />
            <InstrumentCpu size="S" colors={smokedColors} />
            <InstrumentWeather size="S" colors={smokedColors} />
            <InstrumentMedia size="S" colors={smokedColors} />
          </div>
        </div>
      </GlassStage>
    </div>
  );
}

export function DirectionsDemo() {
  return (
    <section className={styles.page} aria-label="Visual directions">
      <p className={styles.intro}>
        The default Opaline look and the three directions it combines, each on Clock, CPU, Weather
        and Now Playing at M (top) and S (bottom). Same data, same wallpapers; only the design
        differs.
      </p>
      <Stage wallpaperId="dusk" dark />
      <Stage wallpaperId="snow" dark={false} />
    </section>
  );
}

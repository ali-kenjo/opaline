// Spike S1 (PLAN-2 §4, ADR 0012): the same Opaline cards in the three see modes, side by side:
// today's sampled quarter-res glass, sharp (full-resolution texture at blur 0) and true alpha
// (the page behind shows through, the way the real desktop would). `lab.html?spike=glass`.
import { sourceColorFromImageBytes } from "@material/material-color-utilities";
import { useMemo } from "react";
import { buildRoles, cssVariables } from "../../design-system/color/scheme";
import { GlassStage } from "../../design-system/glass";
import { KIND_HEX, kindColors } from "../directions/data";
import { OpalineClock, OpalineCpu, OpalineMedia, OpalineWeather } from "../directions/opaline";
import dstyles from "../directions/Directions.module.css";
import { labTint } from "../labTint";
import { type LabWallpaper, makeWallpaper } from "../wallpapers";

const COLUMN_W = 756;
const STAGE_H = 690;
const MODES = [
  { id: null, name: "Today (sampled, quarter resolution)" },
  { id: "sharp", name: "Sharp (full resolution at blur 0)" },
  { id: "alpha", name: "True alpha (what's behind shows through)" },
] as const;

function Column({
  wallpaperId,
  dark,
  mode,
  name,
}: {
  wallpaperId: LabWallpaper["id"];
  dark: boolean;
  mode: "sharp" | "alpha" | null;
  name: string;
}) {
  const w = COLUMN_W + 80;
  const wallpaper = useMemo(() => makeWallpaper(wallpaperId, w, STAGE_H), [wallpaperId, w]);
  const source = useMemo(() => sourceColorFromImageBytes(wallpaper.pixels), [wallpaper]);
  const tint = useMemo(() => labTint(source, "tonal-spot", dark), [source, dark]);
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
  const style = {
    ...cssVariables(buildRoles({ source, variant: "tonal-spot", dark, contrast: 0 })),
    "--halo": dark
      ? "0 0 1px rgb(0 0 0 / 0.35), 0 1px 12px rgb(0 0 0 / 0.3)"
      : "0 0 1px rgb(255 255 255 / 0.5), 0 1px 12px rgb(255 255 255 / 0.45)",
    "--halo-drop": dark ? "0 1px 6px rgb(0 0 0 / 0.35)" : "0 1px 6px rgb(255 255 255 / 0.5)",
    "--name-color": "rgb(var(--md-on-surface))",
    backgroundImage: `url(${wallpaper.url})`,
    width: w,
    height: STAGE_H,
  } as React.CSSProperties;
  return (
    <div
      className={dstyles.desktop}
      style={style}
      data-testid={`spike-glass-${wallpaperId}-${mode ?? "sampled"}`}
    >
      <GlassStage
        wallpaper={wallpaper.blurred}
        sharpWallpaper={mode === "sharp" ? wallpaper.sharp : null}
        spikeSee={mode}
        wallpaperUrl={wallpaper.url}
        placement={{ offsetX: 0, offsetY: 0, monitorWidth: w, monitorHeight: STAGE_H }}
        tint={tint.rgb}
        textLuminance={tint.textLuminance}
        luminance={wallpaper.luminance}
        slider={45}
      >
        <div className={dstyles.columns} style={{ gridTemplateColumns: `${String(COLUMN_W)}px` }}>
          <div className={dstyles.direction}>
            <h3 className={dstyles.name}>{name}</h3>
            <OpalineClock size="M" colors={colors} />
            <OpalineCpu size="M" colors={colors} />
            <OpalineWeather size="M" colors={colors} />
            <OpalineMedia size="M" colors={colors} />
            <OpalineClock size="S" colors={colors} />
            <OpalineCpu size="S" colors={colors} />
            <OpalineWeather size="S" colors={colors} />
            <OpalineMedia size="S" colors={colors} />
          </div>
        </div>
      </GlassStage>
    </div>
  );
}

export function SpikeGlass() {
  return (
    <section aria-label="Glass see modes" style={{ display: "grid", gap: 24 }}>
      {(["detail", "dusk"] as const).map((wp) => (
        <div key={wp} style={{ display: "flex", gap: 24 }}>
          {MODES.map((m) => (
            <Column key={m.name} wallpaperId={wp} dark mode={m.id} name={m.name} />
          ))}
        </div>
      ))}
    </section>
  );
}

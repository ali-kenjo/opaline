// Glass over the three test wallpapers, with the slider, light/dark and opaque mode, and the
// scheme derived from the wallpaper (docs/DESIGN.md §3–4).
import { sourceColorFromImageBytes } from "@material/material-color-utilities";
import { useEffect, useMemo } from "react";
import { buildRoles, cssVariables, type Variant } from "../design-system/color/scheme";
import { Glass, GlassStage } from "../design-system/glass";
import { luminance } from "../design-system/glass/legibility";
import { Icon } from "../design-system/icons";
import { Odometer, applyPalette } from "../design-system/motion";
import { cubicsToPath, materialShape } from "../design-system/shapes";
import styles from "./Lab.module.css";
import { type LabWallpaper, makeWallpaper } from "./wallpapers";

const STAGE_W = 1100;
const STAGE_H = 460;

export interface GlassDemoProps {
  wallpaperId: LabWallpaper["id"];
  dark: boolean;
  slider: number;
  opaque: boolean;
  variant: Variant;
  value: number;
}

export function GlassDemo({ wallpaperId, dark, slider, opaque, variant, value }: GlassDemoProps) {
  const wallpaper = useMemo(() => makeWallpaper(wallpaperId, STAGE_W, STAGE_H), [wallpaperId]);
  const roles = useMemo(
    () =>
      buildRoles({
        source: sourceColorFromImageBytes(wallpaper.pixels),
        variant,
        dark,
        contrast: 0,
      }),
    [wallpaper, variant, dark],
  );
  const tint = useMemo<[number, number, number]>(() => {
    const c = roles.surfaceContainer;
    return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  }, [roles]);

  useEffect(() => {
    applyPalette(cssVariables(roles));
  }, [roles]);

  const text = roles.onSurface;
  const textLuminance = luminance((text >> 16) & 255, (text >> 8) & 255, text & 255);
  const cookie = cubicsToPath(materialShape("cookie9Sided").cubics, 64);

  return (
    <section className={styles.section} aria-label="Glass">
      <div
        className={styles.desktop}
        style={{ backgroundImage: `url(${wallpaper.url})`, width: STAGE_W, height: STAGE_H }}
      >
        <GlassStage
          wallpaper={wallpaper.blurred}
          wallpaperUrl={wallpaper.url}
          placement={{ offsetX: 0, offsetY: 0, monitorWidth: STAGE_W, monitorHeight: STAGE_H }}
          tint={tint}
          textLuminance={textLuminance}
          luminance={wallpaper.luminance}
          slider={slider}
          opaque={opaque}
        >
          <div className={styles.cards} style={{ width: STAGE_W, height: STAGE_H }}>
            <Glass radius={28} label="CPU" className={styles.cardS}>
              <div className={styles.cardLabel}>
                <Icon name="developer_board" size={18} /> CPU
              </div>
              <div className={styles.cardValue}>
                <Odometer text={`${Math.round(value)} %`} className="numeric" />
              </div>
              <div className={styles.cardMeta}>4.2 GHz · 61 °C</div>
            </Glass>
            <Glass radius={32} label="Memory" className={styles.cardM}>
              <div className={styles.cardLabel}>
                <Icon name="memory" size={18} /> Memory
              </div>
              <div className={styles.cardValue}>
                <Odometer text={`${(value / 10).toFixed(1)} GB`} className="numeric" />
              </div>
              <div className={styles.cardMeta}>of 15.9 GB · swap 0.8 GB</div>
            </Glass>
            <Glass radius={28} label="Dimmed" dimmed={1} className={styles.cardS}>
              <div className={styles.cardLabel}>
                <Icon name="thermostat" size={18} /> Dimmed
              </div>
              <div className={styles.cardValue}>
                <span className="numeric">45 °C</span>
              </div>
              <div className={styles.cardMeta}>appearance state</div>
            </Glass>
            <Glass radius={28} label="Lifted" lifted={1} className={styles.cardS}>
              <div className={styles.cardLabel}>
                <Icon name="drag_indicator" size={18} /> Lifted
              </div>
              <div className={styles.cardValue}>
                <span className="numeric">1.04×</span>
              </div>
              <div className={styles.cardMeta}>while dragging</div>
            </Glass>
            <div className={styles.shapeCell}>
              <svg viewBox="0 0 64 64" width={96} height={96} aria-label="Cookie shape" role="img">
                <path d={cookie} fill="rgb(var(--md-primary))" />
              </svg>
            </div>
          </div>
        </GlassStage>
      </div>
    </section>
  );
}

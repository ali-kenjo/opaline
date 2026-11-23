// The Widget Lab (dev builds only, docs/PLAN.md 2.8): every widget × size × theme × state over
// selectable wallpapers, with mock data. It grows with Phase 2 and 3. URL parameters set the
// state, so screenshot tests can pin it: ?wallpaper=snow&theme=light&slider=45&opaque&still
import { useEffect, useState } from "react";
import type { Variant } from "../design-system/color/scheme";
import { setReducedMotion } from "../design-system/motion";
import { ComponentsDemo } from "./ComponentsDemo";
import { GlassDemo } from "./GlassDemo";
import styles from "./Lab.module.css";
import { Specimen } from "./Specimen";
import type { LabWallpaper } from "./wallpapers";

const params = new URLSearchParams(location.search);
const still = params.has("still");
if (still) setReducedMotion(true);

export function LabApp() {
  const [value, setValue] = useState(42.5);
  const [wallpaper, setWallpaper] = useState<LabWallpaper["id"]>(
    (params.get("wallpaper") as LabWallpaper["id"] | null) ?? "dusk",
  );
  const [dark, setDark] = useState(params.get("theme") !== "light");
  const [slider, setSlider] = useState(Number(params.get("slider") ?? 45));
  const [opaque, setOpaque] = useState(params.has("opaque"));
  const [variant, setVariant] = useState<Variant>(
    (params.get("variant") as Variant | null) ?? "tonal-spot",
  );

  useEffect(() => {
    if (still) return;
    const id = setInterval(() => {
      setValue((v) =>
        Math.max(1, Math.min(99, Math.round((v + (Math.random() - 0.45) * 12) * 10) / 10)),
      );
    }, 1500);
    return () => {
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  }, [dark]);

  return (
    <main className={styles.lab}>
      <h1 className={styles.heading}>Opaline Widget Lab</h1>
      <div className={styles.controls}>
        <label>
          Wallpaper{" "}
          <select
            value={wallpaper}
            onChange={(e) => {
              setWallpaper(e.target.value as LabWallpaper["id"]);
            }}
          >
            <option value="dusk">Dusk</option>
            <option value="forest">Forest</option>
            <option value="snow">Snow</option>
          </select>
        </label>
        <label>
          Variant{" "}
          <select
            value={variant}
            onChange={(e) => {
              setVariant(e.target.value as Variant);
            }}
          >
            {["tonal-spot", "vibrant", "expressive", "fidelity", "neutral", "monochrome"].map(
              (v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ),
            )}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={dark}
            onChange={(e) => {
              setDark(e.target.checked);
            }}
          />{" "}
          Dark
        </label>
        <label>
          Glass{" "}
          <input
            type="range"
            min={0}
            max={100}
            value={slider}
            onChange={(e) => {
              setSlider(Number(e.target.value));
            }}
          />{" "}
          {slider}
        </label>
        <label>
          <input
            type="checkbox"
            checked={opaque}
            onChange={(e) => {
              setOpaque(e.target.checked);
            }}
          />{" "}
          Opaque
        </label>
      </div>
      <GlassDemo
        wallpaperId={wallpaper}
        dark={dark}
        slider={slider}
        opaque={opaque}
        variant={variant}
        value={value}
      />
      <ComponentsDemo dark={dark} value={value} />
      <Specimen value={value} />
    </main>
  );
}

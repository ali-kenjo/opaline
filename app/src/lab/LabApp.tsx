// The Widget Lab (dev builds only, docs/PLAN.md 2.8): every widget × size × theme × state over
// selectable wallpapers, with mock data. It grows with Phase 2 and 3. URL parameters set the
// state, so screenshot tests can pin it: ?wallpaper=snow&theme=light&slider=45&opaque&still
import { useEffect, useState } from "react";
import type { Variant } from "../design-system/color/scheme";
import { scheduler, setReducedMotion } from "../design-system/motion";
import { evaluationCount } from "../compose/runtime";
import { ComponentsDemo } from "./ComponentsDemo";
import { DirectionsDemo } from "./directions/DirectionsDemo";
import { SpikeGlass } from "./spike/SpikeGlass";
import { SpikeWebkit } from "./spike/SpikeWebkit";
import { GlassDemo } from "./GlassDemo";
import styles from "./Lab.module.css";
import { Specimen } from "./Specimen";
import { WidgetsDemo } from "./WidgetsDemo";
import type { LabWallpaper } from "./wallpapers";
import { runWebviewCheck } from "./webviewCheck";
import { inTauri } from "../layer/bridge";
import { attachLayer } from "../widgets/layerHost";

const params = new URLSearchParams(location.search);
// Screenshot tests read the frame counter to prove that an idle Lab draws nothing.
(window as unknown as { __labScheduler?: typeof scheduler }).__labScheduler = scheduler;
// …and the composition runtimes' evaluation counter, to prove an idle Lab evaluates nothing.
(window as unknown as { __labEvaluations?: typeof evaluationCount }).__labEvaluations =
  evaluationCount;
const still = params.has("still");
/** `?only=glass|widgets|components|specimen` shows one section (for memory and perf bisecting). */
const only = params.get("only");
const shows = (section: string) => (only === null && !params.has("spike")) || only === section;
/** Spike pages (PLAN-2 §4): `?spike=webkit`. */
const spike = params.get("spike");
/** The P1 visual directions are opt-in, so the regular Lab and its baselines stay as they are. */
const directions = only === "directions";
if (still) setReducedMotion(true);
runWebviewCheck();
const live = params.has("live") && inTauri;
if (live) {
  attachLayer().catch((e: unknown) => {
    console.error("layer_attach failed", e);
  });
}

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
      {shows("glass") ? (
        <GlassDemo
          wallpaperId={wallpaper}
          dark={dark}
          slider={slider}
          opaque={opaque}
          variant={variant}
          value={value}
        />
      ) : null}
      {shows("widgets") ? (
        <WidgetsDemo
          wallpaperId={wallpaper}
          dark={dark}
          variant={variant}
          value={value}
          still={still}
          live={live}
        />
      ) : null}
      {shows("components") ? <ComponentsDemo dark={dark} value={value} /> : null}
      {shows("specimen") ? <Specimen value={value} /> : null}
      {directions ? <DirectionsDemo /> : null}
      {spike === "webkit" ? <SpikeWebkit /> : null}
      {spike === "glass" ? <SpikeGlass /> : null}
    </main>
  );
}

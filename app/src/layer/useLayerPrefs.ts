// Layer-wide preferences read from core's settings and the desktop's appearance settings:
// appearance state, glass strength, grid margin, language, and the accessibility settings
// (split out of LayerApp.tsx).
import { useMemo } from "react";
import { APPEARANCE_TOPIC } from "../widgets/layerHost";
import { toJson } from "../widgets/json";
import { useLayer } from "./store";

export function useLayerPrefs() {
  const rawSettings = useLayer((s) => s.values.settings);
  const rawAppearance = useLayer((s) => s.values[APPEARANCE_TOPIC]);
  const settingsExtra = useMemo(() => {
    const j = toJson(rawSettings);
    const obj = typeof j === "object" && j !== null && !Array.isArray(j) ? j : {};
    const app =
      typeof obj.appearance === "object" &&
      obj.appearance !== null &&
      !Array.isArray(obj.appearance)
        ? obj.appearance
        : {};
    const lay =
      typeof obj.layout === "object" && obj.layout !== null && !Array.isArray(obj.layout)
        ? obj.layout
        : {};
    const state =
      app.state === "full" || app.state === "dimmed" || app.state === "automatic"
        ? app.state
        : "automatic";
    const glass = typeof app.glass === "number" ? Math.max(0, Math.min(100, app.glass)) : 45;
    const marginPx =
      typeof lay.marginPx === "number" ? Math.max(12, Math.min(64, lay.marginPx)) : 24;
    const language = typeof obj.language === "string" ? obj.language : "system";
    return { state, glass, marginPx, language };
  }, [rawSettings]);
  const a11y = useMemo(() => {
    const j = toJson(rawAppearance);
    const obj = typeof j === "object" && j !== null && !Array.isArray(j) ? j : {};
    const highContrast = obj.highContrast === true;
    const reduced = obj.animations === false || obj.reducedMotion === true;
    const scale =
      typeof obj.textScale === "number" && Number.isFinite(obj.textScale)
        ? Math.min(2, Math.max(0.75, obj.textScale))
        : 1;
    return { highContrast, reduced, scale };
  }, [rawAppearance]);
  return { settingsExtra, a11y };
}

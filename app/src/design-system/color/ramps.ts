// Semantic ramps in HCT (docs/DESIGN.md §3): thermal, load and health, harmonized with the
// scheme's source color so they belong to the palette. Always paired with an icon or label.
import { Blend, Hct, argbFromHex } from "@material/material-color-utilities";

export type RampName = "thermal" | "load" | "health";

/** Design anchors; harmonized toward the source before use. */
const ANCHORS: Record<RampName, readonly string[]> = {
  // cool teal → amber → red
  thermal: ["#1a9fa0", "#e0a020", "#d93a2b"],
  // calm → busy → saturated (primary-ish blue → violet → red)
  load: ["#4a7fd6", "#9a5cc8", "#d93a2b"],
  // good → fair → failing
  health: ["#2e9d55", "#e0a020", "#d93a2b"],
};

/** Shortest-path hue interpolation in degrees. */
export function lerpHue(a: number, b: number, t: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}

export interface Ramp {
  /** Color at `t` ∈ [0, 1] (clamped), as ARGB. */
  at(t: number): number;
}

/** A ramp whose stops share one tone (light/dark aware) so text contrast stays predictable. */
export function makeRamp(name: RampName, source: number, dark: boolean): Ramp {
  const tone = dark ? 72 : 42;
  const stops = ANCHORS[name].map((hex) => {
    const harmonized = Hct.fromInt(Blend.harmonize(argbFromHex(hex), source));
    return { hue: harmonized.hue, chroma: Math.max(36, harmonized.chroma) };
  });
  return {
    at(t: number) {
      const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
      const i = Math.min(stops.length - 2, Math.floor(x));
      const f = x - i;
      const a = stops[i];
      const b = stops[i + 1];
      if (!a || !b) return Hct.from(0, 0, tone).toInt();
      return Hct.from(lerpHue(a.hue, b.hue, f), a.chroma + (b.chroma - a.chroma) * f, tone).toInt();
    },
  };
}

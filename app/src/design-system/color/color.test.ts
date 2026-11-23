import { Hct, argbFromHex } from "@material/material-color-utilities";
import { describe, expect, it } from "vitest";
import { lerpHue, makeRamp } from "./ramps";
import { GNOME_ACCENTS, ROLES, buildRoles, cssName, cssVariables, triple } from "./scheme";

describe("scheme", () => {
  const orange = GNOME_ACCENTS.orange ?? 0;

  it("builds every role, light and dark differ", () => {
    const dark = buildRoles({ source: orange, variant: "tonal-spot", dark: true, contrast: 0 });
    const light = buildRoles({ source: orange, variant: "tonal-spot", dark: false, contrast: 0 });
    expect(Object.keys(dark)).toHaveLength(ROLES.length);
    expect(Hct.fromInt(dark.surface).tone).toBeLessThan(15);
    expect(Hct.fromInt(light.surface).tone).toBeGreaterThan(85);
    expect(dark.primary).not.toBe(light.primary);
  });

  it("monochrome has no chroma", () => {
    const mono = buildRoles({ source: orange, variant: "monochrome", dark: true, contrast: 0 });
    // sRGB rounding leaves a trace of chroma; a colorful scheme is far above 20.
    expect(Hct.fromInt(mono.primary).chroma).toBeLessThan(4);
  });

  it("maps roles to CSS triples", () => {
    expect(cssName("onSurfaceVariant")).toBe("--md-on-surface-variant");
    expect(triple(argbFromHex("#ff8000"))).toBe("255 128 0");
    const vars = cssVariables(
      buildRoles({ source: orange, variant: "vibrant", dark: false, contrast: 0.5 }),
    );
    expect(vars["--md-primary"]).toMatch(/^\d+ \d+ \d+$/);
  });
});

describe("ramps", () => {
  it("interpolates hue the short way", () => {
    expect(lerpHue(350, 10, 0.5)).toBeCloseTo(0);
    expect(lerpHue(10, 350, 0.5)).toBeCloseTo(0);
    expect(lerpHue(100, 200, 0.25)).toBeCloseTo(125);
  });

  it("thermal goes from cool to hot at one tone", () => {
    const r = makeRamp("thermal", GNOME_ACCENTS.blue ?? 0, true);
    const cool = Hct.fromInt(r.at(0));
    const hot = Hct.fromInt(r.at(1));
    expect(cool.hue).toBeGreaterThan(150);
    expect(cool.hue).toBeLessThan(230);
    expect(hot.hue < 50 || hot.hue > 330).toBe(true);
    expect(Math.abs(cool.tone - hot.tone)).toBeLessThan(3);
    expect(r.at(-1)).toBe(r.at(0));
  });
});

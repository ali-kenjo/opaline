import { describe, expect, it } from "vitest";
import { Cubic } from "../shapes/cubic";
import { flatten } from "./compositor";
import { contrast, legibleAlpha, luminance, luminanceUnder, sliderAlpha } from "./legibility";

describe("legibility", () => {
  it("contrast matches WCAG", () => {
    expect(contrast(1, 0)).toBeCloseTo(21);
    expect(contrast(luminance(255, 255, 255), luminance(118, 118, 118))).toBeCloseTo(4.54, 1);
  });

  it("raises the tint only as far as needed", () => {
    const text = luminance(240, 240, 240);
    const tint = luminance(30, 30, 36);
    // Dark wallpaper: the slider's tint is enough.
    expect(legibleAlpha(0.45, 0.02, tint, text)).toBe(0.45);
    // Bright wallpaper under light text: the tint must go up.
    const a = legibleAlpha(0.45, 0.8, tint, text);
    expect(a).toBeGreaterThan(0.45);
    const glass = 0.8 + (tint - 0.8) * a;
    expect(contrast(glass, text)).toBeGreaterThanOrEqual(4.5 - 1e-3);
  });

  it("averages the grid cells under a rect", () => {
    const grid = Array.from({ length: 64 }, (_, i) => (i % 8 < 4 ? 0 : 1));
    expect(luminanceUnder(grid, 0, 0, 0.5, 1)).toBe(0);
    expect(luminanceUnder(grid, 0.5, 0, 0.5, 1)).toBe(1);
    expect(luminanceUnder(grid, 0.25, 0, 0.5, 0.5)).toBe(0.5);
  });

  it("maps the slider", () => {
    expect(sliderAlpha(0)).toBeCloseTo(0.12);
    expect(sliderAlpha(100)).toBeCloseTo(0.9);
    expect(sliderAlpha(45)).toBeGreaterThan(0.4);
  });
});

describe("flatten", () => {
  it("samples each cubic", () => {
    const pts = flatten([Cubic.straightLine(0, 0, 8, 0), Cubic.straightLine(8, 0, 0, 0)], 4);
    expect(pts).toHaveLength(16);
    expect(pts.slice(0, 4)).toEqual([0, 0, 2, 0]);
  });
});

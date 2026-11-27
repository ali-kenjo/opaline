// Hero auto-fit plan (DESIGN-2 §3.3): narrower first, then smaller, never past the minimums.
import { describe, expect, it } from "vitest";
import { HERO_MIN_SCALE, HERO_MIN_WDTH, planNumberFit } from "./fitNumber";

describe("planNumberFit", () => {
  it("leaves a number that fits alone", () => {
    expect(planNumberFit({ natural: 100, atMinWidth: 80, avail: 120, baseWdth: 30 })).toEqual({
      scale: 1,
    });
  });

  it("narrows the width axis first when that is enough", () => {
    // 30 → 25 saves 20 px; 10 px are needed: half way.
    const plan = planNumberFit({ natural: 100, atMinWidth: 80, avail: 90, baseWdth: 30 });
    expect(plan.scale).toBe(1);
    expect(plan.wdth).toBeCloseTo(27.5, 1);
    expect(plan.wdth ?? 0).toBeGreaterThanOrEqual(HERO_MIN_WDTH);
  });

  it("then shrinks from the narrowest width", () => {
    const plan = planNumberFit({ natural: 100, atMinWidth: 80, avail: 60, baseWdth: 30 });
    expect(plan.wdth).toBe(HERO_MIN_WDTH);
    expect(plan.scale).toBe(0.75);
  });

  it("never shrinks below 0.6 of the designed size", () => {
    const plan = planNumberFit({ natural: 100, atMinWidth: 80, avail: 10, baseWdth: 30 });
    expect(plan.scale).toBe(HERO_MIN_SCALE);
  });

  it("only shrinks a font without a width axis, or one already at the minimum", () => {
    expect(planNumberFit({ natural: 100, atMinWidth: 100, avail: 80, baseWdth: 100 })).toEqual({
      scale: 0.8,
    });
    expect(planNumberFit({ natural: 100, atMinWidth: 100, avail: 80, baseWdth: 25 })).toEqual({
      scale: 0.8,
    });
    expect(planNumberFit({ natural: 100, atMinWidth: 100, avail: 80, baseWdth: NaN })).toEqual({
      scale: 0.8,
    });
  });
});

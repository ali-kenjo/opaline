import { describe, expect, it } from "vitest";
import { chooseInk } from "./backdrop";

const LIGHT_INK = 0.86;
const DARK_INK = 0.012;

describe("legibility 2.0 ink choice", () => {
  it("picks light text on dark, calm glass, without a halo", () => {
    const c = chooseInk(0.03, 0.04, LIGHT_INK, DARK_INK);
    expect(c.ink).toBe("light");
    expect(c.contrast).toBeGreaterThan(7);
    expect(c.halo).toBe(false);
  });

  it("picks dark text on bright glass", () => {
    const c = chooseInk(0.6, 0.7, LIGHT_INK, DARK_INK);
    expect(c.ink).toBe("dark");
  });

  it("judges light text against the brightest detail, and adds a halo on busy glass", () => {
    const calm = chooseInk(0.05, 0.06, LIGHT_INK, DARK_INK);
    const busy = chooseInk(0.05, 0.5, LIGHT_INK, DARK_INK);
    expect(busy.contrast).toBeLessThan(calm.contrast);
    expect(busy.halo).toBe(true);
  });
});

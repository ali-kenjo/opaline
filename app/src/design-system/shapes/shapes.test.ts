import { describe, expect, it } from "vitest";
import {
  Cubic,
  MATERIAL_SHAPES,
  Morph,
  RoundedPolygon,
  circle,
  cubicsToPath,
  materialShape,
  rectangle,
  rounding,
  star,
} from ".";

const close = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) < eps;

describe("cubic", () => {
  it("splits and evaluates", () => {
    const c = Cubic.straightLine(0, 0, 3, 0);
    const [a, b] = c.split(0.5);
    expect(a.anchor1X).toBeCloseTo(1.5);
    expect(b.anchor0X).toBeCloseTo(1.5);
    expect(c.pointOnCurve(1 / 3).x).toBeCloseTo(1);
  });

  it("bounds a quarter circle exactly", () => {
    const arc = Cubic.circularArc(0, 0, 1, 0, 0, 1);
    const [minX, minY, maxX, maxY] = arc.calculateBounds();
    expect(minX).toBeCloseTo(0);
    expect(minY).toBeCloseTo(0);
    expect(maxX).toBeCloseTo(1);
    expect(maxY).toBeCloseTo(1);
    // A cubic approximation of a quarter circle stays within 0.03 % of the radius.
    const mid = arc.pointOnCurve(0.5);
    expect(Math.hypot(mid.x, mid.y)).toBeCloseTo(1, 3);
  });
});

describe("rounded polygons", () => {
  it("a rounded square is closed and keeps its size", () => {
    const sq = rectangle(2, 2, rounding(0.5));
    const [l, t, r, b] = sq.calculateBounds(false);
    expect([l, t, r, b].map((v) => +v.toFixed(3))).toEqual([-1, -1, 1, 1]);
    // Without smoothing the flanking curves are zero-length and dropped: 4 arcs + 4 edges,
    // with the first corner's arc split in two.
    expect(sq.cubics.length).toBe(9);
  });

  it("a circle from 8 rounded vertices stays on the radius", () => {
    const c = circle(8, 1);
    for (const cubic of c.cubics) {
      const p = cubic.pointOnCurve(0.5);
      expect(close(Math.hypot(p.x, p.y), 1, 2e-3)).toBe(true);
    }
  });

  it("stars alternate radii; normalization fits the unit square", () => {
    const s = star(5, 1, 0.5).normalized();
    const [l, t, r, b] = s.calculateBounds();
    expect(Math.min(l, t)).toBeGreaterThanOrEqual(-1e-6);
    expect(Math.max(r, b)).toBeLessThanOrEqual(1 + 1e-6);
    expect(close(Math.max(r - l, b - t), 1)).toBe(true);
  });

  it("rejects too few vertices", () => {
    expect(() => RoundedPolygon.fromVertices([0, 0, 1, 1])).toThrow();
  });
});

describe("Material shapes", () => {
  it("all 35 build and are normalized", () => {
    expect(MATERIAL_SHAPES).toHaveLength(35);
    for (const name of MATERIAL_SHAPES) {
      const s = materialShape(name);
      const [l, t, r, b] = s.calculateBounds();
      expect(close(Math.max(r - l, b - t), 1, 1e-2), name).toBe(true);
      expect(cubicsToPath(s.cubics, 100)).toMatch(/^M[\d.-]+ [\d.-]+C/);
    }
  });

  it("cookie 9 has nine lobes, the burst twelve points", () => {
    expect(materialShape("cookie9Sided").features.filter((f) => f.isConvexCorner)).toHaveLength(9);
    expect(materialShape("burst").features.filter((f) => f.isConvexCorner)).toHaveLength(12);
  });
});

describe("morph", () => {
  it("starts and ends exactly on the two shapes", () => {
    const a = materialShape("softBurst");
    const b = materialShape("cookie9Sided");
    const m = new Morph(a, b);
    const start = m.asCubics(0);
    const end = m.asCubics(1);
    const first = start[0];
    expect(first && close(first.anchor0X, start[start.length - 1]?.anchor1X ?? NaN)).toBe(true);
    // The morph at 0 and 1 traces the same outlines as the two shapes (exact curve bounds).
    const bounds = (cs: readonly Cubic[]) => {
      const all = cs.map((c) => c.calculateBounds(false));
      return [
        Math.min(...all.map((b) => b[0])),
        Math.min(...all.map((b) => b[1])),
        Math.max(...all.map((b) => b[2])),
        Math.max(...all.map((b) => b[3])),
      ].map((v) => +v.toFixed(3));
    };
    expect(bounds(start)).toEqual(bounds(a.cubics));
    expect(bounds(end)).toEqual(bounds(b.cubics));
  });

  it("the whole loading sequence morphs", () => {
    const seq = [
      "softBurst",
      "cookie9Sided",
      "pentagon",
      "pill",
      "sunny",
      "cookie4Sided",
      "oval",
    ] as const;
    for (let i = 0; i < seq.length; i++) {
      const m = new Morph(
        materialShape(seq[i] ?? "oval"),
        materialShape(seq[(i + 1) % seq.length] ?? "oval"),
      );
      expect(m.asCubics(0.5).length).toBeGreaterThan(8);
    }
  });
});

// Ported from androidx graphics-shapes (Cubic.kt), Apache-2.0, © The Android Open Source
// Project. See THIRD_PARTY.md.
import {
  DISTANCE_EPSILON,
  type Point,
  type PointTransformer,
  directionVector,
  distance,
  dot,
  lerp,
  pt,
  rotate90,
  convex as isConvex,
} from "./point";

/** A cubic Bézier: anchor0, control0, control1, anchor1 as 8 numbers. */
export class Cubic {
  readonly points: Float64Array;

  constructor(points: ArrayLike<number> = new Float64Array(8)) {
    if (points.length !== 8) throw new Error("Points array size should be 8");
    this.points = Float64Array.from(points);
  }

  static of(
    a0x: number,
    a0y: number,
    c0x: number,
    c0y: number,
    c1x: number,
    c1y: number,
    a1x: number,
    a1y: number,
  ): Cubic {
    return new Cubic([a0x, a0y, c0x, c0y, c1x, c1y, a1x, a1y]);
  }

  static fromPoints(a0: Point, c0: Point, c1: Point, a1: Point): Cubic {
    return Cubic.of(a0.x, a0.y, c0.x, c0.y, c1.x, c1.y, a1.x, a1.y);
  }

  get anchor0X(): number {
    return this.points[0] ?? 0;
  }
  get anchor0Y(): number {
    return this.points[1] ?? 0;
  }
  get control0X(): number {
    return this.points[2] ?? 0;
  }
  get control0Y(): number {
    return this.points[3] ?? 0;
  }
  get control1X(): number {
    return this.points[4] ?? 0;
  }
  get control1Y(): number {
    return this.points[5] ?? 0;
  }
  get anchor1X(): number {
    return this.points[6] ?? 0;
  }
  get anchor1Y(): number {
    return this.points[7] ?? 0;
  }

  pointOnCurve(t: number): Point {
    const u = 1 - t;
    return pt(
      this.anchor0X * (u * u * u) +
        this.control0X * (3 * t * u * u) +
        this.control1X * (3 * t * t * u) +
        this.anchor1X * (t * t * t),
      this.anchor0Y * (u * u * u) +
        this.control0Y * (3 * t * u * u) +
        this.control1Y * (3 * t * t * u) +
        this.anchor1Y * (t * t * t),
    );
  }

  zeroLength(): boolean {
    return (
      Math.abs(this.anchor0X - this.anchor1X) < DISTANCE_EPSILON &&
      Math.abs(this.anchor0Y - this.anchor1Y) < DISTANCE_EPSILON
    );
  }

  convexTo(next: Cubic): boolean {
    return isConvex(
      pt(this.anchor0X, this.anchor0Y),
      pt(this.anchor1X, this.anchor1Y),
      pt(next.anchor1X, next.anchor1Y),
    );
  }

  /** `[minX, minY, maxX, maxY]`; exact (curve extrema) unless `approximate`. */
  calculateBounds(approximate = false): [number, number, number, number] {
    if (this.zeroLength()) return [this.anchor0X, this.anchor0Y, this.anchor0X, this.anchor0Y];
    let minX = Math.min(this.anchor0X, this.anchor1X);
    let minY = Math.min(this.anchor0Y, this.anchor1Y);
    let maxX = Math.max(this.anchor0X, this.anchor1X);
    let maxY = Math.max(this.anchor0Y, this.anchor1Y);
    if (approximate) {
      return [
        Math.min(minX, this.control0X, this.control1X),
        Math.min(minY, this.control0Y, this.control1Y),
        Math.max(maxX, this.control0X, this.control1X),
        Math.max(maxY, this.control0Y, this.control1Y),
      ];
    }
    const extrema = (p0: number, p1: number, p2: number, p3: number): number[] => {
      const a = -p0 + 3 * p1 - 3 * p2 + p3;
      const b = 2 * p0 - 4 * p1 + 2 * p2;
      const c = -p0 + p1;
      if (Math.abs(a) < DISTANCE_EPSILON) return b !== 0 ? [(2 * c) / (-2 * b)] : [];
      const s = b * b - 4 * a * c;
      if (s < 0) return [];
      return [(-b + Math.sqrt(s)) / (2 * a), (-b - Math.sqrt(s)) / (2 * a)];
    };
    for (const t of extrema(this.anchor0X, this.control0X, this.control1X, this.anchor1X)) {
      if (t >= 0 && t <= 1) {
        const x = this.pointOnCurve(t).x;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    }
    for (const t of extrema(this.anchor0Y, this.control0Y, this.control1Y, this.anchor1Y)) {
      if (t >= 0 && t <= 1) {
        const y = this.pointOnCurve(t).y;
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    return [minX, minY, maxX, maxY];
  }

  split(t: number): [Cubic, Cubic] {
    const u = 1 - t;
    const p = this.pointOnCurve(t);
    return [
      Cubic.of(
        this.anchor0X,
        this.anchor0Y,
        this.anchor0X * u + this.control0X * t,
        this.anchor0Y * u + this.control0Y * t,
        this.anchor0X * (u * u) + this.control0X * (2 * u * t) + this.control1X * (t * t),
        this.anchor0Y * (u * u) + this.control0Y * (2 * u * t) + this.control1Y * (t * t),
        p.x,
        p.y,
      ),
      Cubic.of(
        p.x,
        p.y,
        this.control0X * (u * u) + this.control1X * (2 * u * t) + this.anchor1X * (t * t),
        this.control0Y * (u * u) + this.control1Y * (2 * u * t) + this.anchor1Y * (t * t),
        this.control1X * u + this.anchor1X * t,
        this.control1Y * u + this.anchor1Y * t,
        this.anchor1X,
        this.anchor1Y,
      ),
    ];
  }

  reverse(): Cubic {
    return Cubic.of(
      this.anchor1X,
      this.anchor1Y,
      this.control1X,
      this.control1Y,
      this.control0X,
      this.control0Y,
      this.anchor0X,
      this.anchor0Y,
    );
  }

  plus(o: Cubic): Cubic {
    return new Cubic(this.points.map((v, i) => v + (o.points[i] ?? 0)));
  }

  times(k: number): Cubic {
    return new Cubic(this.points.map((v) => v * k));
  }

  transformed(f: PointTransformer): Cubic {
    const p = Array.from(this.points);
    for (let i = 0; i < 8; i += 2) {
      const [x, y] = f(p[i] ?? 0, p[i + 1] ?? 0);
      p[i] = x;
      p[i + 1] = y;
    }
    return new Cubic(p);
  }

  static interpolate(a: Cubic, b: Cubic, t: number): Cubic {
    return new Cubic(a.points.map((v, i) => lerp(v, b.points[i] ?? 0, t)));
  }

  static straightLine(x0: number, y0: number, x1: number, y1: number): Cubic {
    return Cubic.of(
      x0,
      y0,
      lerp(x0, x1, 1 / 3),
      lerp(y0, y1, 1 / 3),
      lerp(x0, x1, 2 / 3),
      lerp(y0, y1, 2 / 3),
      x1,
      y1,
    );
  }

  static circularArc(
    cx: number,
    cy: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): Cubic {
    const p0d = directionVector(x0 - cx, y0 - cy);
    const p1d = directionVector(x1 - cx, y1 - cy);
    const r0 = rotate90(p0d);
    const r1 = rotate90(p1d);
    const isClockwise = dot(r0, pt(x1 - cx, y1 - cy)) >= 0;
    const cosa = dot(p0d, p1d);
    if (cosa > 0.999) return Cubic.straightLine(x0, y0, x1, y1);
    const k =
      ((((distance(x0 - cx, y0 - cy) * 4) / 3) *
        (Math.sqrt(2 * (1 - cosa)) - Math.sqrt(1 - cosa * cosa))) /
        (1 - cosa)) *
      (isClockwise ? 1 : -1);
    return Cubic.of(x0, y0, x0 + r0.x * k, y0 + r0.y * k, x1 - r1.x * k, y1 - r1.y * k, x1, y1);
  }

  static empty(x0: number, y0: number): Cubic {
    return Cubic.of(x0, y0, x0, y0, x0, y0, x0, y0);
  }
}

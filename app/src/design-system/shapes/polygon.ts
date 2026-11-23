// Ported from androidx graphics-shapes (RoundedPolygon.kt, CornerRounding.kt), Apache-2.0,
// © The Android Open Source Project. See THIRD_PARTY.md.
import { Cubic } from "./cubic";
import { Feature } from "./features";
import {
  DISTANCE_EPSILON,
  type Point,
  type PointTransformer,
  add,
  convex,
  direction,
  directionVector,
  distance,
  distanceSquared,
  div,
  dot,
  length,
  lerpPoint,
  mul,
  pt,
  radialToCartesian,
  rotate90,
  square,
  sub,
} from "./point";

/** How a corner is rounded: radius, and smoothing (0 = circular, 1 = fully smoothed). */
export interface CornerRounding {
  readonly radius: number;
  readonly smoothing: number;
}

export const unrounded: CornerRounding = { radius: 0, smoothing: 0 };
export const rounding = (radius: number, smoothing = 0): CornerRounding => ({ radius, smoothing });

export class RoundedPolygon {
  readonly cubics: readonly Cubic[];

  constructor(
    readonly features: readonly Feature[],
    readonly center: Point,
  ) {
    this.cubics = buildCubics(features, center);
    let prev = this.cubics[this.cubics.length - 1];
    for (const c of this.cubics) {
      if (
        prev &&
        (Math.abs(c.anchor0X - prev.anchor1X) > DISTANCE_EPSILON ||
          Math.abs(c.anchor0Y - prev.anchor1Y) > DISTANCE_EPSILON)
      ) {
        throw new Error("RoundedPolygon must be contiguous");
      }
      prev = c;
    }
  }

  get centerX(): number {
    return this.center.x;
  }
  get centerY(): number {
    return this.center.y;
  }

  transformed(f: PointTransformer): RoundedPolygon {
    const [cx, cy] = f(this.center.x, this.center.y);
    return new RoundedPolygon(
      this.features.map((ft) => ft.transformed(f)),
      pt(cx, cy),
    );
  }

  /** Scaled and moved into the unit square [0, 1] × [0, 1], keeping its aspect ratio. */
  normalized(): RoundedPolygon {
    const [l, t, r, b] = this.calculateBounds();
    const w = r - l;
    const h = b - t;
    const side = Math.max(w, h);
    const ox = (side - w) / 2 - l;
    const oy = (side - h) / 2 - t;
    return this.transformed((x, y) => [(x + ox) / side, (y + oy) / side]);
  }

  calculateBounds(approximate = true): [number, number, number, number] {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of this.cubics) {
      const [a, b, cc, d] = c.calculateBounds(approximate);
      minX = Math.min(minX, a);
      minY = Math.min(minY, b);
      maxX = Math.max(maxX, cc);
      maxY = Math.max(maxY, d);
    }
    return [minX, minY, maxX, maxY];
  }

  /** A square around the center that contains the shape at any rotation. */
  calculateMaxBounds(): [number, number, number, number] {
    let max = 0;
    for (const c of this.cubics) {
      const mid = c.pointOnCurve(0.5);
      max = Math.max(
        max,
        distanceSquared(c.anchor0X - this.centerX, c.anchor0Y - this.centerY),
        distanceSquared(mid.x - this.centerX, mid.y - this.centerY),
      );
    }
    const d = Math.sqrt(max);
    return [this.centerX - d, this.centerY - d, this.centerX + d, this.centerY + d];
  }

  /** An SVG path in the polygon's own coordinates. */
  toSvgPath(): string {
    const [first] = this.cubics;
    if (!first) return "";
    const f = (n: number) => +n.toFixed(4);
    let d = `M${f(first.anchor0X)} ${f(first.anchor0Y)}`;
    for (const c of this.cubics) {
      d += `C${f(c.control0X)} ${f(c.control0Y)} ${f(c.control1X)} ${f(c.control1Y)} ${f(c.anchor1X)} ${f(c.anchor1Y)}`;
    }
    return `${d}Z`;
  }

  /** A regular polygon with `numVertices` corners on a circle. */
  static regular(
    numVertices: number,
    radius = 1,
    centerX = 0,
    centerY = 0,
    round: CornerRounding = unrounded,
    perVertex?: readonly CornerRounding[],
  ): RoundedPolygon {
    return RoundedPolygon.fromVertices(
      verticesFromNumVerts(numVertices, radius, centerX, centerY),
      round,
      perVertex,
      centerX,
      centerY,
    );
  }

  /** A polygon through `vertices` (x0, y0, x1, y1, …) with rounded corners. */
  static fromVertices(
    vertices: readonly number[],
    round: CornerRounding = unrounded,
    perVertex?: readonly CornerRounding[],
    centerX?: number,
    centerY?: number,
  ): RoundedPolygon {
    if (vertices.length < 6) throw new Error("Polygons must have at least 3 vertices");
    if (vertices.length % 2 === 1) throw new Error("The vertices array should have even size");
    if (perVertex && perVertex.length * 2 !== vertices.length) {
      throw new Error("perVertexRounding must match the number of vertices");
    }
    const n = vertices.length / 2;
    const v = (i: number): Point => pt(vertices[i * 2] ?? 0, vertices[i * 2 + 1] ?? 0);
    const corners: RoundedCorner[] = [];
    for (let i = 0; i < n; i++) {
      corners.push(
        new RoundedCorner(v((i + n - 1) % n), v(i), v((i + 1) % n), perVertex?.[i] ?? round),
      );
    }
    const cutAdjusts: [number, number][] = [];
    for (let ix = 0; ix < n; ix++) {
      const a = corners[ix];
      const b = corners[(ix + 1) % n];
      if (!a || !b) continue;
      const expectedRoundCut = a.expectedRoundCut + b.expectedRoundCut;
      const expectedCut = a.expectedCut + b.expectedCut;
      const side = length(sub(v(ix), v((ix + 1) % n)));
      if (expectedRoundCut > side) cutAdjusts.push([side / expectedRoundCut, 0]);
      else if (expectedCut > side)
        cutAdjusts.push([1, (side - expectedRoundCut) / (expectedCut - expectedRoundCut)]);
      else cutAdjusts.push([1, 1]);
    }
    const cornerCubics: Cubic[][] = [];
    for (let i = 0; i < n; i++) {
      const c = corners[i];
      if (!c) continue;
      const allowed = [0, 1].map((delta) => {
        const [roundCutRatio, cutRatio] = cutAdjusts[(i + n - 1 + delta) % n] ?? [1, 1];
        return c.expectedRoundCut * roundCutRatio + (c.expectedCut - c.expectedRoundCut) * cutRatio;
      });
      cornerCubics.push(c.getCubics(allowed[0] ?? 0, allowed[1] ?? 0));
    }
    const features: Feature[] = [];
    for (let i = 0; i < n; i++) {
      const cur = cornerCubics[i] ?? [];
      const next = cornerCubics[(i + 1) % n] ?? [];
      const isConvex = convex(v((i + n - 1) % n), v(i), v((i + 1) % n));
      features.push(Feature.corner(cur, isConvex));
      const last = cur[cur.length - 1];
      const first = next[0];
      if (last && first) {
        features.push(
          Feature.edge([
            Cubic.straightLine(last.anchor1X, last.anchor1Y, first.anchor0X, first.anchor0Y),
          ]),
        );
      }
    }
    const center =
      centerX === undefined || centerY === undefined
        ? calculateCenter(vertices)
        : pt(centerX, centerY);
    return new RoundedPolygon(features, center);
  }

  static fromFeatures(
    features: readonly Feature[],
    centerX?: number,
    centerY?: number,
  ): RoundedPolygon {
    if (features.length < 2) throw new Error("Polygons must have at least 2 features");
    const vertices: number[] = [];
    for (const f of features) for (const c of f.cubics) vertices.push(c.anchor0X, c.anchor0Y);
    const c = calculateCenter(vertices);
    return new RoundedPolygon(features, pt(centerX ?? c.x, centerY ?? c.y));
  }
}

function buildCubics(features: readonly Feature[], center: Point): Cubic[] {
  const out: Cubic[] = [];
  let firstCubic: Cubic | undefined;
  let lastCubic: Cubic | undefined;
  let splitStart: Cubic[] | undefined;
  let splitEnd: Cubic[] | undefined;
  const f0 = features[0];
  if (f0?.cubics.length === 3) {
    const [c0, c1, c2] = f0.cubics;
    if (c0 && c1 && c2) {
      const [start, end] = c1.split(0.5);
      splitStart = [c0, start];
      splitEnd = [end, c2];
    }
  }
  for (let i = 0; i <= features.length; i++) {
    let featureCubics: readonly Cubic[];
    if (i === 0 && splitEnd) featureCubics = splitEnd;
    else if (i === features.length) {
      if (splitStart) featureCubics = splitStart;
      else break;
    } else featureCubics = features[i]?.cubics ?? [];
    for (const cubic of featureCubics) {
      if (!cubic.zeroLength()) {
        if (lastCubic) out.push(lastCubic);
        lastCubic = cubic;
        firstCubic ??= cubic;
      } else if (lastCubic) {
        const p = Array.from(lastCubic.points);
        p[6] = cubic.anchor1X;
        p[7] = cubic.anchor1Y;
        lastCubic = new Cubic(p);
      }
    }
  }
  if (lastCubic && firstCubic) {
    out.push(
      Cubic.of(
        lastCubic.anchor0X,
        lastCubic.anchor0Y,
        lastCubic.control0X,
        lastCubic.control0Y,
        lastCubic.control1X,
        lastCubic.control1Y,
        firstCubic.anchor0X,
        firstCubic.anchor0Y,
      ),
    );
  } else {
    out.push(Cubic.empty(center.x, center.y));
  }
  return out;
}

export function calculateCenter(vertices: readonly number[]): Point {
  let x = 0;
  let y = 0;
  for (let i = 0; i < vertices.length; i += 2) {
    x += vertices[i] ?? 0;
    y += vertices[i + 1] ?? 0;
  }
  const n = vertices.length / 2;
  return pt(x / n, y / n);
}

function verticesFromNumVerts(n: number, radius: number, cx: number, cy: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = add(radialToCartesian(radius, (Math.PI / n) * 2 * i), pt(cx, cy));
    out.push(p.x, p.y);
  }
  return out;
}

class RoundedCorner {
  readonly d1: Point;
  readonly d2: Point;
  readonly cornerRadius: number;
  readonly smoothing: number;
  readonly cosAngle: number;
  readonly sinAngle: number;
  readonly expectedRoundCut: number;

  constructor(
    readonly p0: Point,
    readonly p1: Point,
    readonly p2: Point,
    r: CornerRounding,
  ) {
    const v01 = sub(p0, p1);
    const v21 = sub(p2, p1);
    const d01 = length(v01);
    const d21 = length(v21);
    if (d01 > 0 && d21 > 0) {
      this.d1 = div(v01, d01);
      this.d2 = div(v21, d21);
      this.cornerRadius = r.radius;
      this.smoothing = r.smoothing;
      this.cosAngle = dot(this.d1, this.d2);
      this.sinAngle = Math.sqrt(1 - square(this.cosAngle));
      this.expectedRoundCut =
        this.sinAngle > 1e-3 ? (this.cornerRadius * (this.cosAngle + 1)) / this.sinAngle : 0;
    } else {
      this.d1 = pt(0, 0);
      this.d2 = pt(0, 0);
      this.cornerRadius = 0;
      this.smoothing = 0;
      this.cosAngle = 0;
      this.sinAngle = 0;
      this.expectedRoundCut = 0;
    }
  }

  get expectedCut(): number {
    return (1 + this.smoothing) * this.expectedRoundCut;
  }

  getCubics(allowedCut0: number, allowedCut1 = allowedCut0): Cubic[] {
    const allowedCut = Math.min(allowedCut0, allowedCut1);
    if (
      this.expectedRoundCut < DISTANCE_EPSILON ||
      allowedCut < DISTANCE_EPSILON ||
      this.cornerRadius < DISTANCE_EPSILON
    ) {
      return [Cubic.straightLine(this.p1.x, this.p1.y, this.p1.x, this.p1.y)];
    }
    const actualRoundCut = Math.min(allowedCut, this.expectedRoundCut);
    const s0 = this.actualSmoothing(allowedCut0);
    const s1 = this.actualSmoothing(allowedCut1);
    const actualR = (this.cornerRadius * actualRoundCut) / this.expectedRoundCut;
    const centerDistance = Math.sqrt(square(actualR) + square(actualRoundCut));
    const center = add(this.p1, mul(direction(div(add(this.d1, this.d2), 2)), centerDistance));
    const ci0 = add(this.p1, mul(this.d1, actualRoundCut));
    const ci2 = add(this.p1, mul(this.d2, actualRoundCut));
    const flanking0 = flankingCurve(
      actualRoundCut,
      s0,
      this.p1,
      this.p0,
      ci0,
      ci2,
      center,
      actualR,
    );
    const flanking2 = flankingCurve(
      actualRoundCut,
      s1,
      this.p1,
      this.p2,
      ci2,
      ci0,
      center,
      actualR,
    ).reverse();
    return [
      flanking0,
      Cubic.circularArc(
        center.x,
        center.y,
        flanking0.anchor1X,
        flanking0.anchor1Y,
        flanking2.anchor0X,
        flanking2.anchor0Y,
      ),
      flanking2,
    ];
  }

  private actualSmoothing(allowedCut: number): number {
    if (allowedCut > this.expectedCut) return this.smoothing;
    if (allowedCut > this.expectedRoundCut) {
      return (
        (this.smoothing * (allowedCut - this.expectedRoundCut)) /
        (this.expectedCut - this.expectedRoundCut)
      );
    }
    return 0;
  }
}

function flankingCurve(
  actualRoundCut: number,
  smoothing: number,
  corner: Point,
  sideStart: Point,
  circleIntersection: Point,
  otherCircleIntersection: Point,
  circleCenter: Point,
  actualR: number,
): Cubic {
  const sideDirection = direction(sub(sideStart, corner));
  const curveStart = add(corner, mul(sideDirection, actualRoundCut * (1 + smoothing)));
  const p = lerpPoint(
    circleIntersection,
    div(add(circleIntersection, otherCircleIntersection), 2),
    smoothing,
  );
  const curveEnd = add(
    circleCenter,
    mul(directionVector(p.x - circleCenter.x, p.y - circleCenter.y), actualR),
  );
  const tangent = rotate90(sub(curveEnd, circleCenter));
  const anchorEnd =
    lineIntersection(sideStart, sideDirection, curveEnd, tangent) ?? circleIntersection;
  const anchorStart = div(add(curveStart, mul(anchorEnd, 2)), 3);
  return Cubic.fromPoints(curveStart, anchorStart, anchorEnd, curveEnd);
}

function lineIntersection(p0: Point, d0: Point, p1: Point, d1: Point): Point | undefined {
  const r = rotate90(d1);
  const den = dot(d0, r);
  if (Math.abs(den) < DISTANCE_EPSILON) return undefined;
  const num = dot(sub(p1, p0), r);
  if (Math.abs(den) < DISTANCE_EPSILON * Math.abs(num)) return undefined;
  return add(p0, mul(d0, num / den));
}

export { distance };

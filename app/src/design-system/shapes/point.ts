// Ported from androidx graphics-shapes (Point.kt, Utils.kt), Apache-2.0, © The Android Open
// Source Project. See THIRD_PARTY.md.

export interface Point {
  readonly x: number;
  readonly y: number;
}

export const pt = (x: number, y: number): Point => ({ x, y });
export const ZERO: Point = pt(0, 0);

export const DISTANCE_EPSILON = 1e-4;
export const ANGLE_EPSILON = 1e-6;
export const RELAXED_DISTANCE_EPSILON = 5e-3;
export const TWO_PI = 2 * Math.PI;

export const add = (a: Point, b: Point): Point => pt(a.x + b.x, a.y + b.y);
export const sub = (a: Point, b: Point): Point => pt(a.x - b.x, a.y - b.y);
export const mul = (a: Point, k: number): Point => pt(a.x * k, a.y * k);
export const div = (a: Point, k: number): Point => pt(a.x / k, a.y / k);
export const neg = (a: Point): Point => pt(-a.x, -a.y);
export const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
export const length = (a: Point): number => Math.hypot(a.x, a.y);
export const lengthSquared = (a: Point): number => a.x * a.x + a.y * a.y;
export const rotate90 = (a: Point): Point => pt(-a.y, a.x);
/** True if `b` is clockwise of `a` (in a y-down screen space). */
export const clockwise = (a: Point, b: Point): boolean => a.x * b.y - a.y * b.x > 0;

export function direction(a: Point): Point {
  const d = length(a);
  if (!(d > 0)) throw new Error("Can't get the direction of a 0-length vector");
  return div(a, d);
}

export const distance = (x: number, y: number): number => Math.sqrt(x * x + y * y);
export const distanceSquared = (x: number, y: number): number => x * x + y * y;

export function directionVector(x: number, y: number): Point {
  const d = distance(x, y);
  if (!(d > 0)) throw new Error("Required distance greater than zero");
  return pt(x / d, y / d);
}

export const directionFromAngle = (radians: number): Point =>
  pt(Math.cos(radians), Math.sin(radians));

export const radialToCartesian = (radius: number, radians: number, center: Point = ZERO): Point =>
  add(mul(directionFromAngle(radians), radius), center);

export const lerp = (a: number, b: number, t: number): number => (1 - t) * a + t * b;
export const lerpPoint = (a: Point, b: Point, t: number): Point =>
  pt(lerp(a.x, b.x, t), lerp(a.y, b.y, t));
export const square = (x: number): number => x * x;
export const positiveModulo = (n: number, m: number): number => ((n % m) + m) % m;

export function collinearIsh(
  aX: number,
  aY: number,
  bX: number,
  bY: number,
  cX: number,
  cY: number,
  tolerance = DISTANCE_EPSILON,
): boolean {
  const ab = rotate90(pt(bX - aX, bY - aY));
  const ac = pt(cX - aX, cY - aY);
  const d = Math.abs(dot(ab, ac));
  return d < tolerance || d < tolerance * length(ab) * length(ac);
}

export const convex = (previous: Point, current: Point, next: Point): boolean =>
  clockwise(sub(current, previous), sub(next, current));

/** Ternary search for the minimum of a unimodal `f` on [v0, v1]. */
export function findMinimum(
  v0: number,
  v1: number,
  f: (v: number) => number,
  tolerance = 1e-3,
): number {
  let a = v0;
  let b = v1;
  while (b - a > tolerance) {
    const c1 = (2 * a + b) / 3;
    const c2 = (2 * b + a) / 3;
    if (f(c1) < f(c2)) b = c2;
    else a = c1;
  }
  return (a + b) / 2;
}

export type PointTransformer = (x: number, y: number) => readonly [number, number];

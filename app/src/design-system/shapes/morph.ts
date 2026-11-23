// Ported from androidx graphics-shapes (Morph.kt, PolygonMeasure.kt, FeatureMapping.kt,
// FloatMapping.kt), Apache-2.0, © The Android Open Source Project. See THIRD_PARTY.md.
import { Cubic } from "./cubic";
import type { Feature } from "./features";
import type { RoundedPolygon } from "./polygon";
import { ANGLE_EPSILON, DISTANCE_EPSILON, length, lerp, positiveModulo, pt, sub } from "./point";

// ---- FloatMapping ---------------------------------------------------------------------------

function progressInRange(p: number, from: number, to: number): boolean {
  return to >= from ? p >= from && p <= to : p >= from || p <= to;
}

function linearMap(xs: readonly number[], ys: readonly number[], x: number): number {
  if (!(x >= 0 && x <= 1)) throw new Error(`Invalid progress: ${x}`);
  const n = xs.length;
  const start = xs.findIndex((_, i) => progressInRange(x, xs[i] ?? 0, xs[(i + 1) % n] ?? 0));
  const end = (start + 1) % n;
  const x0 = xs[start] ?? 0;
  const y0 = ys[start] ?? 0;
  const sizeX = positiveModulo((xs[end] ?? 0) - x0, 1);
  const sizeY = positiveModulo((ys[end] ?? 0) - y0, 1);
  const pos = sizeX < 0.001 ? 0.5 : positiveModulo(x - x0, 1) / sizeX;
  return positiveModulo(y0 + sizeY * pos, 1);
}

const progressDistance = (a: number, b: number): number => {
  const d = Math.abs(a - b);
  return Math.min(d, 1 - d);
};

function validateProgress(p: readonly number[]): void {
  let prev = p[p.length - 1] ?? 0;
  let wraps = 0;
  for (const curr of p) {
    if (!(curr >= 0 && curr < 1)) throw new Error("FloatMapping - Progress outside of range");
    if (!(progressDistance(curr, prev) > DISTANCE_EPSILON))
      throw new Error("FloatMapping - Progress repeats a value");
    if (curr < prev && ++wraps > 1) throw new Error("FloatMapping - Progress wraps more than once");
    prev = curr;
  }
}

class DoubleMapper {
  private readonly src: number[];
  private readonly dst: number[];

  constructor(mappings: readonly (readonly [number, number])[]) {
    this.src = mappings.map((m) => m[0]);
    this.dst = mappings.map((m) => m[1]);
    validateProgress(this.src);
    validateProgress(this.dst);
  }

  map(x: number): number {
    return linearMap(this.src, this.dst, x);
  }

  mapBack(x: number): number {
    return linearMap(this.dst, this.src, x);
  }
}

// ---- FeatureMapping -------------------------------------------------------------------------

interface ProgressableFeature {
  readonly progress: number;
  readonly feature: Feature;
}

const IDENTITY: [number, number][] = [
  [0, 0],
  [0.5, 0.5],
];

function representativePoint(f: Feature) {
  const first = f.cubics[0];
  const last = f.cubics[f.cubics.length - 1];
  if (!first || !last) return pt(0, 0);
  return pt((first.anchor0X + last.anchor1X) / 2, (first.anchor0Y + last.anchor1Y) / 2);
}

function featureDistSquared(f1: Feature, f2: Feature): number {
  if (f1.kind === "corner" && f2.kind === "corner" && f1.convex !== f2.convex)
    return Number.MAX_VALUE;
  const d = sub(representativePoint(f1), representativePoint(f2));
  return d.x * d.x + d.y * d.y;
}

function doMapping(
  features1: readonly ProgressableFeature[],
  features2: readonly ProgressableFeature[],
): [number, number][] {
  const vertices: { d: number; f1: ProgressableFeature; f2: ProgressableFeature }[] = [];
  for (const f1 of features1) {
    for (const f2 of features2) {
      const d = featureDistSquared(f1.feature, f2.feature);
      if (d !== Number.MAX_VALUE) vertices.push({ d, f1, f2 });
    }
  }
  vertices.sort((a, b) => a.d - b.d);
  const [only] = vertices;
  if (!only) return IDENTITY;
  if (vertices.length === 1) {
    const a = only.f1.progress;
    const b = only.f2.progress;
    return [
      [a, b],
      [(a + 0.5) % 1, (b + 0.5) % 1],
    ];
  }
  const mapping: [number, number][] = [];
  const used1 = new Set<ProgressableFeature>();
  const used2 = new Set<ProgressableFeature>();
  for (const { f1, f2 } of vertices) {
    if (used1.has(f1) || used2.has(f2)) continue;
    let insertion = mapping.findIndex((m) => m[0] > f1.progress);
    if (insertion < 0) insertion = mapping.length;
    if (mapping.some((m) => m[0] === f1.progress))
      throw new Error("There can't be two features with the same progress");
    const n = mapping.length;
    if (n >= 1) {
      const before = mapping[(insertion + n - 1) % n] ?? [0, 0];
      const after = mapping[insertion % n] ?? [0, 0];
      if (
        progressDistance(f1.progress, before[0]) < DISTANCE_EPSILON ||
        progressDistance(f1.progress, after[0]) < DISTANCE_EPSILON ||
        progressDistance(f2.progress, before[1]) < DISTANCE_EPSILON ||
        progressDistance(f2.progress, after[1]) < DISTANCE_EPSILON
      ) {
        continue;
      }
      if (n > 1 && !progressInRange(f2.progress, before[1], after[1])) continue;
    }
    mapping.splice(insertion, 0, [f1.progress, f2.progress]);
    used1.add(f1);
    used2.add(f2);
  }
  return mapping;
}

function featureMapper(
  f1: readonly ProgressableFeature[],
  f2: readonly ProgressableFeature[],
): DoubleMapper {
  return new DoubleMapper(
    doMapping(
      f1.filter((f) => f.feature.kind === "corner"),
      f2.filter((f) => f.feature.kind === "corner"),
    ),
  );
}

// ---- PolygonMeasure -------------------------------------------------------------------------

const SEGMENTS = 3;

/** Approximate arc length (3 chords), or the parameter where `threshold` length is reached. */
function closestProgressTo(c: Cubic, threshold: number): [number, number] {
  let total = 0;
  let remainder = threshold;
  let prev = pt(c.anchor0X, c.anchor0Y);
  for (let i = 1; i <= SEGMENTS; i++) {
    const progress = i / SEGMENTS;
    const point = c.pointOnCurve(progress);
    const segment = length(sub(point, prev));
    if (segment >= remainder) return [progress - (1 - remainder / segment) / SEGMENTS, threshold];
    remainder -= segment;
    total += segment;
    prev = point;
  }
  return [1, total];
}

const measureCubic = (c: Cubic): number => closestProgressTo(c, Infinity)[1];
const findCubicCutPoint = (c: Cubic, m: number): number => closestProgressTo(c, m)[0];

class MeasuredCubic {
  readonly size: number;

  constructor(
    readonly cubic: Cubic,
    public start: number,
    public end: number,
  ) {
    if (end < start) throw new Error("endOutlineProgress < startOutlineProgress");
    this.size = measureCubic(cubic);
  }

  cutAtProgress(cut: number): [MeasuredCubic, MeasuredCubic] {
    const bounded = Math.min(this.end, Math.max(this.start, cut));
    const relative = (bounded - this.start) / (this.end - this.start);
    const t = findCubicCutPoint(this.cubic, relative * this.size);
    const [c1, c2] = this.cubic.split(t);
    return [new MeasuredCubic(c1, this.start, bounded), new MeasuredCubic(c2, bounded, this.end)];
  }
}

class MeasuredPolygon {
  readonly cubics: MeasuredCubic[];

  constructor(
    readonly features: readonly ProgressableFeature[],
    cubics: readonly Cubic[],
    outline: readonly number[],
  ) {
    const measured: MeasuredCubic[] = [];
    let start = 0;
    cubics.forEach((c, i) => {
      const next = outline[i + 1] ?? 1;
      if (next - (outline[i] ?? 0) > DISTANCE_EPSILON) {
        measured.push(new MeasuredCubic(c, start, next));
        start = next;
      }
    });
    const last = measured[measured.length - 1];
    if (last) last.end = 1;
    this.cubics = measured;
  }

  static measure(polygon: RoundedPolygon): MeasuredPolygon {
    const cubics: Cubic[] = [];
    const featureToCubic: [Feature, number][] = [];
    for (const feature of polygon.features) {
      feature.cubics.forEach((c, ci) => {
        if (feature.kind === "corner" && ci === Math.floor(feature.cubics.length / 2))
          featureToCubic.push([feature, cubics.length]);
        cubics.push(c);
      });
    }
    const measures = [0];
    for (const c of cubics) measures.push((measures[measures.length - 1] ?? 0) + measureCubic(c));
    const total = measures[measures.length - 1] ?? 1;
    const outline = measures.map((m) => m / total);
    const features = featureToCubic.map(([f, ix]) => ({
      progress: positiveModulo(((outline[ix] ?? 0) + (outline[ix + 1] ?? 0)) / 2, 1),
      feature: f,
    }));
    return new MeasuredPolygon(features, cubics, outline);
  }

  cutAndShift(cut: number): MeasuredPolygon {
    if (cut < DISTANCE_EPSILON) return this;
    const targetIndex = this.cubics.findIndex((c) => cut >= c.start && cut <= c.end);
    const target = this.cubics[targetIndex];
    if (!target) return this;
    const [b1, b2] = target.cutAtProgress(cut);
    const n = this.cubics.length;
    const cubics = [b2.cubic];
    for (let i = 1; i < n; i++) {
      const c = this.cubics[(i + targetIndex) % n];
      if (c) cubics.push(c.cubic);
    }
    cubics.push(b1.cubic);
    const outline: number[] = [];
    for (let index = 0; index < n + 2; index++) {
      if (index === 0) outline.push(0);
      else if (index === n + 1) outline.push(1);
      else
        outline.push(
          positiveModulo((this.cubics[(targetIndex + index - 1) % n]?.end ?? 0) - cut, 1),
        );
    }
    const features = this.features.map((f) => ({
      progress: positiveModulo(f.progress - cut, 1),
      feature: f.feature,
    }));
    return new MeasuredPolygon(features, cubics, outline);
  }
}

// ---- Morph ----------------------------------------------------------------------------------

/** Morphs between two polygons by matching their features and cubics once. */
export class Morph {
  readonly pairs: readonly (readonly [Cubic, Cubic])[];

  constructor(
    readonly start: RoundedPolygon,
    readonly end: RoundedPolygon,
  ) {
    this.pairs = match(start, end);
  }

  /** The shape at `progress` (0 = start, 1 = end); overshoot from springs is fine. */
  asCubics(progress: number): Cubic[] {
    const out: Cubic[] = [];
    let first: Cubic | undefined;
    let last: Cubic | undefined;
    for (const [a, b] of this.pairs) {
      const c = new Cubic(a.points.map((v, i) => lerp(v, b.points[i] ?? 0, progress)));
      first ??= c;
      if (last) out.push(last);
      last = c;
    }
    if (last && first) {
      out.push(
        Cubic.of(
          last.anchor0X,
          last.anchor0Y,
          last.control0X,
          last.control0Y,
          last.control1X,
          last.control1Y,
          first.anchor0X,
          first.anchor0Y,
        ),
      );
    }
    return out;
  }
}

function match(p1: RoundedPolygon, p2: RoundedPolygon): [Cubic, Cubic][] {
  const m1 = MeasuredPolygon.measure(p1);
  const m2 = MeasuredPolygon.measure(p2);
  const mapper = featureMapper(m1.features, m2.features);
  const cut = mapper.map(0);
  const bs1 = m1.cubics;
  const bs2 = m2.cutAndShift(cut).cubics;
  const ret: [Cubic, Cubic][] = [];
  let i1 = 0;
  let i2 = 0;
  let b1 = bs1[i1++];
  let b2 = bs2[i2++];
  while (b1 && b2) {
    const b1a = i1 === bs1.length ? 1 : b1.end;
    const b2a = i2 === bs2.length ? 1 : mapper.mapBack(positiveModulo(b2.end + cut, 1));
    const minb = Math.min(b1a, b2a);
    let seg1: MeasuredCubic;
    let seg2: MeasuredCubic;
    let next1: MeasuredCubic | undefined;
    let next2: MeasuredCubic | undefined;
    if (b1a > minb + ANGLE_EPSILON) [seg1, next1] = b1.cutAtProgress(minb);
    else {
      seg1 = b1;
      next1 = bs1[i1++];
    }
    if (b2a > minb + ANGLE_EPSILON)
      [seg2, next2] = b2.cutAtProgress(positiveModulo(mapper.map(minb) - cut, 1));
    else {
      seg2 = b2;
      next2 = bs2[i2++];
    }
    ret.push([seg1.cubic, seg2.cubic]);
    b1 = next1;
    b2 = next2;
  }
  if (b1 || b2) throw new Error("Expected both Polygon's Cubic to be fully matched");
  return ret;
}

/** An SVG path for a list of cubics, scaled by `size`. */
export function cubicsToPath(cubics: readonly Cubic[], size = 1): string {
  const [first] = cubics;
  if (!first) return "";
  const f = (n: number) => +(n * size).toFixed(3);
  let d = `M${f(first.anchor0X)} ${f(first.anchor0Y)}`;
  for (const c of cubics)
    d += `C${f(c.control0X)} ${f(c.control0Y)} ${f(c.control1X)} ${f(c.control1Y)} ${f(c.anchor1X)} ${f(c.anchor1Y)}`;
  return `${d}Z`;
}

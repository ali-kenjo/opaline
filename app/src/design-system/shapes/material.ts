// Ported from androidx compose material3 (MaterialShapes.kt), Apache-2.0, © The Android Open
// Source Project. See THIRD_PARTY.md. All shapes are normalized into [0, 1] × [0, 1].
import { circle as circleShape, rectangle, star } from "./builders";
import { type CornerRounding, RoundedPolygon, rounding as r, unrounded } from "./polygon";
import { type PointTransformer, pt } from "./point";

const r15 = r(0.15);
const r20 = r(0.2);
const r30 = r(0.3);
const r50 = r(0.5);
const r100 = r(1);

/** Rotation by `degrees` around the origin (Compose's `Matrix.rotateZ`). */
const rotate =
  (degrees: number): PointTransformer =>
  (x, y) => {
    const a = (degrees * Math.PI) / 180;
    return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
  };
const scale =
  (sx: number, sy: number): PointTransformer =>
  (x, y) => [x * sx, y * sy];

interface PNR {
  x: number;
  y: number;
  r?: CornerRounding;
}

const p = (x: number, y: number, rr?: CornerRounding): PNR => (rr ? { x, y, r: rr } : { x, y });

function repeatPoints(
  points: readonly PNR[],
  reps: number,
  cx: number,
  cy: number,
  mirroring: boolean,
): PNR[] {
  const out: PNR[] = [];
  if (mirroring) {
    const angles = points.map((q) => (Math.atan2(q.y - cy, q.x - cx) * 180) / Math.PI);
    const dists = points.map((q) => Math.hypot(q.x - cx, q.y - cy));
    const actual = reps * 2;
    const section = 360 / actual;
    const a0 = angles[0] ?? 0;
    for (let it = 0; it < actual; it++) {
      for (let index = 0; index < points.length; index++) {
        const i = it % 2 === 0 ? index : points.length - 1 - index;
        if (i > 0 || it % 2 === 0) {
          const ai = angles[i] ?? 0;
          const deg = section * it + (it % 2 === 0 ? ai : section - ai + 2 * a0);
          const a = (deg * Math.PI) / 180;
          const d = dists[i] ?? 0;
          const src = points[i];
          out.push({
            x: Math.cos(a) * d + cx,
            y: Math.sin(a) * d + cy,
            ...(src?.r ? { r: src.r } : {}),
          });
        }
      }
    }
  } else {
    const np = points.length;
    for (let it = 0; it < np * reps; it++) {
      const src = points[it % np];
      if (!src) continue;
      const a = ((Math.floor(it / np) * 360) / reps) * (Math.PI / 180);
      const ox = src.x - cx;
      const oy = src.y - cy;
      out.push({
        x: ox * Math.cos(a) - oy * Math.sin(a) + cx,
        y: ox * Math.sin(a) + oy * Math.cos(a) + cy,
        ...(src.r ? { r: src.r } : {}),
      });
    }
  }
  return out;
}

function custom(
  points: readonly PNR[],
  reps: number,
  mirroring = false,
  cx = 0.5,
  cy = 0.5,
): RoundedPolygon {
  const actual = repeatPoints(points, reps, cx, cy, mirroring);
  return RoundedPolygon.fromVertices(
    actual.flatMap((q) => [q.x, q.y]),
    unrounded,
    actual.map((q) => q.r ?? unrounded),
    cx,
    cy,
  );
}

const builders = {
  circle: () => circleShape(10),
  square: () => rectangle(1, 1, r30),
  slanted: () => custom([p(0.926, 0.97, r(0.189, 0.811)), p(-0.021, 0.967, r(0.187, 0.057))], 2),
  arch: () =>
    RoundedPolygon.regular(4, 1, 0, 0, unrounded, [r100, r100, r20, r20]).transformed(rotate(-135)),
  fan: () =>
    custom(
      [
        p(1.004, 1, r(0.148, 0.417)),
        p(0, 1, r(0.151)),
        p(0, -0.003, r(0.148)),
        p(0.978, 0.02, r(0.803)),
      ],
      1,
    ),
  arrow: () =>
    custom(
      [
        p(0.5, 0.892, r(0.313)),
        p(-0.216, 1.05, r(0.207)),
        p(0.499, -0.16, r(0.215, 1)),
        p(1.225, 1.06, r(0.211)),
      ],
      1,
    ),
  semiCircle: () => rectangle(1.6, 1, unrounded, [r20, r20, r100, r100]),
  oval: () => circleShape().transformed(scale(1, 0.64)).transformed(rotate(-45)),
  pill: () => custom([p(0.961, 0.039, r(0.426)), p(1.001, 0.428), p(1, 0.609, r(1))], 2, true),
  triangle: () => RoundedPolygon.regular(3, 1, 0, 0, r20).transformed(rotate(-90)),
  diamond: () => custom([p(0.5, 1.096, r(0.151, 0.524)), p(0.04, 0.5, r(0.159))], 2),
  clamShell: () =>
    custom([p(0.171, 0.841, r(0.159)), p(-0.02, 0.5, r(0.14)), p(0.17, 0.159, r(0.159))], 2),
  pentagon: () =>
    custom([p(0.5, -0.009, r(0.172)), p(1.03, 0.365, r(0.164)), p(0.828, 0.97, r(0.169))], 1, true),
  gem: () =>
    custom(
      [
        p(0.499, 1.023, r(0.241, 0.778)),
        p(-0.005, 0.792, r(0.208)),
        p(0.073, 0.258, r(0.228)),
        p(0.433, 0, r(0.491)),
      ],
      1,
      true,
    ),
  sunny: () => star(8, 1, 0.8, r15),
  verySunny: () => custom([p(0.5, 1.08, r(0.085)), p(0.358, 0.843, r(0.085))], 8),
  cookie4Sided: () => custom([p(1.237, 1.236, r(0.258)), p(0.5, 0.918, r(0.233))], 4),
  cookie6Sided: () => custom([p(0.723, 0.884, r(0.394)), p(0.5, 1.099, r(0.398))], 6),
  cookie7Sided: () => star(7, 1, 0.75, r50).transformed(rotate(-90)),
  cookie9Sided: () => star(9, 1, 0.8, r50).transformed(rotate(-90)),
  cookie12Sided: () => star(12, 1, 0.8, r50).transformed(rotate(-90)),
  ghostish: () =>
    custom(
      [p(0.5, 0, r(1)), p(1, 0, r(1)), p(1, 1.14, r(0.254, 0.106)), p(0.575, 0.906, r(0.253))],
      1,
      true,
    ),
  clover4Leaf: () => custom([p(0.5, 0.074), p(0.725, -0.099, r(0.476))], 4, true),
  clover8Leaf: () => custom([p(0.5, 0.036), p(0.758, -0.101, r(0.209))], 8),
  burst: () => custom([p(0.5, -0.006, r(0.006)), p(0.592, 0.158, r(0.006))], 12),
  softBurst: () => custom([p(0.193, 0.277, r(0.053)), p(0.176, 0.055, r(0.053))], 10),
  boom: () => custom([p(0.457, 0.296, r(0.007)), p(0.5, -0.051, r(0.007))], 15),
  softBoom: () =>
    custom(
      [
        p(0.733, 0.454),
        p(0.839, 0.437, r(0.532)),
        p(0.949, 0.449, r(0.439, 1)),
        p(0.998, 0.478, r(0.174)),
      ],
      16,
      true,
    ),
  flower: () =>
    custom([p(0.37, 0.187), p(0.416, 0.049, r(0.381)), p(0.479, 0.001, r(0.095))], 8, true),
  puffy: () =>
    custom(
      [
        p(0.5, 0.053),
        p(0.545, -0.04, r(0.405)),
        p(0.67, -0.035, r(0.426)),
        p(0.717, 0.066, r(0.574)),
        p(0.722, 0.128),
        p(0.777, 0.002, r(0.36)),
        p(0.914, 0.149, r(0.66)),
        p(0.926, 0.289, r(0.66)),
        p(0.881, 0.346),
        p(0.94, 0.344, r(0.126)),
        p(1.003, 0.437, r(0.255)),
      ],
      2,
      true,
    ).transformed(scale(1, 0.742)),
  puffyDiamond: () =>
    custom([p(0.87, 0.13, r(0.146)), p(0.818, 0.357), p(1, 0.332, r(0.853))], 4, true),
  pixelCircle: () =>
    custom(
      [
        p(0.5, 0),
        p(0.704, 0),
        p(0.704, 0.065),
        p(0.843, 0.065),
        p(0.843, 0.148),
        p(0.926, 0.148),
        p(0.926, 0.296),
        p(1, 0.296),
      ],
      2,
      true,
    ),
  pixelTriangle: () =>
    custom(
      [
        p(0.11, 0.5),
        p(0.113, 0),
        p(0.287, 0),
        p(0.287, 0.087),
        p(0.421, 0.087),
        p(0.421, 0.17),
        p(0.56, 0.17),
        p(0.56, 0.265),
        p(0.674, 0.265),
        p(0.675, 0.344),
        p(0.789, 0.344),
        p(0.789, 0.439),
        p(0.888, 0.439),
      ],
      1,
      true,
    ),
  bun: () =>
    custom(
      [p(0.796, 0.5), p(0.853, 0.518, r(1)), p(0.992, 0.631, r(1)), p(0.968, 1, r(1))],
      2,
      true,
    ),
  heart: () =>
    custom(
      [
        p(0.5, 0.268, r(0.016)),
        p(0.792, -0.066, r(0.958)),
        p(1.064, 0.276, r(1)),
        p(0.501, 0.946, r(0.129)),
      ],
      1,
      true,
    ),
} as const;

export type MaterialShapeName = keyof typeof builders;
export const MATERIAL_SHAPES = Object.keys(builders) as MaterialShapeName[];

const cache = new Map<MaterialShapeName, RoundedPolygon>();

/** A Material 3 shape, normalized into the unit square. */
export function materialShape(name: MaterialShapeName): RoundedPolygon {
  let shape = cache.get(name);
  if (!shape) {
    shape = builders[name]().normalized();
    cache.set(name, shape);
  }
  return shape;
}

/** The M3 Expressive loading indicator's shape sequence. */
export const LOADING_SEQUENCE: readonly MaterialShapeName[] = [
  "softBurst",
  "cookie9Sided",
  "pentagon",
  "pill",
  "sunny",
  "cookie4Sided",
  "oval",
];

export { pt };

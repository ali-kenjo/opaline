// Ported from androidx graphics-shapes (Shapes.kt), Apache-2.0, © The Android Open Source
// Project. See THIRD_PARTY.md.
import {
  type CornerRounding,
  RoundedPolygon,
  rounding as makeRounding,
  unrounded,
} from "./polygon";
import { TWO_PI, add, lerp, pt, radialToCartesian } from "./point";

export function circle(numVertices = 8, radius = 1, centerX = 0, centerY = 0): RoundedPolygon {
  if (numVertices < 3) throw new Error("Circle must have at least three vertices");
  const theta = Math.PI / numVertices;
  return RoundedPolygon.regular(
    numVertices,
    radius / Math.cos(theta),
    centerX,
    centerY,
    makeRounding(radius),
  );
}

export function rectangle(
  width = 2,
  height = 2,
  round: CornerRounding = unrounded,
  perVertex?: readonly CornerRounding[],
  centerX = 0,
  centerY = 0,
): RoundedPolygon {
  const l = centerX - width / 2;
  const t = centerY - height / 2;
  const r = centerX + width / 2;
  const b = centerY + height / 2;
  return RoundedPolygon.fromVertices([r, b, l, b, l, t, r, t], round, perVertex, centerX, centerY);
}

export function star(
  numVerticesPerRadius: number,
  radius = 1,
  innerRadius = 0.5,
  round: CornerRounding = unrounded,
  innerRounding?: CornerRounding,
  perVertex?: readonly CornerRounding[],
  centerX = 0,
  centerY = 0,
): RoundedPolygon {
  if (radius <= 0 || innerRadius <= 0) throw new Error("Star radii must both be greater than 0");
  if (innerRadius >= radius) throw new Error("innerRadius must be less than radius");
  let pv = perVertex;
  if (!pv && innerRounding)
    pv = Array.from({ length: numVerticesPerRadius }, () => [round, innerRounding]).flat();
  const vertices: number[] = [];
  for (let i = 0; i < numVerticesPerRadius; i++) {
    const outer = radialToCartesian(radius, (Math.PI / numVerticesPerRadius) * 2 * i);
    vertices.push(outer.x + centerX, outer.y + centerY);
    const inner = radialToCartesian(innerRadius, (Math.PI / numVerticesPerRadius) * (2 * i + 1));
    vertices.push(inner.x + centerX, inner.y + centerY);
  }
  return RoundedPolygon.fromVertices(vertices, round, pv, centerX, centerY);
}

export function pill(
  width = 2,
  height = 1,
  smoothing = 0,
  centerX = 0,
  centerY = 0,
): RoundedPolygon {
  if (!(width > 0 && height > 0))
    throw new Error("Pill shapes must have positive width and height");
  const w = width / 2;
  const h = height / 2;
  return RoundedPolygon.fromVertices(
    [
      w + centerX,
      h + centerY,
      -w + centerX,
      h + centerY,
      -w + centerX,
      -h + centerY,
      w + centerX,
      -h + centerY,
    ],
    makeRounding(Math.min(w, h), smoothing),
    undefined,
    centerX,
    centerY,
  );
}

export function pillStar(
  width = 2,
  height = 1,
  numVerticesPerRadius = 8,
  innerRadiusRatio = 0.5,
  round: CornerRounding = unrounded,
  innerRounding?: CornerRounding,
  perVertex?: readonly CornerRounding[],
  vertexSpacing = 0.5,
  startLocation = 0,
  centerX = 0,
  centerY = 0,
): RoundedPolygon {
  if (!(width > 0 && height > 0))
    throw new Error("Pill shapes must have positive width and height");
  if (!(innerRadiusRatio > 0 && innerRadiusRatio <= 1))
    throw new Error("innerRadius must be between 0 and 1");
  let pv = perVertex;
  if (!pv && innerRounding)
    pv = Array.from({ length: numVerticesPerRadius }, () => [round, innerRounding]).flat();
  const vertices = pillStarVertices(
    numVerticesPerRadius,
    width,
    height,
    innerRadiusRatio,
    vertexSpacing,
    startLocation,
    centerX,
    centerY,
  );
  return RoundedPolygon.fromVertices(vertices, round, pv, centerX, centerY);
}

function pillStarVertices(
  n: number,
  width: number,
  height: number,
  innerRadius: number,
  vertexSpacing: number,
  startLocation: number,
  centerX: number,
  centerY: number,
): number[] {
  const endcapRadius = Math.min(width, height);
  const vSegLen = Math.max(0, height - width);
  const hSegLen = Math.max(0, width - height);
  const vSegHalf = vSegLen / 2;
  const hSegHalf = hSegLen / 2;
  const circlePerimeter = TWO_PI * endcapRadius * lerp(innerRadius, 1, vertexSpacing);
  const perimeter = 2 * hSegLen + 2 * vSegLen + circlePerimeter;
  const s: number[] = new Array<number>(11).fill(0);
  s[1] = vSegLen / 2;
  s[2] = s[1] + circlePerimeter / 4;
  s[3] = s[2] + hSegLen;
  s[4] = s[3] + circlePerimeter / 4;
  s[5] = s[4] + vSegLen;
  s[6] = s[5] + circlePerimeter / 4;
  s[7] = s[6] + hSegLen;
  s[8] = s[7] + circlePerimeter / 4;
  s[9] = s[8] + vSegLen / 2;
  s[10] = perimeter;
  const at = (i: number) => s[i % s.length] ?? 0;
  const tPerVertex = perimeter / (2 * n);
  let inner = false;
  let sec = 0;
  let secStart = 0;
  let secEnd = at(1);
  let t = startLocation * perimeter;
  const out: number[] = [];
  const rectBR = pt(hSegHalf, vSegHalf);
  const rectBL = pt(-hSegHalf, vSegHalf);
  const rectTL = pt(-hSegHalf, -vSegHalf);
  const rectTR = pt(hSegHalf, -vSegHalf);
  for (let i = 0; i < n * 2; i++) {
    const bt = t % perimeter;
    if (bt < secStart) sec = 0;
    while (bt >= at(sec + 1)) {
      sec = (sec + 1) % s.length;
      secStart = at(sec);
      secEnd = at(sec + 1);
    }
    const prop = (bt - secStart) / (secEnd - secStart);
    const r = inner ? endcapRadius * innerRadius : endcapRadius;
    let v;
    switch (sec) {
      case 0:
        v = pt(r, prop * vSegHalf);
        break;
      case 1:
        v = add(radialToCartesian(r, (prop * Math.PI) / 2), rectBR);
        break;
      case 2:
        v = pt(hSegHalf - prop * hSegLen, r);
        break;
      case 3:
        v = add(radialToCartesian(r, Math.PI / 2 + (prop * Math.PI) / 2), rectBL);
        break;
      case 4:
        v = pt(-r, vSegHalf - prop * vSegLen);
        break;
      case 5:
        v = add(radialToCartesian(r, Math.PI + (prop * Math.PI) / 2), rectTL);
        break;
      case 6:
        v = pt(-hSegHalf + prop * hSegLen, -r);
        break;
      case 7:
        v = add(radialToCartesian(r, Math.PI * 1.5 + (prop * Math.PI) / 2), rectTR);
        break;
      default:
        v = pt(r, -vSegHalf + prop * vSegHalf);
    }
    out.push(v.x + centerX, v.y + centerY);
    t += tPerVertex;
    inner = !inner;
  }
  return out;
}

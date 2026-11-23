// Expressive shapes: a TypeScript port of androidx graphics-shapes and MaterialShapes
// (Apache-2.0, see THIRD_PARTY.md).
export { Cubic } from "./cubic";
export { Feature } from "./features";
export { RoundedPolygon, rounding, unrounded, type CornerRounding } from "./polygon";
export { circle, pill, pillStar, rectangle, star } from "./builders";
export { Morph, cubicsToPath } from "./morph";
export {
  LOADING_SEQUENCE,
  MATERIAL_SHAPES,
  materialShape,
  type MaterialShapeName,
} from "./material";

export {
  GlassCompositor,
  flatten,
  type Surface,
  type SurfaceLook,
  type WallpaperPlacement,
} from "./compositor";
export {
  Glass,
  GlassStage,
  SPIKE_WANTS_SHARP,
  type StageInks,
  useGlassContrast,
  useGlassSync,
  type GlassProps,
  type GlassStageProps,
} from "./GlassStage";
export { contrast, legibleAlpha, luminance, luminanceUnder, sliderAlpha } from "./legibility";
export { BackdropSampler, chooseInk, type BackdropStats, type InkChoice } from "./backdrop";

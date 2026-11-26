// Widget style (ADR 0011, ADR 0017). The types and key list are generated from
// `crates/opaline-core/src/style.rs` via `spec/style.schema.json` (`pnpm gen:types`).
import {
  STYLE_KEYS,
  type AppearanceState,
  type ColorSource,
  type Density,
  type HeroColor,
  type MotionSpeed,
  type See,
  type Style as GeneratedStyle,
  type Surface,
  type Theme,
  type Variant,
} from "./style.gen";

export {
  STYLE_KEYS,
  type AppearanceState,
  type ColorSource,
  type Density,
  type HeroColor,
  type MotionSpeed,
  type See,
  type Surface,
  type Surface as SurfaceKind,
  type Theme,
  type Variant,
};

export type StyleKey = (typeof STYLE_KEYS)[number];

/** A stored style: any subset of generated keys; `null` is never stored (it means "reset" in a patch). */
export type Style = { [K in StyleKey]?: GeneratedStyle[K] };

/** Keys whose built-in default is `null` ("inherit / automatic"). */
export type NullableStyleKey =
  | "seedColor"
  | "accentColor"
  | "textColor"
  | "secondaryTextColor"
  | "heroCustomColor"
  | "surfaceColor"
  | "tintColor"
  | "borderColor"
  | "radius";

/** Every style key resolved to a concrete value (or `null` for unset optional overrides). */
export type ResolvedStyle = {
  [K in StyleKey]: K extends NullableStyleKey
    ? NonNullable<Style[K]> | null
    : NonNullable<Style[K]>;
};

/** The designed look. A widget with no style anywhere renders exactly like the Lab baselines. */
export const BUILTIN_STYLE: Readonly<ResolvedStyle> = {
  colorSource: "wallpaper",
  seedColor: null,
  variant: "tonal-spot",
  contrast: 0,
  theme: "auto",
  accentColor: null,
  textColor: null,
  secondaryTextColor: null,
  heroColor: "ramp",
  heroCustomColor: null,
  surface: "glass",
  surfaceColor: null,
  transparency: 60,
  blur: 60,
  see: "wallpaper",
  tintColor: null,
  refraction: 50,
  rim: 50,
  grain: 50,
  shadow: 50,
  borderWidth: 0,
  borderColor: null,
  radius: null,
  density: "comfortable",
  fontFamily: "Inter",
  numberFontFamily: "Roboto Flex",
  fontWeight: 400,
  fontWidth: 100,
  textScale: 1,
  letterSpacing: 0,
  tabularNumbers: true,
  odometer: true,
  textShadow: false,
  uppercaseLabels: false,
  icons: true,
  iconFill: false,
  iconWeight: 400,
  animations: true,
  motionSpeed: "default",
  appearance: "automatic",
  dimLevel: 50,
  hoverLift: true,
  legibility: true,
};

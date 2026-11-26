// Widget style 2.0 (ADR 0011, ADR 0017, brief §5.1). The types and key list are generated from
// `crates/opaline-core/src/style.rs` via `spec/style.schema.json` (`pnpm gen:types`).
import {
  STYLE_KEYS,
  type ActionKind,
  type ActionSpec,
  type AppearanceState,
  type BackgroundImage,
  type CardShape,
  type ColorSource,
  type ConditionalStyle,
  type ContentAlign,
  type Density,
  type EntranceEffect,
  type GradientKind,
  type GradientSpec,
  type GradientStop,
  type HeaderStyle,
  type HeroColor,
  type HeroOptions,
  type HeroVisual,
  type HoverEffect,
  type IconSet,
  type ImageFit,
  type MotionSpeed,
  type RoleTypography,
  type See,
  type StrokeCap,
  type Style as GeneratedStyle,
  type Surface,
  type TextCase,
  type Theme,
  type ValueAnimation,
  type Variant,
  type WidgetActions,
} from "./style.gen";

export {
  STYLE_KEYS,
  type ActionKind,
  type ActionSpec,
  type AppearanceState,
  type BackgroundImage,
  type CardShape,
  type ColorSource,
  type ConditionalStyle,
  type ContentAlign,
  type Density,
  type EntranceEffect,
  type GradientKind,
  type GradientSpec,
  type GradientStop,
  type HeaderStyle,
  type HeroColor,
  type HeroOptions,
  type HeroVisual,
  type HoverEffect,
  type IconSet,
  type ImageFit,
  type MotionSpeed,
  type RoleTypography,
  type See,
  type StrokeCap,
  type Surface,
  type Surface as SurfaceKind,
  type TextCase,
  type Theme,
  type ValueAnimation,
  type Variant,
  type WidgetActions,
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
  | "cornerRadii"
  | "backgroundGradient"
  | "backgroundImage"
  | "tintColor"
  | "tintGradient"
  | "shadowColor"
  | "borderColor"
  | "borderGradient"
  | "radius"
  | "padding"
  | "gap"
  | "roles"
  | "iconColor"
  | "heroOptions"
  | "actions"
  | "tooltip"
  | "conditions";

/** Every style key resolved to a concrete value (or `null` for unset optional overrides). */
export type ResolvedStyle = {
  [K in StyleKey]: K extends NullableStyleKey
    ? NonNullable<Style[K]> | null
    : NonNullable<Style[K]>;
};

/**
 * The built-in default look (Classic 1.1 baseline). A widget with no theme or user overrides
 * renders pixel-identically to the 1.1 Lab baselines; the Opaline theme overrides blur/transparency
 * and typography on top of these defaults (DESIGN-2 §8.3).
 */
export const BUILTIN_STYLE: Readonly<ResolvedStyle> = {
  // Color
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

  // Surface & glass 2.0
  surface: "glass",
  surfaceColor: null,
  cardShape: "rounded-rect",
  cornerSmoothing: 0,
  cornerRadii: null,
  backgroundGradient: null,
  backgroundImage: null,
  transparency: 60,
  blur: 60,
  see: "wallpaper",
  tintColor: null,
  tintGradient: null,
  refraction: 50,
  refractionWidth: 14,
  dispersion: 0,
  rim: 50,
  specularAngle: 315,
  specularWidth: 100,
  innerGlow: 0,
  grain: 50,
  shadow: 50,
  shadowColor: null,
  shadowBlur: 24,
  shadowOffsetX: 0,
  shadowOffsetY: 8,
  shadowSpread: 0,
  innerShadow: 0,
  borderWidth: 0,
  borderColor: null,
  borderGradient: null,
  borderGlow: 0,
  radius: null,
  opacity: 100,

  // Layout
  density: "comfortable",
  padding: null,
  gap: null,
  contentAlign: "stretch",
  headerStyle: "icon-title",

  // Typography
  fontFamily: "Inter",
  numberFontFamily: "Roboto Flex",
  fontWeight: 400,
  fontWidth: 100,
  textScale: 1,
  letterSpacing: 0,
  lineHeight: 1.25,
  textCase: "none",
  tabularNumbers: true,
  slashedZero: false,
  stylisticSet: 0,
  odometer: true,
  textShadow: false,
  vibrancyText: false,
  uppercaseLabels: false,
  roles: null,

  // Icons
  icons: true,
  iconSet: "rounded",
  iconFill: false,
  iconWeight: 400,
  iconGrade: 0,
  iconSize: 18,
  iconColor: null,

  // Hero visuals
  heroVisual: "auto",
  heroOptions: null,

  // Motion & effects
  animations: true,
  motionSpeed: "default",
  hoverEffect: "lift",
  pressScale: 0.97,
  entrance: "spring",
  valueAnimation: "odometer",
  ambientMotion: true,

  // State & behavior
  appearance: "automatic",
  dimLevel: 50,
  hoverLift: true,
  legibility: true,
  actions: null,
  tooltip: null,
  autoHideEmpty: false,

  // Conditional styles
  conditions: null,
};

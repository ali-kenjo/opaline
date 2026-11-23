// Widget style (ADR 0011). Mirrors `crates/opaline-core/src/style.rs`: every field optional,
// unset = inherit (built-in default → global style → the widget's own style).
import type { Variant } from "../color/scheme";

export type ColorSource = "wallpaper" | "accent" | "custom";
export type Theme = "auto" | "light" | "dark";
export type HeroColor = "ramp" | "accent" | "custom";
export type SurfaceKind = "glass" | "tinted" | "opaque" | "color";
export type Density = "compact" | "comfortable" | "spacious";
export type MotionSpeed = "slow" | "default" | "fast";
export type AppearanceState = "full" | "dimmed" | "automatic";

export interface ResolvedStyle {
  // Color
  colorSource: ColorSource;
  seedColor: string | null;
  variant: Variant;
  contrast: number;
  theme: Theme;
  accentColor: string | null;
  textColor: string | null;
  secondaryTextColor: string | null;
  heroColor: HeroColor;
  heroCustomColor: string | null;
  // Surface
  surface: SurfaceKind;
  surfaceColor: string | null;
  transparency: number;
  blur: number;
  tintColor: string | null;
  refraction: number;
  rim: number;
  grain: number;
  shadow: number;
  borderWidth: number;
  borderColor: string | null;
  radius: number | null;
  density: Density;
  // Text
  /** Labels and body text. */
  fontFamily: string;
  /** Values and the hero number. */
  numberFontFamily: string;
  fontWeight: number;
  fontWidth: number;
  textScale: number;
  letterSpacing: number;
  tabularNumbers: boolean;
  odometer: boolean;
  textShadow: boolean;
  uppercaseLabels: boolean;
  // Icons
  icons: boolean;
  iconFill: boolean;
  iconWeight: number;
  // Motion
  animations: boolean;
  motionSpeed: MotionSpeed;
  // State
  appearance: AppearanceState;
  dimLevel: number;
  hoverLift: boolean;
  legibility: boolean;
}

export type StyleKey = keyof ResolvedStyle;

/** A stored style: any subset; `null` is never stored (it means "reset" in a patch). */
export type Style = { [K in StyleKey]?: Exclude<ResolvedStyle[K], null> };

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
  blur: 0,
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

export const STYLE_KEYS = Object.keys(BUILTIN_STYLE) as StyleKey[];

// Generated from spec/style.schema.json by app/scripts/schema-to-ts.mjs; don't edit.
// The Rust types are the source: change them, then run `pnpm gen:types`.

export interface Style {
  accentColor?: string;
  animations?: boolean;
  appearance?: AppearanceState;
  /** 0 (sharp) … 100 (very soft); 60 is the 1.x look (settings v2, ADR 0012). */
  blur?: number;
  borderColor?: string;
  /** CSS px, 0 … 4. */
  borderWidth?: number;
  colorSource?: ColorSource;
  /** −1 (reduced) … 0 (standard) … 1 (high). */
  contrast?: number;
  density?: Density;
  /** 0 … 100: how far Dimmed fades. */
  dimLevel?: number;
  fontFamily?: string;
  /** 100 … 1000. */
  fontWeight?: number;
  /** Roboto Flex `wdth`, 25 … 151. */
  fontWidth?: number;
  grain?: number;
  heroColor?: HeroColor;
  heroCustomColor?: string;
  hoverLift?: boolean;
  iconFill?: boolean;
  /** 100 … 700. */
  iconWeight?: number;
  icons?: boolean;
  /** Adaptive legibility (DESIGN.md §4); off shows a contrast warning instead. */
  legibility?: boolean;
  /** em, −0.05 … 0.2. */
  letterSpacing?: number;
  motionSpeed?: MotionSpeed;
  numberFontFamily?: string;
  odometer?: boolean;
  /** CSS px, 0 … 48; unset follows the size class (28 / 32). */
  radius?: number;
  refraction?: number;
  rim?: number;
  secondaryTextColor?: string;
  see?: See;
  seedColor?: string;
  shadow?: number;
  surface?: Surface;
  surfaceColor?: string;
  tabularNumbers?: boolean;
  textColor?: string;
  /** 0.75 … 1.5. */
  textScale?: number;
  textShadow?: boolean;
  theme?: Theme;
  tintColor?: string;
  /** 0 (solid) … 100 (clearest glass). */
  transparency?: number;
  uppercaseLabels?: boolean;
  variant?: Variant;
}

export type AppearanceState = "full" | "dimmed" | "automatic";

export type ColorSource = "wallpaper" | "accent" | "custom";

export type Density = "compact" | "comfortable" | "spacious";

export type HeroColor = "accent" | "custom" | "ramp";

export type MotionSpeed = "slow" | "default" | "fast";

/** How the background shows through glass (ADR 0012). */
export type See = "wallpaper" | "real";

export type Surface = "glass" | "tinted" | "opaque" | "color" | "clear";

export type Theme = "auto" | "light" | "dark";

export type Variant =
  "tonal-spot" | "vibrant" | "expressive" | "fidelity" | "neutral" | "monochrome";

export const STYLE_KEYS = [
  "accentColor",
  "animations",
  "appearance",
  "blur",
  "borderColor",
  "borderWidth",
  "colorSource",
  "contrast",
  "density",
  "dimLevel",
  "fontFamily",
  "fontWeight",
  "fontWidth",
  "grain",
  "heroColor",
  "heroCustomColor",
  "hoverLift",
  "iconFill",
  "iconWeight",
  "icons",
  "legibility",
  "letterSpacing",
  "motionSpeed",
  "numberFontFamily",
  "odometer",
  "radius",
  "refraction",
  "rim",
  "secondaryTextColor",
  "see",
  "seedColor",
  "shadow",
  "surface",
  "surfaceColor",
  "tabularNumbers",
  "textColor",
  "textScale",
  "textShadow",
  "theme",
  "tintColor",
  "transparency",
  "uppercaseLabels",
  "variant",
] as const;

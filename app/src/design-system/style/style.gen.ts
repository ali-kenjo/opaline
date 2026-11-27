// Generated from spec/style.schema.json by app/scripts/schema-to-ts.mjs; don't edit.
// The Rust types are the source: change them, then run `pnpm gen:types`.

export interface Style {
  accentColor?: string;
  actions?: WidgetActions;
  ambientMotion?: boolean;
  animations?: boolean;
  appearance?: AppearanceState;
  /** Hide the widget and reflow when empty (e.g. Now Playing with nothing playing). */
  autoHideEmpty?: boolean;
  backgroundGradient?: GradientSpec;
  backgroundImage?: BackgroundImage;
  /** 0 (sharp) … 100 (very soft); 60 is the 1.x look (settings v2, ADR 0012). */
  blur?: number;
  borderColor?: string;
  /** Outer glow along the border, 0 … 100. */
  borderGlow?: number;
  borderGradient?: GradientSpec;
  /** CSS px, 0 … 8. */
  borderWidth?: number;
  cardShape?: CardShape;
  colorSource?: ColorSource;
  /** Ordered "when <expression> → set <style keys>" rules (at most 16). */
  conditions?: ConditionalStyle[];
  contentAlign?: ContentAlign;
  /** −1 (reduced) … 0 (standard) … 1 (high). */
  contrast?: number;
  /** Per-corner radii `[topLeft, topRight, bottomRight, bottomLeft]` in CSS px (0 … 64). */
  cornerRadii?: number[];
  /** Continuous squircle corner smoothing, 0 (circular arc) … 100 (squircle). */
  cornerSmoothing?: number;
  density?: Density;
  /** 0 … 100: how far Dimmed fades. */
  dimLevel?: number;
  /** Chromatic dispersion at the glass edge, 0 … 100. */
  dispersion?: number;
  entrance?: EntranceEffect;
  fontFamily?: string;
  /** 100 … 1000. */
  fontWeight?: number;
  /** Roboto Flex `wdth`, 25 … 151. */
  fontWidth?: number;
  /** Explicit gap between rows/elements in CSS px (0 … 32); unset follows density. */
  gap?: number;
  grain?: number;
  headerStyle?: HeaderStyle;
  heroColor?: HeroColor;
  heroCustomColor?: string;
  heroOptions?: HeroOptions;
  heroVisual?: HeroVisual;
  hoverEffect?: HoverEffect;
  hoverLift?: boolean;
  iconColor?: string;
  iconFill?: boolean;
  /** Material Symbols `GRAD` axis, −25 … 200. */
  iconGrade?: number;
  iconSet?: IconSet;
  /** Base icon size in CSS px, 10 … 64. */
  iconSize?: number;
  /** 100 … 700. */
  iconWeight?: number;
  icons?: boolean;
  /** Inner edge glow strength, 0 … 100. */
  innerGlow?: number;
  /** Inner shadow strength, 0 … 100. */
  innerShadow?: number;
  /** Adaptive legibility (DESIGN.md §4); off shows a contrast warning instead. */
  legibility?: boolean;
  /** em, −0.05 … 0.2. */
  letterSpacing?: number;
  /** Unitless line height, 0.8 … 2.2. */
  lineHeight?: number;
  motionSpeed?: MotionSpeed;
  numberFontFamily?: string;
  odometer?: boolean;
  /** Overall widget opacity, 0 … 100 %. */
  opacity?: number;
  /** Explicit inner padding in CSS px (0 … 48); unset follows size + density. */
  padding?: number;
  /** Scale on press, 0.9 … 1.0 (default 0.97). */
  pressScale?: number;
  /** CSS px, 0 … 48; unset follows the size class (28 / 32). */
  radius?: number;
  refraction?: number;
  /** Refraction band width in CSS px, 0 … 40. */
  refractionWidth?: number;
  rim?: number;
  /** Per-role typography overrides (`hero`, `title`, `label`, `value`, `caption`, `unit`, `accent`). */
  roles?: {
    accent?: RoleTypography;
    caption?: RoleTypography;
    hero?: RoleTypography;
    label?: RoleTypography;
    title?: RoleTypography;
    unit?: RoleTypography;
    value?: RoleTypography;
  };
  secondaryTextColor?: string;
  see?: See;
  seedColor?: string;
  shadow?: number;
  /** Drop shadow blur radius in CSS px, 0 … 64. */
  shadowBlur?: number;
  shadowColor?: string;
  /** Drop shadow horizontal offset in CSS px, −32 … 32. */
  shadowOffsetX?: number;
  /** Drop shadow vertical offset in CSS px, −32 … 32. */
  shadowOffsetY?: number;
  /** Drop shadow spread in CSS px, −16 … 32. */
  shadowSpread?: number;
  slashedZero?: boolean;
  /** Specular light angle in degrees clockwise from 12 o'clock (0 … 360, default 315). */
  specularAngle?: number;
  /** Specular rim width in percent (10 … 200, default 100). */
  specularWidth?: number;
  /** OpenType stylistic set (`ss01` … `ss20`), 0 = off. */
  stylisticSet?: number;
  surface?: Surface;
  surfaceColor?: string;
  tabularNumbers?: boolean;
  textCase?: TextCase;
  textColor?: string;
  /** 0.75 … 1.5. */
  textScale?: number;
  textShadow?: boolean;
  theme?: Theme;
  tintColor?: string;
  tintGradient?: GradientSpec;
  /** Custom tooltip shown on hover (max 200 characters). */
  tooltip?: string;
  /** 0 (solid) … 100 (clearest glass). */
  transparency?: number;
  uppercaseLabels?: boolean;
  valueAnimation?: ValueAnimation;
  variant?: Variant;
  vibrancyText?: boolean;
}

export type ActionKind =
  "none" | "detail" | "open-app" | "open-url" | "command" | "toggle" | "step";

/** One interaction action on a widget (click, double-click, middle-click, scroll). */
export interface ActionSpec {
  /** Numeric delta for `step` actions. */
  delta?: number;
  kind: ActionKind;
  /** App desktop ID, URL (`https://…`), or allowlisted command/variable name. */
  target?: string;
}

export type AppearanceState = "full" | "dimmed" | "automatic";

/** A local or theme-bundled background image for a widget surface. */
export interface BackgroundImage {
  /** Extra blur, 0 … 100. */
  blur?: number;
  /** Darkening overlay, 0 … 100 %. */
  dim?: number;
  fit?: ImageFit;
  /** Asset URL (`opaline-asset://…`) or relative path inside a theme package. */
  path: string;
  /** CSS object-position (`center`, `top`, `50% 30%`, …). */
  position?: string;
}

/** Card silhouette: a rounded rectangle (default) or any of the 35 Material 3 Expressive shapes. */
export type CardShape =
  | "rounded-rect"
  | "circle"
  | "square"
  | "slanted"
  | "arch"
  | "fan"
  | "arrow"
  | "semi-circle"
  | "oval"
  | "pill"
  | "triangle"
  | "diamond"
  | "clam-shell"
  | "pentagon"
  | "gem"
  | "sunny"
  | "very-sunny"
  | "cookie-4-sided"
  | "cookie-6-sided"
  | "cookie-7-sided"
  | "cookie-9-sided"
  | "cookie-12-sided"
  | "ghostish"
  | "clover-4-leaf"
  | "clover-8-leaf"
  | "burst"
  | "soft-burst"
  | "boom"
  | "soft-boom"
  | "flower"
  | "puffy"
  | "puffy-diamond"
  | "pixel-circle"
  | "pixel-triangle"
  | "bun"
  | "heart";

export type ColorSource = "wallpaper" | "accent" | "custom";

/** An ordered conditional style rule: when `when` evaluates truthy, apply `set` over the style. */
export interface ConditionalStyle {
  /** Animate transitioning into and out of this rule (default true). */
  animate?: boolean;
  /** Style keys to override when the expression is truthy (no nested `conditions`). */
  set: Record<string, unknown>;
  /** Expression in the Opaline expression language (docs/EXPRESSIONS.md). */
  when: string;
}

export type ContentAlign = "start" | "center" | "end" | "stretch";

export type Density = "compact" | "comfortable" | "spacious";

export type EntranceEffect = "spring" | "fade" | "none";

export type GradientKind = "linear" | "radial" | "conic";

/** A 2–4 stop gradient used for backgrounds, tints, or borders. */
export interface GradientSpec {
  /** Angle in degrees (0 … 360) for linear and conic gradients. */
  angle?: number;
  kind: GradientKind;
  stops: GradientStop[];
}

export interface GradientStop {
  /** Stop position, 0 … 100 %. */
  at: number;
  /** Hex color (`#rrggbb` or `#rrggbbaa`). */
  color: string;
}

export type HeaderStyle = "icon-title" | "title" | "icon" | "none";

export type HeroColor = "accent" | "custom" | "ramp";

/** Options for hero visuals (rings, gauges, bars, charts). */
export interface HeroOptions {
  cap?: StrokeCap;
  /** Filled area under charts. */
  fill?: boolean;
  gradient?: boolean;
  needle?: boolean;
  /** Segmented ring/bar count, 0 (continuous) … 64. */
  segments?: number;
  /** Curve smoothing for charts, 0 … 100 %. */
  smoothing?: number;
  /** Stroke or bar thickness in px, 1 … 24. */
  thickness?: number;
  ticks?: boolean;
  track?: boolean;
  wave?: boolean;
}

/** Hero visual presentation choice (brief §5.1). */
export type HeroVisual =
  | "auto"
  | "ring"
  | "gauge"
  | "bar"
  | "chart"
  | "number"
  | "shape-badge"
  | "liquid-fill"
  | "dot-matrix";

export type HoverEffect = "lift" | "tilt" | "glow" | "none";

/** Material Symbols icon set (all Apache-2.0) or none. */
export type IconSet = "rounded" | "outlined" | "sharp" | "none";

export type ImageFit = "cover" | "contain" | "fill";

export type MotionSpeed = "slow" | "default" | "fast";

/** Per-role typography overrides (brief §5.1). */
export interface RoleTypography {
  color?: string;
  fontFamily?: string;
  /**
   * Font size in CSS px, 8 … 180. For the `hero` role this is the size on an M card; other card
   * sizes scale it like the built-in scale (1×1 20/44, S 30/44, L and XL 72/44).
   */
  fontSize?: number;
  /** 100 … 1000. */
  fontWeight?: number;
  /** Variable font `wdth` axis, 25 … 151. */
  fontWidth?: number;
  /** Letter spacing in em, −0.1 … 0.5. */
  letterSpacing?: number;
  /** Unitless line-height multiplier, 0.7 … 2.5. */
  lineHeight?: number;
  /** Text opacity, 0 … 100 %. */
  opacity?: number;
  slashedZero?: boolean;
  /** OpenType stylistic set (`ss01` … `ss20`), 0 = off. */
  stylisticSet?: number;
  tabularNumbers?: boolean;
  textCase?: TextCase;
}

/** How the background shows through glass (ADR 0012). */
export type See = "wallpaper" | "real";

export type StrokeCap = "round" | "butt";

export type Surface =
  "glass" | "tinted" | "opaque" | "color" | "clear" | "gradient" | "image" | "album-art";

export type TextCase = "none" | "uppercase" | "lowercase" | "capitalize";

export type Theme = "auto" | "light" | "dark";

export type ValueAnimation = "odometer" | "fade" | "none";

export type Variant =
  "tonal-spot" | "vibrant" | "expressive" | "fidelity" | "neutral" | "monochrome";

/** Per-gesture actions on a widget card (brief §5.1). */
export interface WidgetActions {
  click?: ActionSpec;
  doubleClick?: ActionSpec;
  middleClick?: ActionSpec;
  scrollDown?: ActionSpec;
  scrollUp?: ActionSpec;
}

export const STYLE_KEYS = [
  "accentColor",
  "actions",
  "ambientMotion",
  "animations",
  "appearance",
  "autoHideEmpty",
  "backgroundGradient",
  "backgroundImage",
  "blur",
  "borderColor",
  "borderGlow",
  "borderGradient",
  "borderWidth",
  "cardShape",
  "colorSource",
  "conditions",
  "contentAlign",
  "contrast",
  "cornerRadii",
  "cornerSmoothing",
  "density",
  "dimLevel",
  "dispersion",
  "entrance",
  "fontFamily",
  "fontWeight",
  "fontWidth",
  "gap",
  "grain",
  "headerStyle",
  "heroColor",
  "heroCustomColor",
  "heroOptions",
  "heroVisual",
  "hoverEffect",
  "hoverLift",
  "iconColor",
  "iconFill",
  "iconGrade",
  "iconSet",
  "iconSize",
  "iconWeight",
  "icons",
  "innerGlow",
  "innerShadow",
  "legibility",
  "letterSpacing",
  "lineHeight",
  "motionSpeed",
  "numberFontFamily",
  "odometer",
  "opacity",
  "padding",
  "pressScale",
  "radius",
  "refraction",
  "refractionWidth",
  "rim",
  "roles",
  "secondaryTextColor",
  "see",
  "seedColor",
  "shadow",
  "shadowBlur",
  "shadowColor",
  "shadowOffsetX",
  "shadowOffsetY",
  "shadowSpread",
  "slashedZero",
  "specularAngle",
  "specularWidth",
  "stylisticSet",
  "surface",
  "surfaceColor",
  "tabularNumbers",
  "textCase",
  "textColor",
  "textScale",
  "textShadow",
  "theme",
  "tintColor",
  "tintGradient",
  "tooltip",
  "transparency",
  "uppercaseLabels",
  "valueAnimation",
  "variant",
  "vibrancyText",
] as const;

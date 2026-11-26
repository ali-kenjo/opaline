//! Widget style 2.0 and per-widget configuration (ADR 0011, ADR 0017, brief §5.1).
//!
//! Every field of [`Style`] is optional: unset means "inherit" across the 6-layer cascade
//! (`default → theme → global → kind → widget → element`). Patches are strict (an invalid value
//! is an error); loading is lenient (an invalid field is dropped and the rest kept), so one bad
//! value never resets the user's settings.
//!
//! These Rust types are the single source of truth: `spec/style.schema.json` and
//! `app/src/design-system/style/style.gen.ts` are generated from them.

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ColorSource {
    Wallpaper,
    Accent,
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Variant {
    TonalSpot,
    Vibrant,
    Expressive,
    Fidelity,
    Neutral,
    Monochrome,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Theme {
    Auto,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum HeroColor {
    /// The meaning ramp (thermal, load, health).
    Ramp,
    Accent,
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Surface {
    Glass,
    Tinted,
    Opaque,
    /// A solid custom color (`surfaceColor`), still with the chosen transparency.
    Color,
    /// Completely transparent / frameless: widget content floats directly on the wallpaper.
    Clear,
    /// A 2–4 stop linear, radial, or conic gradient (`backgroundGradient`).
    Gradient,
    /// A local image background (`backgroundImage`).
    Image,
    /// The currently playing track's blurred album art.
    AlbumArt,
}

/// How the background shows through glass (ADR 0012).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum See {
    /// The wallpaper, sampled at the blur level (0 = sharp).
    Wallpaper,
    /// Real transparency: the desktop behind the layer window shows through.
    Real,
}

/// Card silhouette: a rounded rectangle (default) or any of the 35 Material 3 Expressive shapes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum CardShape {
    RoundedRect,
    Circle,
    Square,
    Slanted,
    Arch,
    Fan,
    Arrow,
    SemiCircle,
    Oval,
    Pill,
    Triangle,
    Diamond,
    ClamShell,
    Pentagon,
    Gem,
    Sunny,
    VerySunny,
    #[serde(rename = "cookie-4-sided")]
    Cookie4Sided,
    #[serde(rename = "cookie-6-sided")]
    Cookie6Sided,
    #[serde(rename = "cookie-7-sided")]
    Cookie7Sided,
    #[serde(rename = "cookie-9-sided")]
    Cookie9Sided,
    #[serde(rename = "cookie-12-sided")]
    Cookie12Sided,
    Ghostish,
    #[serde(rename = "clover-4-leaf")]
    Clover4Leaf,
    #[serde(rename = "clover-8-leaf")]
    Clover8Leaf,
    Burst,
    SoftBurst,
    Boom,
    SoftBoom,
    Flower,
    Puffy,
    PuffyDiamond,
    PixelCircle,
    PixelTriangle,
    Bun,
    Heart,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum GradientKind {
    Linear,
    Radial,
    Conic,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GradientStop {
    /// Hex color (`#rrggbb` or `#rrggbbaa`).
    pub color: String,
    /// Stop position, 0 … 100 %.
    pub at: f64,
}

/// A 2–4 stop gradient used for backgrounds, tints, or borders.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GradientSpec {
    pub kind: GradientKind,
    /// Angle in degrees (0 … 360) for linear and conic gradients.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub angle: Option<f64>,
    pub stops: Vec<GradientStop>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ImageFit {
    Cover,
    Contain,
    Fill,
}

/// A local or theme-bundled background image for a widget surface.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundImage {
    /// Asset URL (`opaline-asset://…`) or relative path inside a theme package.
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fit: Option<ImageFit>,
    /// CSS object-position (`center`, `top`, `50% 30%`, …).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<String>,
    /// Extra blur, 0 … 100.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blur: Option<f64>,
    /// Darkening overlay, 0 … 100 %.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dim: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Density {
    Compact,
    Comfortable,
    Spacious,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum TextCase {
    None,
    Uppercase,
    Lowercase,
    Capitalize,
}

/// Typography roles that themes and styles can target individually (brief §5.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum TextRole {
    Hero,
    Title,
    Label,
    Value,
    Caption,
    Unit,
    Accent,
}

/// Per-role typography overrides (brief §5.1).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct RoleTypography {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    /// 100 … 1000.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_weight: Option<f64>,
    /// Variable font `wdth` axis, 25 … 151.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_width: Option<f64>,
    /// Font size in CSS px, 8 … 180.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f64>,
    /// Letter spacing in em, −0.1 … 0.5.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub letter_spacing: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_case: Option<TextCase>,
    /// Unitless line-height multiplier, 0.7 … 2.5.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_height: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Text opacity, 0 … 100 %.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tabular_numbers: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slashed_zero: Option<bool>,
    /// OpenType stylistic set (`ss01` … `ss20`), 0 = off.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stylistic_set: Option<u8>,
}

/// Material Symbols icon set (all Apache-2.0) or none.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum IconSet {
    Rounded,
    Outlined,
    Sharp,
    None,
}

/// Hero visual presentation choice (brief §5.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum HeroVisual {
    Auto,
    Ring,
    Gauge,
    Bar,
    Chart,
    Number,
    ShapeBadge,
    LiquidFill,
    DotMatrix,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum StrokeCap {
    Round,
    Butt,
}

/// Options for hero visuals (rings, gauges, bars, charts).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct HeroOptions {
    /// Stroke or bar thickness in px, 1 … 24.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thickness: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cap: Option<StrokeCap>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track: Option<bool>,
    /// Segmented ring/bar count, 0 (continuous) … 64.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub segments: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wave: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gradient: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ticks: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub needle: Option<bool>,
    /// Curve smoothing for charts, 0 … 100 %.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub smoothing: Option<f64>,
    /// Filled area under charts.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ContentAlign {
    Start,
    Center,
    End,
    Stretch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum HeaderStyle {
    IconTitle,
    Title,
    Icon,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum MotionSpeed {
    Slow,
    Default,
    Fast,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum HoverEffect {
    Lift,
    Tilt,
    Glow,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum EntranceEffect {
    Spring,
    Fade,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ValueAnimation {
    Odometer,
    Fade,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum AppearanceState {
    Full,
    Dimmed,
    Automatic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ActionKind {
    None,
    Detail,
    OpenApp,
    OpenUrl,
    Command,
    Toggle,
    Step,
}

/// One interaction action on a widget (click, double-click, middle-click, scroll).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ActionSpec {
    pub kind: ActionKind,
    /// App desktop ID, URL (`https://…`), or allowlisted command/variable name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    /// Numeric delta for `step` actions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delta: Option<f64>,
}

/// Per-gesture actions on a widget card (brief §5.1).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct WidgetActions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub click: Option<ActionSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub double_click: Option<ActionSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub middle_click: Option<ActionSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scroll_up: Option<ActionSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scroll_down: Option<ActionSpec>,
}

/// An ordered conditional style rule: when `when` evaluates truthy, apply `set` over the style.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConditionalStyle {
    /// Expression in the Opaline expression language (docs/EXPRESSIONS.md).
    pub when: String,
    /// Style keys to override when the expression is truthy (no nested `conditions`).
    pub set: BTreeMap<String, serde_json::Value>,
    /// Animate transitioning into and out of this rule (default true).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub animate: Option<bool>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct Style {
    // Color
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_source: Option<ColorSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seed_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variant: Option<Variant>,
    /// −1 (reduced) … 0 (standard) … 1 (high).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contrast: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<Theme>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accent_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secondary_text_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hero_color: Option<HeroColor>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hero_custom_color: Option<String>,

    // Surface & glass 2.0
    #[serde(skip_serializing_if = "Option::is_none")]
    pub surface: Option<Surface>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub surface_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub card_shape: Option<CardShape>,
    /// Continuous squircle corner smoothing, 0 (circular arc) … 100 (squircle).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub corner_smoothing: Option<f64>,
    /// Per-corner radii `[topLeft, topRight, bottomRight, bottomLeft]` in CSS px (0 … 64).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub corner_radii: Option<[f64; 4]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_gradient: Option<GradientSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_image: Option<BackgroundImage>,
    /// 0 (solid) … 100 (clearest glass).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transparency: Option<f64>,
    /// 0 (sharp) … 100 (very soft); 60 is the 1.x look (settings v2, ADR 0012).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blur: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub see: Option<See>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tint_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tint_gradient: Option<GradientSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refraction: Option<f64>,
    /// Refraction band width in CSS px, 0 … 40.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refraction_width: Option<f64>,
    /// Chromatic dispersion at the glass edge, 0 … 100.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dispersion: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rim: Option<f64>,
    /// Specular light angle in degrees clockwise from 12 o'clock (0 … 360, default 315).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub specular_angle: Option<f64>,
    /// Specular rim width in percent (10 … 200, default 100).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub specular_width: Option<f64>,
    /// Inner edge glow strength, 0 … 100.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inner_glow: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grain: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shadow: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shadow_color: Option<String>,
    /// Drop shadow blur radius in CSS px, 0 … 64.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shadow_blur: Option<f64>,
    /// Drop shadow horizontal offset in CSS px, −32 … 32.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shadow_offset_x: Option<f64>,
    /// Drop shadow vertical offset in CSS px, −32 … 32.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shadow_offset_y: Option<f64>,
    /// Drop shadow spread in CSS px, −16 … 32.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shadow_spread: Option<f64>,
    /// Inner shadow strength, 0 … 100.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inner_shadow: Option<f64>,
    /// CSS px, 0 … 8.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_gradient: Option<GradientSpec>,
    /// Outer glow along the border, 0 … 100.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_glow: Option<f64>,
    /// CSS px, 0 … 48; unset follows the size class (28 / 32).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub radius: Option<f64>,
    /// Overall widget opacity, 0 … 100 %.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f64>,

    // Layout
    #[serde(skip_serializing_if = "Option::is_none")]
    pub density: Option<Density>,
    /// Explicit inner padding in CSS px (0 … 48); unset follows size + density.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub padding: Option<f64>,
    /// Explicit gap between rows/elements in CSS px (0 … 32); unset follows density.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gap: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_align: Option<ContentAlign>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header_style: Option<HeaderStyle>,

    // Typography
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number_font_family: Option<String>,
    /// 100 … 1000.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_weight: Option<f64>,
    /// Roboto Flex `wdth`, 25 … 151.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_width: Option<f64>,
    /// 0.75 … 1.5.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_scale: Option<f64>,
    /// em, −0.05 … 0.2.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub letter_spacing: Option<f64>,
    /// Unitless line height, 0.8 … 2.2.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_height: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_case: Option<TextCase>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tabular_numbers: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slashed_zero: Option<bool>,
    /// OpenType stylistic set (`ss01` … `ss20`), 0 = off.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stylistic_set: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub odometer: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_shadow: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vibrancy_text: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uppercase_labels: Option<bool>,
    /// Per-role typography overrides (`hero`, `title`, `label`, `value`, `caption`, `unit`, `accent`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub roles: Option<BTreeMap<TextRole, RoleTypography>>,

    // Icons
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icons: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_set: Option<IconSet>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_fill: Option<bool>,
    /// 100 … 700.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_weight: Option<f64>,
    /// Material Symbols `GRAD` axis, −25 … 200.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_grade: Option<f64>,
    /// Base icon size in CSS px, 10 … 64.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_size: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_color: Option<String>,

    // Hero visuals
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hero_visual: Option<HeroVisual>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hero_options: Option<HeroOptions>,

    // Motion & effects
    #[serde(skip_serializing_if = "Option::is_none")]
    pub animations: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub motion_speed: Option<MotionSpeed>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hover_effect: Option<HoverEffect>,
    /// Scale on press, 0.9 … 1.0 (default 0.97).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub press_scale: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entrance: Option<EntranceEffect>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_animation: Option<ValueAnimation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ambient_motion: Option<bool>,

    // State & behavior
    #[serde(skip_serializing_if = "Option::is_none")]
    pub appearance: Option<AppearanceState>,
    /// 0 … 100: how far Dimmed fades.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dim_level: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hover_lift: Option<bool>,
    /// Adaptive legibility (DESIGN.md §4); off shows a contrast warning instead.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub legibility: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actions: Option<WidgetActions>,
    /// Custom tooltip shown on hover (max 200 characters).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tooltip: Option<String>,
    /// Hide the widget and reflow when empty (e.g. Now Playing with nothing playing).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_hide_empty: Option<bool>,

    // Conditional styles
    /// Ordered "when <expression> → set <style keys>" rules (at most 16).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conditions: Option<Vec<ConditionalStyle>>,
}

pub const MAX_CONDITIONS: usize = 16;
pub const MAX_ELEMENTS_PER_WIDGET: usize = 64;

fn hex_str(s: &str) -> bool {
    let b = s.as_bytes();
    (b.len() == 7 || b.len() == 9) && b[0] == b'#' && b[1..].iter().all(u8::is_ascii_hexdigit)
}

fn hex(c: &Option<String>) -> bool {
    c.as_deref().is_none_or(hex_str)
}

fn range(v: Option<f64>, lo: f64, hi: f64) -> bool {
    v.is_none_or(|x| x.is_finite() && (lo..=hi).contains(&x))
}

/// A font family name as it goes into CSS: printable, no quotes, braces, semicolons or
/// backslashes, at most 100 characters.
fn family(f: &Option<String>) -> bool {
    f.as_deref().is_none_or(|s| {
        !s.trim().is_empty()
            && s.chars().count() <= 100
            && s.chars().all(|c| {
                !c.is_control() && !matches!(c, '"' | '\'' | ';' | '{' | '}' | '\\' | '<' | '>')
            })
    })
}

fn validate_gradient(g: &GradientSpec) -> Result<(), String> {
    if !(2..=4).contains(&g.stops.len()) {
        return Err("style-gradient-stops-count".into());
    }
    if !range(g.angle, 0.0, 360.0) {
        return Err("style-gradient-angle-out-of-range".into());
    }
    for stop in &g.stops {
        if !hex_str(&stop.color) {
            return Err("style-color-not-hex".into());
        }
        if !stop.at.is_finite() || !(0.0..=100.0).contains(&stop.at) {
            return Err("style-gradient-stop-out-of-range".into());
        }
    }
    Ok(())
}

fn validate_bg_image(img: &BackgroundImage) -> Result<(), String> {
    let p = img.path.trim();
    if p.is_empty()
        || p.len() > 256
        || p.contains("..")
        || p.chars()
            .any(|c| c.is_control() || matches!(c, '"' | '\'' | ';' | '{' | '}' | '<' | '>'))
    {
        return Err("style-image-path-invalid".into());
    }
    if p.starts_with("http://") || p.starts_with("https://") || p.starts_with("javascript:") {
        return Err("style-image-remote-not-allowed".into());
    }
    if let Some(pos) = &img.position
        && (pos.len() > 40
            || pos
                .chars()
                .any(|c| c.is_control() || matches!(c, ';' | '{' | '}' | '"' | '\'')))
    {
        return Err("style-image-position-invalid".into());
    }
    if !range(img.blur, 0.0, 100.0) || !range(img.dim, 0.0, 100.0) {
        return Err("style-value-out-of-range".into());
    }
    Ok(())
}

fn validate_role_typography(t: &RoleTypography) -> Result<(), String> {
    if !family(&t.font_family) {
        return Err("style-font-family-invalid".into());
    }
    if !hex(&t.color) {
        return Err("style-color-not-hex".into());
    }
    let ranges = [
        (t.font_weight, 100.0, 1000.0),
        (t.font_width, 25.0, 151.0),
        (t.font_size, 8.0, 180.0),
        (t.letter_spacing, -0.1, 0.5),
        (t.line_height, 0.7, 2.5),
        (t.opacity, 0.0, 100.0),
    ];
    if !ranges.iter().all(|&(v, lo, hi)| range(v, lo, hi)) {
        return Err("style-value-out-of-range".into());
    }
    if t.stylistic_set.is_some_and(|s| s > 20) {
        return Err("style-value-out-of-range".into());
    }
    Ok(())
}

fn validate_hero_options(o: &HeroOptions) -> Result<(), String> {
    if !range(o.thickness, 1.0, 24.0) || !range(o.smoothing, 0.0, 100.0) {
        return Err("style-value-out-of-range".into());
    }
    if o.segments.is_some_and(|s| s > 64) {
        return Err("style-value-out-of-range".into());
    }
    Ok(())
}

fn validate_action(a: &ActionSpec) -> Result<(), String> {
    if let Some(target) = &a.target {
        if target.len() > 256 || target.chars().any(char::is_control) {
            return Err("style-action-target-invalid".into());
        }
        if a.kind == ActionKind::OpenUrl
            && !(target.starts_with("https://") || target.starts_with("http://"))
        {
            return Err("style-action-url-scheme".into());
        }
    }
    if a.delta.is_some_and(|d| !d.is_finite()) {
        return Err("style-value-out-of-range".into());
    }
    Ok(())
}

fn validate_actions(a: &WidgetActions) -> Result<(), String> {
    for spec in [
        &a.click,
        &a.double_click,
        &a.middle_click,
        &a.scroll_up,
        &a.scroll_down,
    ]
    .into_iter()
    .flatten()
    {
        validate_action(spec)?;
    }
    Ok(())
}

fn validate_condition(c: &ConditionalStyle) -> Result<(), String> {
    if c.when.trim().is_empty() {
        return Err("style-condition-empty".into());
    }
    opaline_expr::Program::expression(&c.when).map_err(|e| format!("style-condition-expr: {e}"))?;
    if c.set.contains_key("conditions") {
        return Err("style-condition-nested".into());
    }
    let obj = serde_json::Value::Object(
        c.set
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect(),
    );
    let inner: Style =
        serde_json::from_value(obj).map_err(|e| format!("style-condition-set: {e}"))?;
    inner.validate()
}

impl Style {
    /// The JSON Schema of [`Style`] (`spec/style.schema.json`, ADR 0017).
    pub fn schema() -> serde_json::Value {
        serde_json::Value::from(schemars::schema_for!(Style))
    }

    pub fn validate(&self) -> Result<(), String> {
        let colors = [
            &self.seed_color,
            &self.accent_color,
            &self.text_color,
            &self.secondary_text_color,
            &self.hero_custom_color,
            &self.surface_color,
            &self.tint_color,
            &self.border_color,
            &self.shadow_color,
            &self.icon_color,
        ];
        if !colors.iter().all(|c| hex(c)) {
            return Err("style-color-not-hex".into());
        }
        let ranges = [
            (self.contrast, -1.0, 1.0),
            (self.corner_smoothing, 0.0, 100.0),
            (self.transparency, 0.0, 100.0),
            (self.blur, 0.0, 100.0),
            (self.refraction, 0.0, 100.0),
            (self.refraction_width, 0.0, 40.0),
            (self.dispersion, 0.0, 100.0),
            (self.rim, 0.0, 100.0),
            (self.specular_angle, 0.0, 360.0),
            (self.specular_width, 10.0, 200.0),
            (self.inner_glow, 0.0, 100.0),
            (self.grain, 0.0, 100.0),
            (self.shadow, 0.0, 100.0),
            (self.shadow_blur, 0.0, 64.0),
            (self.shadow_offset_x, -32.0, 32.0),
            (self.shadow_offset_y, -32.0, 32.0),
            (self.shadow_spread, -16.0, 32.0),
            (self.inner_shadow, 0.0, 100.0),
            (self.border_width, 0.0, 8.0),
            (self.border_glow, 0.0, 100.0),
            (self.radius, 0.0, 48.0),
            (self.opacity, 0.0, 100.0),
            (self.padding, 0.0, 48.0),
            (self.gap, 0.0, 32.0),
            (self.font_weight, 100.0, 1000.0),
            (self.font_width, 25.0, 151.0),
            (self.text_scale, 0.75, 1.5),
            (self.letter_spacing, -0.05, 0.2),
            (self.line_height, 0.8, 2.2),
            (self.icon_weight, 100.0, 700.0),
            (self.icon_grade, -25.0, 200.0),
            (self.icon_size, 10.0, 64.0),
            (self.press_scale, 0.9, 1.0),
            (self.dim_level, 0.0, 100.0),
        ];
        if !ranges.iter().all(|&(v, lo, hi)| range(v, lo, hi)) {
            return Err("style-value-out-of-range".into());
        }
        if let Some(radii) = self.corner_radii
            && !radii.iter().all(|&r| r.is_finite() && (0.0..=64.0).contains(&r))
        {
            return Err("style-value-out-of-range".into());
        }
        if self.stylistic_set.is_some_and(|s| s > 20) {
            return Err("style-value-out-of-range".into());
        }
        if !family(&self.font_family) || !family(&self.number_font_family) {
            return Err("style-font-family-invalid".into());
        }
        if let Some(g) = &self.background_gradient {
            validate_gradient(g)?;
        }
        if let Some(g) = &self.tint_gradient {
            validate_gradient(g)?;
        }
        if let Some(g) = &self.border_gradient {
            validate_gradient(g)?;
        }
        if let Some(img) = &self.background_image {
            validate_bg_image(img)?;
        }
        if let Some(roles) = &self.roles {
            for r in roles.values() {
                validate_role_typography(r)?;
            }
        }
        if let Some(hero) = &self.hero_options {
            validate_hero_options(hero)?;
        }
        if let Some(actions) = &self.actions {
            validate_actions(actions)?;
        }
        if let Some(tip) = &self.tooltip
            && (tip.chars().count() > 200 || tip.chars().any(char::is_control))
        {
            return Err("style-tooltip-invalid".into());
        }
        if let Some(conds) = &self.conditions {
            if conds.len() > MAX_CONDITIONS {
                return Err("style-too-many-conditions".into());
            }
            for c in conds {
                validate_condition(c)?;
            }
        }
        Ok(())
    }

    /// Reads a stored style, keeping every field that parses and validates on its own.
    pub fn lenient(json: &serde_json::Value) -> Self {
        Self::lenient_with_problems(json, "").0
    }

    /// Reads a stored style leniently, returning both the sanitized [`Style`] and a list of
    /// `(json_pointer, reason)` problems for dropped keys (used by themes and config watchers).
    pub fn lenient_with_problems(
        json: &serde_json::Value,
        prefix: &str,
    ) -> (Self, Vec<(String, String)>) {
        let Some(map) = json.as_object() else {
            return (Self::default(), Vec::new());
        };
        let mut kept = serde_json::Map::new();
        let mut problems = Vec::new();
        for (k, v) in map {
            let one =
                serde_json::Value::Object(serde_json::Map::from_iter([(k.clone(), v.clone())]));
            match serde_json::from_value::<Style>(one) {
                Ok(s) => match s.validate() {
                    Ok(()) => {
                        kept.insert(k.clone(), v.clone());
                    }
                    Err(reason) => {
                        tracing::warn!(field = %k, %reason, "dropping an invalid style value");
                        problems.push((format!("{prefix}/{k}"), reason));
                    }
                },
                Err(err) => {
                    tracing::warn!(field = %k, %err, "dropping an unparseable style value");
                    problems.push((format!("{prefix}/{k}"), err.to_string()));
                }
            }
        }
        let parsed = serde_json::from_value(serde_json::Value::Object(kept)).unwrap_or_default();
        (parsed, problems)
    }
}

pub const MAX_WIDGETS: usize = 200;
pub const MAX_NAMED_STYLES: usize = 50;
/// Serialized size limit of one widget's `content` (ADR 0011).
pub const MAX_CONTENT_BYTES: usize = 16 * 1024;

/// One placed widget: its kind, own style, per-element style overrides (role or `#block-id`),
/// and content options (validated by the widget's `settingsSchema` in the frontend).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct WidgetConfig {
    pub kind: String,
    pub style: Style,
    /// Per-element overrides keyed by role (`hero`, `label`, …) or block id (`#clock-date`).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub elements: BTreeMap<String, Style>,
    pub content: serde_json::Map<String, serde_json::Value>,
}

pub(crate) fn id_ok(s: &str, max: usize) -> bool {
    !s.is_empty()
        && s.len() <= max
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn element_key_ok(s: &str) -> bool {
    let bare = s.strip_prefix('#').unwrap_or(s);
    id_ok(bare, 64)
}

pub fn validate_widgets(
    widgets: &BTreeMap<String, WidgetConfig>,
    named: &BTreeMap<String, Style>,
) -> Result<(), String> {
    if widgets.len() > MAX_WIDGETS {
        return Err("too-many-widgets".into());
    }
    for (id, w) in widgets {
        if !id_ok(id, 64) || !id_ok(&w.kind, 32) {
            return Err("widget-id-invalid".into());
        }
        w.style.validate()?;
        if w.elements.len() > MAX_ELEMENTS_PER_WIDGET {
            return Err("too-many-element-styles".into());
        }
        for (ek, ev) in &w.elements {
            if !element_key_ok(ek) {
                return Err("element-style-key-invalid".into());
            }
            ev.validate()?;
        }
        let size = serde_json::to_vec(&w.content).map_or(usize::MAX, |v| v.len());
        if size > MAX_CONTENT_BYTES {
            return Err("widget-content-too-large".into());
        }
    }
    if named.len() > MAX_NAMED_STYLES {
        return Err("too-many-named-styles".into());
    }
    for (name, style) in named {
        if name.trim().is_empty() || name.chars().count() > 60 || name.chars().any(char::is_control)
        {
            return Err("style-name-invalid".into());
        }
        style.validate()?;
    }
    Ok(())
}

pub fn validate_kind_styles(kind_styles: &BTreeMap<String, Style>) -> Result<(), String> {
    if kind_styles.len() > MAX_NAMED_STYLES {
        return Err("too-many-kind-styles".into());
    }
    for (kind, style) in kind_styles {
        if !id_ok(kind, 32) {
            return Err("widget-kind-invalid".into());
        }
        style.validate()?;
    }
    Ok(())
}

/// Lenient load of the `style`, `kindStyles`, `styles` and `widgets` parts of a stored settings
/// file: invalid fields and invalid widgets are dropped, everything else is kept. Mutates `json`
/// in place so the normal (strict) deserialisation afterwards succeeds.
pub fn sanitize(json: &mut serde_json::Value) {
    let Some(obj) = json.as_object_mut() else {
        return;
    };
    let clean = |v: &serde_json::Value| serde_json::to_value(Style::lenient(v)).unwrap_or_default();
    if let Some(s) = obj.get("style").cloned() {
        obj.insert("style".into(), clean(&s));
    }
    if let Some(serde_json::Value::Object(kinds)) = obj.get_mut("kindStyles") {
        kinds.retain(|k, _| id_ok(k, 32));
        for v in kinds.values_mut() {
            *v = clean(v);
        }
        while kinds.len() > MAX_NAMED_STYLES {
            let Some(last) = kinds.keys().next_back().cloned() else {
                break;
            };
            kinds.remove(&last);
        }
    } else {
        obj.remove("kindStyles");
    }
    if let Some(serde_json::Value::Object(named)) = obj.get_mut("styles") {
        named.retain(|name, _| !name.trim().is_empty() && name.chars().count() <= 60);
        for v in named.values_mut() {
            *v = clean(v);
        }
        while named.len() > MAX_NAMED_STYLES {
            let Some(last) = named.keys().next_back().cloned() else {
                break;
            };
            named.remove(&last);
        }
    } else {
        obj.remove("styles");
    }
    if let Some(serde_json::Value::Object(widgets)) = obj.get_mut("widgets") {
        widgets.retain(|id, w| {
            let ok = id_ok(id, 64)
                && w.get("kind")
                    .and_then(|k| k.as_str())
                    .is_some_and(|k| id_ok(k, 32))
                && w.get("content").is_none_or(|c| {
                    c.is_object()
                        && serde_json::to_vec(c).is_ok_and(|v| v.len() <= MAX_CONTENT_BYTES)
                });
            if !ok {
                tracing::warn!(widget = %id, "dropping an invalid widget from settings.json");
            }
            ok
        });
        for w in widgets.values_mut() {
            if let Some(s) = w.get("style").cloned() {
                w["style"] = clean(&s);
            }
            if let Some(serde_json::Value::Object(elems)) = w.get_mut("elements") {
                elems.retain(|k, _| element_key_ok(k));
                for ev in elems.values_mut() {
                    *ev = clean(ev);
                }
                while elems.len() > MAX_ELEMENTS_PER_WIDGET {
                    let Some(last) = elems.keys().next_back().cloned() else {
                        break;
                    };
                    elems.remove(&last);
                }
            } else if let Some(m) = w.as_object_mut() {
                m.remove("elements");
            }
        }
        while widgets.len() > MAX_WIDGETS {
            let Some(last) = widgets.keys().next_back().cloned() else {
                break;
            };
            widgets.remove(&last);
        }
    } else {
        obj.remove("widgets");
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use serde_json::json;

    use super::*;

    #[test]
    fn validation() {
        let ok: Style = serde_json::from_value(json!({
            "surface": "color", "surfaceColor": "#1a2b3c", "transparency": 40,
            "fontFamily": "Noto Serif", "textScale": 1.2, "accentColor": "#ff000080",
            "cardShape": "cookie-12-sided", "cornerSmoothing": 60,
            "cornerRadii": [24, 24, 16, 16],
            "dispersion": 30, "specularAngle": 315, "specularWidth": 120, "innerGlow": 25,
            "iconSet": "outlined", "iconGrade": 50,
            "hoverEffect": "tilt", "pressScale": 0.96,
            "roles": { "hero": { "fontWeight": 780, "fontWidth": 30, "slashedZero": true } },
            "conditions": [{ "when": "cpu.temp >= 85", "set": { "borderColor": "#ff3b30", "cardShape": "burst" } }]
        }))
        .unwrap();
        assert_eq!(ok.validate(), Ok(()));
        let bad = |v: serde_json::Value| serde_json::from_value::<Style>(v).map(|s| s.validate());
        assert_eq!(
            bad(json!({"transparency": 101})).unwrap(),
            Err("style-value-out-of-range".into())
        );
        assert_eq!(
            bad(json!({"textColor": "red"})).unwrap(),
            Err("style-color-not-hex".into())
        );
        assert_eq!(
            bad(json!({"fontFamily": "x\"; } body { color: red"})).unwrap(),
            Err("style-font-family-invalid".into())
        );
        assert!(
            bad(json!({"surface": "chrome"})).is_err(),
            "unknown enum values are rejected"
        );
        assert!(
            bad(json!({"backgroundImage": {"path": "https://evil.example/bg.png"}}))
                .unwrap()
                .is_err(),
            "remote image URLs are rejected"
        );
        assert!(
            bad(json!({"backgroundImage": {"path": "../secret.png"}}))
                .unwrap()
                .is_err(),
            "path traversal is rejected"
        );
        assert!(
            bad(json!({"conditions": [{"when": "cpu.temp >=", "set": {}}]}))
                .unwrap()
                .is_err(),
            "invalid condition expression is rejected"
        );
        assert!(
            bad(json!({"conditions": [{"when": "true", "set": {"conditions": []}}]}))
                .unwrap()
                .is_err(),
            "nested conditions are rejected"
        );
        assert!(
            bad(json!({"actions": {"click": {"kind": "open-url", "target": "javascript:alert(1)"}}}))
                .unwrap()
                .is_err(),
            "non-http(s) action URLs are rejected"
        );
        let empty = serde_json::to_value(Style::default()).unwrap();
        assert_eq!(empty, json!({}), "unset fields are not written");
    }

    #[test]
    fn lenient_keeps_good_fields() {
        let (s, probs) = Style::lenient_with_problems(
            &json!({"blur": 30, "radius": 900, "surface": "chrome", "icons": false}),
            "/style",
        );
        assert_eq!(s.blur, Some(30.0));
        assert_eq!(s.icons, Some(false));
        assert_eq!(s.radius, None);
        assert_eq!(s.surface, None);
        assert_eq!(probs.len(), 2);
        assert!(probs.iter().any(|(at, _)| at == "/style/radius"));
        assert!(probs.iter().any(|(at, _)| at == "/style/surface"));
    }

    #[test]
    fn sanitize_drops_only_what_is_broken() {
        let mut j = json!({
            "style": {"blur": 50, "shadow": -3},
            "kindStyles": {"cpu": {"dispersion": 40, "opacity": 200}, "bad kind!": {"blur": 10}},
            "styles": {"Night": {"theme": "dark", "grain": "lots"}},
            "widgets": {
                "cpu-1": {
                    "kind": "cpu",
                    "style": {"textScale": 9},
                    "elements": {"hero": {"fontWeight": 800}, "bad!": {"blur": 10}},
                    "content": {"fields": ["load"]}
                },
                "bad id!": {"kind": "cpu"},
                "x": {"kind": "clock", "content": "not an object"}
            }
        });
        sanitize(&mut j);
        assert_eq!(j["style"], json!({"blur": 50.0}));
        assert_eq!(j["kindStyles"]["cpu"], json!({"dispersion": 40.0}));
        assert!(j["kindStyles"].get("bad kind!").is_none());
        assert_eq!(j["styles"]["Night"], json!({"theme": "dark"}));
        assert_eq!(j["widgets"]["cpu-1"]["style"], json!({}));
        assert_eq!(
            j["widgets"]["cpu-1"]["elements"]["hero"],
            json!({"fontWeight": 800.0})
        );
        assert!(j["widgets"]["cpu-1"]["elements"].get("bad!").is_none());
        assert_eq!(
            j["widgets"]["cpu-1"]["content"],
            json!({"fields": ["load"]})
        );
        assert!(j["widgets"].get("bad id!").is_none());
        assert!(j["widgets"].get("x").is_none());
    }

    #[test]
    fn widget_limits() {
        let mut w = BTreeMap::new();
        w.insert(
            "clock-1".to_owned(),
            WidgetConfig {
                kind: "clock".into(),
                ..Default::default()
            },
        );
        assert_eq!(validate_widgets(&w, &BTreeMap::new()), Ok(()));
        let big =
            serde_json::Map::from_iter([("t".to_owned(), json!("x".repeat(MAX_CONTENT_BYTES)))]);
        w.insert(
            "clock-2".to_owned(),
            WidgetConfig {
                kind: "clock".into(),
                content: big,
                ..Default::default()
            },
        );
        assert_eq!(
            validate_widgets(&w, &BTreeMap::new()),
            Err("widget-content-too-large".into())
        );
    }
}

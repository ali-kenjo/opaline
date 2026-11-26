// Every style setting, described once: the settings sheet / inspector is built from this list and
// stored styles are checked against it (same ranges as core's `style.rs`, enforced by ADR 0017).
import type { ResolvedStyle, StyleKey } from "./types";

export type StyleGroup = "color" | "surface" | "text" | "icons" | "motion" | "state";

export const STYLE_GROUPS: readonly { id: StyleGroup; label: string; icon: string }[] = [
  { id: "color", label: "Color", icon: "palette" },
  { id: "surface", label: "Surface", icon: "layers" },
  { id: "text", label: "Text", icon: "text_fields" },
  { id: "icons", label: "Icons", icon: "interests" },
  { id: "motion", label: "Motion", icon: "animation" },
  { id: "state", label: "Behavior", icon: "tune" },
];

interface Base<K extends StyleKey> {
  key: K;
  group: StyleGroup;
  label: string;
  help?: string;
  /** Show the row only when this holds for the resolved style. */
  when?: (s: ResolvedStyle) => boolean;
}

export type StyleField =
  | (Base<StyleKey> & { kind: "enum"; options: readonly { value: string; label: string }[] })
  | (Base<StyleKey> & {
      kind: "range";
      min: number;
      max: number;
      step: number;
      unit?: string;
      /** Shown at the ends of the slider. */
      ends?: readonly [string, string];
    })
  | (Base<StyleKey> & { kind: "color"; nullLabel: string })
  | (Base<StyleKey> & { kind: "bool" })
  | (Base<StyleKey> & { kind: "font" })
  | (Base<StyleKey> & {
      kind: "optional-range";
      min: number;
      max: number;
      step: number;
      unit: string;
      nullLabel: string;
    })
  | (Base<StyleKey> & { kind: "text"; maxLength: number })
  | (Base<StyleKey> & { kind: "structured"; validate: (v: unknown) => boolean });

const HEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
const BAD_FAMILY = /["';{}\\<>\p{Cc}]/u;
const BAD_CTRL = /\p{Cc}/u;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const inRange = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const optRange = (v: unknown, lo: number, hi: number): boolean =>
  v === undefined || inRange(v, lo, hi);
const optHex = (v: unknown): boolean => v === undefined || (typeof v === "string" && HEX.test(v));
const optBool = (v: unknown): boolean => v === undefined || typeof v === "boolean";
const isFamily = (v: unknown): boolean =>
  typeof v === "string" && v.trim() !== "" && Array.from(v).length <= 100 && !BAD_FAMILY.test(v);

function validGradient(v: unknown): boolean {
  if (!isObj(v)) return false;
  if (v.kind !== "linear" && v.kind !== "radial" && v.kind !== "conic") return false;
  if (!optRange(v.angle, 0, 360)) return false;
  if (!Array.isArray(v.stops) || v.stops.length < 2 || v.stops.length > 4) return false;
  return v.stops.every(
    (s) => isObj(s) && typeof s.color === "string" && HEX.test(s.color) && inRange(s.at, 0, 100),
  );
}

function validBackgroundImage(v: unknown): boolean {
  if (!isObj(v) || typeof v.path !== "string") return false;
  const p = v.path.trim();
  if (!p || p.length > 256 || p.includes("..") || /["';{}<>\p{Cc}]/u.test(p)) return false;
  if (p.startsWith("http://") || p.startsWith("https://") || p.startsWith("javascript:"))
    return false;
  if (v.fit !== undefined && v.fit !== "cover" && v.fit !== "contain" && v.fit !== "fill")
    return false;
  if (
    v.position !== undefined &&
    (typeof v.position !== "string" || v.position.length > 40 || /[;{}'"\p{Cc}]/u.test(v.position))
  )
    return false;
  return optRange(v.blur, 0, 100) && optRange(v.dim, 0, 100);
}

function validCornerRadii(v: unknown): boolean {
  return Array.isArray(v) && v.length === 4 && v.every((r) => inRange(r, 0, 64));
}

const TEXT_ROLES = new Set(["hero", "title", "label", "value", "caption", "unit", "accent"]);
const TEXT_CASES = new Set(["none", "uppercase", "lowercase", "capitalize"]);

function validRoles(v: unknown): boolean {
  if (!isObj(v)) return false;
  for (const [role, spec] of Object.entries(v)) {
    if (!TEXT_ROLES.has(role) || !isObj(spec)) return false;
    if (spec.fontFamily !== undefined && !isFamily(spec.fontFamily)) return false;
    if (!optRange(spec.fontWeight, 100, 1000)) return false;
    if (!optRange(spec.fontWidth, 25, 151)) return false;
    if (!optRange(spec.fontSize, 8, 180)) return false;
    if (!optRange(spec.letterSpacing, -0.1, 0.5)) return false;
    if (
      spec.textCase !== undefined &&
      (typeof spec.textCase !== "string" || !TEXT_CASES.has(spec.textCase))
    )
      return false;
    if (!optRange(spec.lineHeight, 0.7, 2.5)) return false;
    if (!optHex(spec.color)) return false;
    if (!optRange(spec.opacity, 0, 100)) return false;
    if (!optBool(spec.tabularNumbers) || !optBool(spec.slashedZero)) return false;
    if (
      spec.stylisticSet !== undefined &&
      (!inRange(spec.stylisticSet, 0, 20) || !Number.isInteger(spec.stylisticSet))
    )
      return false;
  }
  return true;
}

function validHeroOptions(v: unknown): boolean {
  if (!isObj(v)) return false;
  if (!optRange(v.thickness, 1, 24) || !optRange(v.smoothing, 0, 100)) return false;
  if (v.cap !== undefined && v.cap !== "round" && v.cap !== "butt") return false;
  if (v.segments !== undefined && (!inRange(v.segments, 0, 64) || !Number.isInteger(v.segments)))
    return false;
  return (
    optBool(v.track) &&
    optBool(v.wave) &&
    optBool(v.gradient) &&
    optBool(v.ticks) &&
    optBool(v.needle) &&
    optBool(v.fill)
  );
}

const ACTION_KINDS = new Set([
  "none",
  "detail",
  "open-app",
  "open-url",
  "command",
  "toggle",
  "step",
]);

function validActionSpec(v: unknown): boolean {
  if (!isObj(v) || typeof v.kind !== "string" || !ACTION_KINDS.has(v.kind)) return false;
  if (v.target !== undefined) {
    if (typeof v.target !== "string" || v.target.length > 256 || BAD_CTRL.test(v.target))
      return false;
    if (
      v.kind === "open-url" &&
      !v.target.startsWith("https://") &&
      !v.target.startsWith("http://")
    )
      return false;
  }
  if (v.delta !== undefined && (typeof v.delta !== "number" || !Number.isFinite(v.delta)))
    return false;
  return true;
}

function validActions(v: unknown): boolean {
  if (!isObj(v)) return false;
  for (const k of ["click", "doubleClick", "middleClick", "scrollUp", "scrollDown"]) {
    if (v[k] !== undefined && !validActionSpec(v[k])) return false;
  }
  return true;
}

function validConditions(v: unknown): boolean {
  if (!Array.isArray(v) || v.length > 16) return false;
  return v.every(
    (c) =>
      isObj(c) &&
      typeof c.when === "string" &&
      c.when.trim() !== "" &&
      isObj(c.set) &&
      !("conditions" in c.set) &&
      optBool(c.animate),
  );
}

const CARD_SHAPE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "rounded-rect", label: "Rounded rectangle" },
  { value: "circle", label: "Circle" },
  { value: "square", label: "Squircle" },
  { value: "slanted", label: "Slanted" },
  { value: "arch", label: "Arch" },
  { value: "fan", label: "Fan" },
  { value: "arrow", label: "Arrow" },
  { value: "semi-circle", label: "Semi-circle" },
  { value: "oval", label: "Oval" },
  { value: "pill", label: "Pill" },
  { value: "triangle", label: "Triangle" },
  { value: "diamond", label: "Diamond" },
  { value: "clam-shell", label: "Clam shell" },
  { value: "pentagon", label: "Pentagon" },
  { value: "gem", label: "Gem" },
  { value: "sunny", label: "Sunny" },
  { value: "very-sunny", label: "Very sunny" },
  { value: "cookie-4-sided", label: "4-sided cookie" },
  { value: "cookie-6-sided", label: "6-sided cookie" },
  { value: "cookie-7-sided", label: "7-sided cookie" },
  { value: "cookie-9-sided", label: "9-sided cookie" },
  { value: "cookie-12-sided", label: "12-sided cookie" },
  { value: "ghostish", label: "Ghostish" },
  { value: "clover-4-leaf", label: "4-leaf clover" },
  { value: "clover-8-leaf", label: "8-leaf clover" },
  { value: "burst", label: "Burst" },
  { value: "soft-burst", label: "Soft burst" },
  { value: "boom", label: "Boom" },
  { value: "soft-boom", label: "Soft boom" },
  { value: "flower", label: "Flower" },
  { value: "puffy", label: "Puffy" },
  { value: "puffy-diamond", label: "Puffy diamond" },
  { value: "pixel-circle", label: "Pixel circle" },
  { value: "pixel-triangle", label: "Pixel triangle" },
  { value: "bun", label: "Bun" },
  { value: "heart", label: "Heart" },
];

export const STYLE_FIELDS: readonly StyleField[] = [
  // Color
  {
    key: "colorSource",
    group: "color",
    label: "Colors from",
    kind: "enum",
    options: [
      { value: "wallpaper", label: "Wallpaper" },
      { value: "accent", label: "System accent" },
      { value: "custom", label: "Custom color" },
    ],
  },
  {
    key: "seedColor",
    group: "color",
    label: "Custom color",
    kind: "color",
    nullLabel: "Not set",
    when: (s) => s.colorSource === "custom",
  },
  {
    key: "variant",
    group: "color",
    label: "Color style",
    kind: "enum",
    options: [
      { value: "tonal-spot", label: "Tonal spot" },
      { value: "vibrant", label: "Vibrant" },
      { value: "expressive", label: "Expressive" },
      { value: "fidelity", label: "Fidelity" },
      { value: "neutral", label: "Neutral" },
      { value: "monochrome", label: "Monochrome" },
    ],
  },
  {
    key: "contrast",
    group: "color",
    label: "Contrast",
    kind: "range",
    min: -1,
    max: 1,
    step: 0.1,
    ends: ["Lower", "Higher"],
  },
  {
    key: "theme",
    group: "color",
    label: "Light or dark",
    kind: "enum",
    options: [
      { value: "auto", label: "Follow system" },
      { value: "light", label: "Light" },
      { value: "dark", label: "Dark" },
    ],
  },
  { key: "accentColor", group: "color", label: "Accent", kind: "color", nullLabel: "From colors" },
  { key: "textColor", group: "color", label: "Text", kind: "color", nullLabel: "From colors" },
  {
    key: "secondaryTextColor",
    group: "color",
    label: "Secondary text",
    kind: "color",
    nullLabel: "From colors",
  },
  {
    key: "heroColor",
    group: "color",
    label: "Main visual",
    help: "The ring, bar or graph that carries the widget's value.",
    kind: "enum",
    options: [
      { value: "ramp", label: "By value (cool → hot)" },
      { value: "accent", label: "Accent" },
      { value: "custom", label: "Custom color" },
    ],
  },
  {
    key: "heroCustomColor",
    group: "color",
    label: "Main visual color",
    kind: "color",
    nullLabel: "Not set",
    when: (s) => s.heroColor === "custom",
  },

  // Surface & Glass 2.0
  {
    key: "surface",
    group: "surface",
    label: "Background",
    kind: "enum",
    options: [
      { value: "glass", label: "Glass" },
      { value: "tinted", label: "Tinted glass" },
      { value: "clear", label: "Transparent (frameless)" },
      { value: "opaque", label: "Solid" },
      { value: "color", label: "Custom color" },
      { value: "gradient", label: "Gradient" },
      { value: "image", label: "Image" },
      { value: "album-art", label: "Album art" },
    ],
  },
  {
    key: "surfaceColor",
    group: "surface",
    label: "Background color",
    kind: "color",
    nullLabel: "Not set",
    when: (s) => s.surface === "color",
  },
  {
    key: "cardShape",
    group: "surface",
    label: "Card shape",
    kind: "enum",
    options: CARD_SHAPE_OPTIONS,
  },
  {
    key: "cornerSmoothing",
    group: "surface",
    label: "Corner smoothing",
    kind: "range",
    min: 0,
    max: 100,
    step: 5,
    unit: "%",
    when: (s) => s.cardShape === "rounded-rect",
  },
  {
    key: "cornerRadii",
    group: "surface",
    label: "Per-corner radii",
    kind: "structured",
    validate: validCornerRadii,
  },
  {
    key: "backgroundGradient",
    group: "surface",
    label: "Background gradient",
    kind: "structured",
    validate: validGradient,
  },
  {
    key: "backgroundImage",
    group: "surface",
    label: "Background image",
    kind: "structured",
    validate: validBackgroundImage,
  },
  {
    key: "tintColor",
    group: "surface",
    label: "Glass tint",
    kind: "color",
    nullLabel: "From colors",
    when: (s) => s.surface === "glass" || s.surface === "tinted",
  },
  {
    key: "tintGradient",
    group: "surface",
    label: "Tint gradient",
    kind: "structured",
    validate: validGradient,
  },
  {
    key: "transparency",
    group: "surface",
    label: "Transparency",
    kind: "range",
    min: 0,
    max: 100,
    step: 1,
    unit: "%",
    ends: ["Solid", "Clear"],
    when: (s) => s.surface !== "opaque" && s.surface !== "clear",
  },
  {
    key: "see",
    group: "surface",
    label: "Shows through",
    kind: "enum",
    options: [
      { value: "wallpaper", label: "Wallpaper" },
      { value: "real", label: "Real transparency (desktop icons show)" },
    ],
    when: (s) => s.surface !== "opaque" && s.surface !== "clear",
  },
  {
    key: "blur",
    group: "surface",
    label: "Blur",
    kind: "range",
    min: 0,
    max: 100,
    step: 1,
    unit: "%",
    ends: ["Sharp", "Soft"],
    when: (s) => s.surface !== "opaque" && s.surface !== "clear" && s.see !== "real",
  },
  {
    key: "refraction",
    group: "surface",
    label: "Edge refraction",
    kind: "range",
    min: 0,
    max: 100,
    step: 1,
    unit: "%",
    when: (s) => s.surface !== "opaque" && s.surface !== "clear",
  },
  {
    key: "refractionWidth",
    group: "surface",
    label: "Refraction width",
    kind: "range",
    min: 0,
    max: 40,
    step: 1,
    unit: "px",
    when: (s) => s.surface !== "opaque" && s.surface !== "clear" && s.refraction > 0,
  },
  {
    key: "dispersion",
    group: "surface",
    label: "Edge dispersion",
    kind: "range",
    min: 0,
    max: 100,
    step: 1,
    unit: "%",
    when: (s) => s.surface !== "opaque" && s.surface !== "clear",
  },
  {
    key: "rim",
    group: "surface",
    label: "Edge highlight",
    kind: "range",
    min: 0,
    max: 100,
    step: 1,
    unit: "%",
    when: (s) => s.surface !== "clear",
  },
  {
    key: "specularAngle",
    group: "surface",
    label: "Highlight angle",
    kind: "range",
    min: 0,
    max: 360,
    step: 5,
    unit: "°",
    when: (s) => s.surface !== "clear" && s.rim > 0,
  },
  {
    key: "specularWidth",
    group: "surface",
    label: "Highlight width",
    kind: "range",
    min: 10,
    max: 200,
    step: 5,
    unit: "%",
    when: (s) => s.surface !== "clear" && s.rim > 0,
  },
  {
    key: "innerGlow",
    group: "surface",
    label: "Inner glow",
    kind: "range",
    min: 0,
    max: 100,
    step: 1,
    unit: "%",
    when: (s) => s.surface !== "clear",
  },
  {
    key: "grain",
    group: "surface",
    label: "Grain",
    kind: "range",
    min: 0,
    max: 100,
    step: 1,
    unit: "%",
    when: (s) => s.surface !== "clear",
  },
  {
    key: "shadow",
    group: "surface",
    label: "Shadow",
    kind: "range",
    min: 0,
    max: 100,
    step: 1,
    unit: "%",
    when: (s) => s.surface !== "clear",
  },
  {
    key: "shadowColor",
    group: "surface",
    label: "Shadow color",
    kind: "color",
    nullLabel: "Default black",
    when: (s) => s.surface !== "clear" && s.shadow > 0,
  },
  {
    key: "shadowBlur",
    group: "surface",
    label: "Shadow blur",
    kind: "range",
    min: 0,
    max: 64,
    step: 1,
    unit: "px",
    when: (s) => s.surface !== "clear" && s.shadow > 0,
  },
  {
    key: "shadowOffsetX",
    group: "surface",
    label: "Shadow X offset",
    kind: "range",
    min: -32,
    max: 32,
    step: 1,
    unit: "px",
    when: (s) => s.surface !== "clear" && s.shadow > 0,
  },
  {
    key: "shadowOffsetY",
    group: "surface",
    label: "Shadow Y offset",
    kind: "range",
    min: -32,
    max: 32,
    step: 1,
    unit: "px",
    when: (s) => s.surface !== "clear" && s.shadow > 0,
  },
  {
    key: "shadowSpread",
    group: "surface",
    label: "Shadow spread",
    kind: "range",
    min: -16,
    max: 32,
    step: 1,
    unit: "px",
    when: (s) => s.surface !== "clear" && s.shadow > 0,
  },
  {
    key: "innerShadow",
    group: "surface",
    label: "Inner shadow",
    kind: "range",
    min: 0,
    max: 100,
    step: 1,
    unit: "%",
    when: (s) => s.surface !== "clear",
  },
  {
    key: "borderWidth",
    group: "surface",
    label: "Border",
    kind: "range",
    min: 0,
    max: 8,
    step: 0.5,
    unit: "px",
  },
  {
    key: "borderColor",
    group: "surface",
    label: "Border color",
    kind: "color",
    nullLabel: "From colors",
    when: (s) => s.borderWidth > 0,
  },
  {
    key: "borderGradient",
    group: "surface",
    label: "Border gradient",
    kind: "structured",
    validate: validGradient,
  },
  {
    key: "borderGlow",
    group: "surface",
    label: "Border glow",
    kind: "range",
    min: 0,
    max: 100,
    step: 1,
    unit: "%",
    when: (s) => s.borderWidth > 0,
  },
  {
    key: "radius",
    group: "surface",
    label: "Corner radius",
    kind: "optional-range",
    min: 0,
    max: 48,
    step: 1,
    unit: "px",
    nullLabel: "Follow size",
  },
  {
    key: "opacity",
    group: "surface",
    label: "Opacity",
    kind: "range",
    min: 0,
    max: 100,
    step: 1,
    unit: "%",
  },
  {
    key: "density",
    group: "surface",
    label: "Spacing",
    kind: "enum",
    options: [
      { value: "compact", label: "Compact" },
      { value: "comfortable", label: "Comfortable" },
      { value: "spacious", label: "Spacious" },
    ],
  },
  {
    key: "padding",
    group: "surface",
    label: "Padding",
    kind: "optional-range",
    min: 0,
    max: 48,
    step: 2,
    unit: "px",
    nullLabel: "Follow spacing",
  },
  {
    key: "gap",
    group: "surface",
    label: "Gap",
    kind: "optional-range",
    min: 0,
    max: 32,
    step: 2,
    unit: "px",
    nullLabel: "Follow spacing",
  },
  {
    key: "contentAlign",
    group: "surface",
    label: "Alignment",
    kind: "enum",
    options: [
      { value: "start", label: "Start" },
      { value: "center", label: "Center" },
      { value: "end", label: "End" },
      { value: "stretch", label: "Stretch" },
    ],
  },
  {
    key: "headerStyle",
    group: "surface",
    label: "Header",
    kind: "enum",
    options: [
      { value: "icon-title", label: "Icon and title" },
      { value: "title", label: "Title only" },
      { value: "icon", label: "Icon only" },
      { value: "none", label: "None" },
    ],
  },

  // Text
  { key: "fontFamily", group: "text", label: "Font", kind: "font" },
  { key: "numberFontFamily", group: "text", label: "Number font", kind: "font" },
  {
    key: "fontWeight",
    group: "text",
    label: "Weight",
    kind: "range",
    min: 100,
    max: 1000,
    step: 50,
    ends: ["Thin", "Black"],
  },
  {
    key: "fontWidth",
    group: "text",
    label: "Width",
    help: "For fonts with a width axis, like Roboto Flex.",
    kind: "range",
    min: 25,
    max: 151,
    step: 1,
    ends: ["Narrow", "Wide"],
  },
  {
    key: "textScale",
    group: "text",
    label: "Text size",
    kind: "range",
    min: 0.75,
    max: 1.5,
    step: 0.05,
    unit: "×",
  },
  {
    key: "letterSpacing",
    group: "text",
    label: "Letter spacing",
    kind: "range",
    min: -0.05,
    max: 0.2,
    step: 0.01,
    unit: "em",
  },
  {
    key: "lineHeight",
    group: "text",
    label: "Line height",
    kind: "range",
    min: 0.8,
    max: 2.2,
    step: 0.05,
  },
  {
    key: "textCase",
    group: "text",
    label: "Text case",
    kind: "enum",
    options: [
      { value: "none", label: "Normal" },
      { value: "uppercase", label: "UPPERCASE" },
      { value: "lowercase", label: "lowercase" },
      { value: "capitalize", label: "Title Case" },
    ],
  },
  { key: "tabularNumbers", group: "text", label: "Even-width digits", kind: "bool" },
  { key: "slashedZero", group: "text", label: "Slashed zero", kind: "bool" },
  {
    key: "stylisticSet",
    group: "text",
    label: "Stylistic set",
    kind: "range",
    min: 0,
    max: 20,
    step: 1,
  },
  { key: "odometer", group: "text", label: "Rolling numbers", kind: "bool" },
  { key: "uppercaseLabels", group: "text", label: "Uppercase labels", kind: "bool" },
  { key: "textShadow", group: "text", label: "Text shadow", kind: "bool" },
  { key: "vibrancyText", group: "text", label: "Backdrop vibrancy", kind: "bool" },
  {
    key: "roles",
    group: "text",
    label: "Per-role typography",
    kind: "structured",
    validate: validRoles,
  },

  // Icons
  { key: "icons", group: "icons", label: "Show icons", kind: "bool" },
  {
    key: "iconSet",
    group: "icons",
    label: "Icon style",
    kind: "enum",
    options: [
      { value: "rounded", label: "Rounded" },
      { value: "outlined", label: "Outlined" },
      { value: "sharp", label: "Sharp" },
      { value: "none", label: "None" },
    ],
    when: (s) => s.icons,
  },
  { key: "iconFill", group: "icons", label: "Filled icons", kind: "bool", when: (s) => s.icons },
  {
    key: "iconWeight",
    group: "icons",
    label: "Icon weight",
    kind: "range",
    min: 100,
    max: 700,
    step: 100,
    when: (s) => s.icons,
  },
  {
    key: "iconGrade",
    group: "icons",
    label: "Icon grade",
    kind: "range",
    min: -25,
    max: 200,
    step: 25,
    when: (s) => s.icons,
  },
  {
    key: "iconSize",
    group: "icons",
    label: "Icon size",
    kind: "range",
    min: 10,
    max: 64,
    step: 2,
    unit: "px",
    when: (s) => s.icons,
  },
  {
    key: "iconColor",
    group: "icons",
    label: "Icon color",
    kind: "color",
    nullLabel: "From text",
    when: (s) => s.icons,
  },
  {
    key: "heroVisual",
    group: "icons",
    label: "Hero visual",
    kind: "enum",
    options: [
      { value: "auto", label: "Automatic" },
      { value: "ring", label: "Ring" },
      { value: "gauge", label: "Gauge" },
      { value: "bar", label: "Bar" },
      { value: "chart", label: "Chart" },
      { value: "number", label: "Number" },
      { value: "shape-badge", label: "Shape badge" },
      { value: "liquid-fill", label: "Liquid fill" },
      { value: "dot-matrix", label: "Dot matrix" },
    ],
  },
  {
    key: "heroOptions",
    group: "icons",
    label: "Hero visual options",
    kind: "structured",
    validate: validHeroOptions,
  },

  // Motion & effects
  { key: "animations", group: "motion", label: "Animations", kind: "bool" },
  {
    key: "motionSpeed",
    group: "motion",
    label: "Speed",
    kind: "enum",
    options: [
      { value: "slow", label: "Calm" },
      { value: "default", label: "Standard" },
      { value: "fast", label: "Snappy" },
    ],
    when: (s) => s.animations,
  },
  {
    key: "hoverEffect",
    group: "motion",
    label: "Hover effect",
    kind: "enum",
    options: [
      { value: "lift", label: "Lift" },
      { value: "tilt", label: "3D tilt" },
      { value: "glow", label: "Glow" },
      { value: "none", label: "None" },
    ],
  },
  {
    key: "pressScale",
    group: "motion",
    label: "Press scale",
    kind: "range",
    min: 0.9,
    max: 1.0,
    step: 0.01,
  },
  {
    key: "entrance",
    group: "motion",
    label: "Entrance",
    kind: "enum",
    options: [
      { value: "spring", label: "Spring" },
      { value: "fade", label: "Fade" },
      { value: "none", label: "None" },
    ],
    when: (s) => s.animations,
  },
  {
    key: "valueAnimation",
    group: "motion",
    label: "Value transition",
    kind: "enum",
    options: [
      { value: "odometer", label: "Odometer" },
      { value: "fade", label: "Fade" },
      { value: "none", label: "None" },
    ],
    when: (s) => s.animations,
  },
  {
    key: "ambientMotion",
    group: "motion",
    label: "Ambient motion",
    kind: "bool",
    when: (s) => s.animations,
  },

  // Behavior & conditional
  {
    key: "appearance",
    group: "state",
    label: "Appearance",
    help: "Automatic dims widgets while you work and brings them back on the desktop.",
    kind: "enum",
    options: [
      { value: "automatic", label: "Automatic" },
      { value: "full", label: "Always full" },
      { value: "dimmed", label: "Always dimmed" },
    ],
  },
  {
    key: "dimLevel",
    group: "state",
    label: "Dim level",
    kind: "range",
    min: 0,
    max: 100,
    step: 5,
    unit: "%",
    when: (s) => s.appearance !== "full",
  },
  { key: "hoverLift", group: "state", label: "Lift on hover", kind: "bool" },
  {
    key: "legibility",
    group: "state",
    label: "Keep text readable",
    help: "Darkens or lightens the glass when the wallpaper behind would make text hard to read.",
    kind: "bool",
  },
  {
    key: "autoHideEmpty",
    group: "state",
    label: "Hide when empty",
    help: "Automatically hides the widget and reflows neighbors when it has nothing to show.",
    kind: "bool",
  },
  { key: "tooltip", group: "state", label: "Tooltip", kind: "text", maxLength: 200 },
  {
    key: "actions",
    group: "state",
    label: "Click & scroll actions",
    kind: "structured",
    validate: validActions,
  },
  {
    key: "conditions",
    group: "state",
    label: "Conditional styles",
    kind: "structured",
    validate: validConditions,
  },
];

/** Whether a single stored value is valid for its field (mirrors `Style::validate`). */
export function validValue(field: StyleField, value: unknown): boolean {
  switch (field.kind) {
    case "enum":
      return field.options.some((o) => o.value === value);
    case "range":
    case "optional-range":
      return inRange(value, field.min, field.max);
    case "color":
      return typeof value === "string" && HEX.test(value);
    case "bool":
      return typeof value === "boolean";
    case "font":
      return isFamily(value);
    case "text":
      return (
        typeof value === "string" &&
        Array.from(value).length <= field.maxLength &&
        !BAD_CTRL.test(value)
      );
    case "structured":
      return field.validate(value);
  }
}

export const FIELD_BY_KEY: ReadonlyMap<StyleKey, StyleField> = new Map(
  STYLE_FIELDS.map((f) => [f.key, f]),
);

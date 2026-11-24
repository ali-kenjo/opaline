// Every style setting, described once: the generic settings sheet is built from this list and
// stored styles are checked against it (the same ranges as core's `style.rs`).
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
    });

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

  // Surface
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
    key: "tintColor",
    group: "surface",
    label: "Glass tint",
    kind: "color",
    nullLabel: "From colors",
    when: (s) => s.surface === "glass" || s.surface === "tinted",
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
    key: "blur",
    group: "surface",
    label: "Extra blur",
    kind: "range",
    min: 0,
    max: 100,
    step: 1,
    unit: "%",
    when: (s) => s.surface !== "opaque" && s.surface !== "clear",
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
    key: "borderWidth",
    group: "surface",
    label: "Border",
    kind: "range",
    min: 0,
    max: 4,
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
  { key: "tabularNumbers", group: "text", label: "Even-width digits", kind: "bool" },
  { key: "odometer", group: "text", label: "Rolling numbers", kind: "bool" },
  { key: "uppercaseLabels", group: "text", label: "Uppercase labels", kind: "bool" },
  { key: "textShadow", group: "text", label: "Text shadow", kind: "bool" },

  // Icons
  { key: "icons", group: "icons", label: "Show icons", kind: "bool" },
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

  // Motion
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

  // Behavior
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
];

const HEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
const BAD_FAMILY = /["';{}\\<>\p{Cc}]/u;

/** Whether a single stored value is valid for its field (mirrors `Style::validate`). */
export function validValue(field: StyleField, value: unknown): boolean {
  switch (field.kind) {
    case "enum":
      return field.options.some((o) => o.value === value);
    case "range":
    case "optional-range":
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= field.min &&
        value <= field.max
      );
    case "color":
      return typeof value === "string" && HEX.test(value);
    case "bool":
      return typeof value === "boolean";
    case "font":
      return (
        typeof value === "string" &&
        value.trim() !== "" &&
        Array.from(value).length <= 100 &&
        !BAD_FAMILY.test(value)
      );
  }
}

export const FIELD_BY_KEY: ReadonlyMap<StyleKey, StyleField> = new Map(
  STYLE_FIELDS.map((f) => [f.key, f]),
);

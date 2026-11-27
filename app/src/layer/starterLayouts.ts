// Starter layouts for each of the ten built-in looks (PLAN-2 4.15, DESIGN-2 §11).
// Each look defines its curated widget set, size classes, and signature widget content defaults
// (clock face, CPU hero visual, media look, visualizer style).
import type { SizeClass } from "../design-system/tokens/tokens";
import type { Json } from "../widgets/json";

export type BuiltinLookId =
  | "opaline"
  | "crystal"
  | "bloom"
  | "instrument"
  | "air"
  | "terminal"
  | "neon"
  | "paper"
  | "mono"
  | "classic";

export const BUILTIN_LOOK_IDS: readonly BuiltinLookId[] = [
  "opaline",
  "crystal",
  "bloom",
  "instrument",
  "air",
  "terminal",
  "neon",
  "paper",
  "mono",
  "classic",
];

export interface StarterWidgetEntry {
  kind: string;
  size: SizeClass;
  content?: Record<string, Json>;
}

export interface LookStarterLayout {
  themeId: BuiltinLookId;
  name: string;
  tagline: string;
  entries: readonly StarterWidgetEntry[];
}

export const LOOK_STARTER_LAYOUTS: Readonly<Record<BuiltinLookId, LookStarterLayout>> = {
  opaline: {
    themeId: "opaline",
    name: "Opaline",
    tagline: "Clear glass, bold condensed numerals, meaningful shapes, and harmonized accents",
    entries: [
      { kind: "clock", size: "M", content: { face: "expressive" } },
      { kind: "cpu", size: "S", content: { heroVisual: "thermal-badge" } },
      { kind: "memory", size: "S" },
      { kind: "weather", size: "M", content: { skyScene: true } },
      { kind: "media", size: "M", content: { look: "card", artShape: "cookie" } },
    ],
  },
  crystal: {
    themeId: "crystal",
    name: "Crystal",
    tagline: "Ultra-clear glass lenses, squircles, minimal labels, and crisp haloed numerals",
    entries: [
      { kind: "clock", size: "M", content: { face: "big-date" } },
      { kind: "cpu", size: "S", content: { heroVisual: "load-gauge" } },
      { kind: "weather", size: "M", content: { skyScene: false } },
      { kind: "network", size: "S" },
    ],
  },
  bloom: {
    themeId: "bloom",
    name: "Bloom",
    tagline: "Tactile tinted glass colored per widget kind, expressive shapes, and bouncy morphs",
    entries: [
      { kind: "clock", size: "M", content: { face: "expressive" } },
      { kind: "weather", size: "M", content: { skyScene: true } },
      { kind: "media", size: "M", content: { look: "card", artShape: "clover" } },
      { kind: "battery", size: "S" },
      { kind: "calendar", size: "M" },
    ],
  },
  instrument: {
    themeId: "instrument",
    name: "Instrument",
    tagline:
      "Smoked cockpit glass with hairlines, analog watch dial, gauges, and extended numerals",
    entries: [
      { kind: "clock", size: "M", content: { face: "analog", dial: "swiss" } },
      { kind: "cpu", size: "M", content: { heroVisual: "load-gauge" } },
      { kind: "gpu", size: "M" },
      { kind: "fans", size: "S" },
      { kind: "network", size: "S" },
    ],
  },
  air: {
    themeId: "air",
    name: "Air",
    tagline: "Frameless haloed typography floating directly on the wallpaper",
    entries: [
      { kind: "clock", size: "M", content: { face: "typographic" } },
      { kind: "weather", size: "M", content: { skyScene: false } },
      { kind: "calendar", size: "M" },
    ],
  },
  terminal: {
    themeId: "terminal",
    name: "Terminal",
    tagline: "Monospace TUI frames, slashed zeroes, uppercase labels, and instant updates",
    entries: [
      { kind: "clock", size: "M", content: { face: "terminal" } },
      { kind: "cpu", size: "M", content: { heroVisual: "core-bars" } },
      { kind: "processes", size: "M" },
      { kind: "docker", size: "M" },
      { kind: "network", size: "S" },
    ],
  },
  neon: {
    themeId: "neon",
    name: "Neon",
    tagline:
      "Deep twilight surfaces, glowing magenta-cyan borders, vinyl player, and audio spectrum",
    entries: [
      { kind: "clock", size: "M", content: { face: "segment" } },
      { kind: "media", size: "M", content: { look: "vinyl" } },
      { kind: "visualizer", size: "M", content: { look: "spectrogram", colorMode: "spectrum" } },
      { kind: "gpu", size: "M" },
      { kind: "cpu", size: "S" },
    ],
  },
  paper: {
    themeId: "paper",
    name: "Paper",
    tagline: "Warm matte editorial cards, serif display numerals, hairlines, and zero glass",
    entries: [
      { kind: "clock", size: "M", content: { face: "word" } },
      { kind: "weather", size: "M", content: { skyScene: false } },
      { kind: "calendar", size: "L", content: { view: "month" } },
    ],
  },
  mono: {
    themeId: "mono",
    name: "Mono",
    tagline: "High-contrast monochrome with e-ink calm and zero visual noise",
    entries: [
      { kind: "clock", size: "M", content: { face: "analog", dial: "minimal" } },
      { kind: "calendar", size: "M" },
      { kind: "weather", size: "S", content: { skyScene: false } },
      { kind: "battery", size: "S" },
    ],
  },
  classic: {
    themeId: "classic",
    name: "Classic",
    tagline: "The original Opaline 1.1 frosted glass look and essentials layout",
    entries: [
      { kind: "clock", size: "M" },
      { kind: "cpu", size: "S" },
      { kind: "memory", size: "S" },
      { kind: "network", size: "S" },
      { kind: "weather", size: "M" },
    ],
  },
};

export function starterLayoutForTheme(themeId: string): LookStarterLayout {
  return Object.hasOwn(LOOK_STARTER_LAYOUTS, themeId)
    ? LOOK_STARTER_LAYOUTS[themeId as BuiltinLookId]
    : LOOK_STARTER_LAYOUTS.opaline;
}

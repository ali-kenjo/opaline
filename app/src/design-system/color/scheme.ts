// Dynamic color (docs/DESIGN.md §3): a Material 3 scheme from a source color, its roles as
// CSS custom properties, and the semantic ramps.
import {
  type DynamicScheme,
  Hct,
  MaterialDynamicColors,
  SchemeExpressive,
  SchemeFidelity,
  SchemeMonochrome,
  SchemeNeutral,
  SchemeTonalSpot,
  SchemeVibrant,
  argbFromHex,
  blueFromArgb,
  greenFromArgb,
  redFromArgb,
} from "@material/material-color-utilities";

export type Variant =
  "tonal-spot" | "vibrant" | "expressive" | "fidelity" | "neutral" | "monochrome";

export interface SchemeOptions {
  /** ARGB source color. */
  source: number;
  variant: Variant;
  dark: boolean;
  /** −1 … 1; GNOME high contrast implies 1. */
  contrast: number;
}

/** The roles we map to CSS (`--md-<kebab-case>`). */
export const ROLES = [
  "primary",
  "onPrimary",
  "primaryContainer",
  "onPrimaryContainer",
  "secondary",
  "onSecondary",
  "secondaryContainer",
  "onSecondaryContainer",
  "tertiary",
  "onTertiary",
  "tertiaryContainer",
  "onTertiaryContainer",
  "error",
  "onError",
  "errorContainer",
  "onErrorContainer",
  "background",
  "onBackground",
  "surface",
  "surfaceDim",
  "surfaceBright",
  "surfaceContainerLowest",
  "surfaceContainerLow",
  "surfaceContainer",
  "surfaceContainerHigh",
  "surfaceContainerHighest",
  "onSurface",
  "surfaceVariant",
  "onSurfaceVariant",
  "inverseSurface",
  "inverseOnSurface",
  "inversePrimary",
  "outline",
  "outlineVariant",
  "shadow",
  "scrim",
] as const;

export type Role = (typeof ROLES)[number];
export type Roles = Record<Role, number>;

function makeScheme({ source, variant, dark, contrast }: SchemeOptions): DynamicScheme {
  const hct = Hct.fromInt(source);
  const level = Math.min(1, Math.max(-1, contrast));
  switch (variant) {
    case "vibrant":
      return new SchemeVibrant(hct, dark, level);
    case "expressive":
      return new SchemeExpressive(hct, dark, level);
    case "fidelity":
      return new SchemeFidelity(hct, dark, level);
    case "neutral":
      return new SchemeNeutral(hct, dark, level);
    case "monochrome":
      return new SchemeMonochrome(hct, dark, level);
    case "tonal-spot":
      return new SchemeTonalSpot(hct, dark, level);
  }
}

export function buildRoles(options: SchemeOptions): Roles {
  const scheme = makeScheme(options);
  const roles = {} as Roles;
  for (const role of ROLES) {
    roles[role] = MaterialDynamicColors[role].getArgb(scheme);
  }
  return roles;
}

/** `onSurfaceVariant` → `--md-on-surface-variant`. */
export function cssName(role: string): string {
  return `--md-${role.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/** An ARGB color as the `R G B` triple CSS uses with `rgb(var(--x) / alpha)`. */
export function triple(argb: number): string {
  return `${redFromArgb(argb)} ${greenFromArgb(argb)} ${blueFromArgb(argb)}`;
}

export function cssVariables(roles: Roles): Record<string, string> {
  const out: Record<string, string> = {};
  for (const role of ROLES) out[cssName(role)] = triple(roles[role]);
  return out;
}

/** GNOME's named accent colors (org.gnome.desktop.interface accent-color), as sources. */
export const GNOME_ACCENTS: Readonly<Record<string, number>> = {
  blue: argbFromHex("#3584e4"),
  teal: argbFromHex("#2190a4"),
  green: argbFromHex("#3a944a"),
  yellow: argbFromHex("#c88800"),
  orange: argbFromHex("#ed5b00"),
  red: argbFromHex("#e62d42"),
  pink: argbFromHex("#d56199"),
  purple: argbFromHex("#9141ac"),
  slate: argbFromHex("#6f8396"),
};

/** Fallback when there's no wallpaper or accent yet. */
export const DEFAULT_SOURCE = argbFromHex("#6750a4");

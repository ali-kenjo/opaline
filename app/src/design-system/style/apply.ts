// Turns a resolved style into what the renderer needs: CSS custom properties for the widget's
// DOM, the color roles of its own scheme, and the glass options for the compositor.
import type { CSSProperties } from "react";
import { argbFromHex } from "@material/material-color-utilities";
import { type Roles, buildRoles, cssName, cssVariables, triple } from "../color/scheme";
import type { SurfaceLook } from "../glass/compositor";
import type { GlassOptions } from "../glass/GlassStage";
import { luminance } from "../glass/legibility";
import { type SizeClass, cardPadding, cardRadius, type SpringToken } from "../tokens/tokens";
import type { ResolvedStyle } from "./types";

/** Bundled families and their @font-face names (fontsource "… Variable"). */
export const BUNDLED_FONTS: Readonly<Record<string, string>> = {
  "Roboto Flex": "Roboto Flex Variable",
  Inter: "Inter Variable",
  "Noto Sans Arabic": "Noto Sans Arabic Variable",
};

/** A CSS font stack: the chosen family, then Arabic and system fallbacks per glyph. */
export function fontStack(family: string): string {
  const face = BUNDLED_FONTS[family] ?? family;
  return `"${face}", "Noto Sans Arabic Variable", system-ui, sans-serif`;
}

export function hexToRgba(hex: string): [number, number, number, number] {
  const n = hex.slice(1);
  const v = (i: number) => parseInt(n.slice(i, i + 2), 16);
  return [v(0), v(2), v(4), n.length === 8 ? v(6) / 255 : 1];
}

/** Transparency 0 (solid) … 100 (completely clear) to the glass's base tint alpha. */
export function transparencyAlpha(t: number): number {
  const c = Math.min(100, Math.max(0, t));
  if (c <= 60) return 1 - (c / 60) * 0.528;
  return 0.472 * (1 - (c - 60) / 40);
}

export interface ColorContext {
  /** ARGB source colors the global setting can choose from. */
  wallpaper: number;
  accent: number;
  /** The system's (or global) dark preference. */
  systemDark: boolean;
}

export function isDark(style: ResolvedStyle, ctx: ColorContext): boolean {
  return style.theme === "auto" ? ctx.systemDark : style.theme === "dark";
}

export function sourceColor(style: ResolvedStyle, ctx: ColorContext): number {
  if (style.colorSource === "custom" && style.seedColor)
    return argbFromHex(style.seedColor.slice(0, 7));
  return style.colorSource === "accent" ? ctx.accent : ctx.wallpaper;
}

const rolesCache = new Map<string, Roles>();

/** Color roles of a widget's own scheme (cached; schemes are pure). */
export function rolesFor(style: ResolvedStyle, ctx: ColorContext): Roles {
  const source = sourceColor(style, ctx);
  const dark = isDark(style, ctx);
  const key = `${source}|${style.variant}|${dark}|${style.contrast}`;
  let roles = rolesCache.get(key);
  if (!roles) {
    roles = buildRoles({ source, variant: style.variant, dark, contrast: style.contrast });
    if (rolesCache.size > 64) rolesCache.clear();
    rolesCache.set(key, roles);
  }
  return roles;
}

function rgbOf(argb: number): [number, number, number] {
  return [(argb >> 16) & 255, (argb >> 8) & 255, argb & 255];
}

const DENSITY_DELTA = { compact: -4, comfortable: 0, spacious: 4 } as const;

export function radiusFor(style: ResolvedStyle, size: SizeClass): number {
  return style.radius ?? cardRadius(size);
}

/** CSS custom properties for a widget root: its scheme plus every text/icon/spacing setting. */
export function styleVariables(style: ResolvedStyle, roles: Roles, size: SizeClass): CSSProperties {
  const vars: Record<string, string | number> = { ...cssVariables(roles) };
  const set = (role: string, hex: string | null) => {
    if (hex) vars[cssName(role)] = hexToRgba(hex).slice(0, 3).join(" ");
  };
  set("primary", style.accentColor);
  set("onSurface", style.textColor);
  set("onSurfaceVariant", style.secondaryTextColor);
  vars["--w-font"] = fontStack(style.fontFamily);
  vars["--w-num-font"] = fontStack(style.numberFontFamily);
  vars["--w-weight"] = style.fontWeight;
  vars["--w-wdth"] = style.fontWidth;
  vars["--w-scale"] = style.textScale;
  vars["--w-letter"] = `${String(style.letterSpacing)}em`;
  vars["--w-nums"] = style.tabularNumbers ? "tabular-nums" : "normal";
  vars["--w-label-case"] = style.uppercaseLabels ? "uppercase" : "none";
  vars["--w-text-shadow"] = style.textShadow ? "0 1px 3px rgb(0 0 0 / 0.45)" : "none";
  vars["--w-icon-fill"] = style.iconFill ? 1 : 0;
  vars["--w-icon-weight"] = style.iconWeight;
  vars["--w-icons"] = style.icons ? "inline-block" : "none";
  vars["--w-padding"] =
    `${String(Math.max(8, cardPadding(size) + DENSITY_DELTA[style.density]))}px`;
  vars["--w-gap"] = `${String(Math.max(2, 8 + DENSITY_DELTA[style.density] / 2))}px`;
  vars["--w-radius"] = `${String(radiusFor(style, size))}px`;
  vars["--w-hero"] =
    style.heroColor === "custom" && style.heroCustomColor
      ? hexToRgba(style.heroCustomColor).slice(0, 3).join(" ")
      : style.heroColor === "accent"
        ? (vars[cssName("primary")] as string)
        : "";
  return vars;
}

/** Glass options for the compositor (and the CSS fallback) from a resolved style. */
export function glassOptions(style: ResolvedStyle, roles: Roles): Omit<GlassOptions, "radius"> {
  const custom = (hex: string | null, fallback: number): [number, number, number] =>
    hex ? (hexToRgba(hex).slice(0, 3) as [number, number, number]) : rgbOf(fallback);
  const tint =
    style.surface === "color"
      ? custom(style.surfaceColor, roles.surfaceContainer)
      : style.surface === "tinted"
        ? custom(style.tintColor, roles.primaryContainer)
        : custom(style.tintColor, roles.surfaceContainer);
  const text = style.textColor ? hexToRgba(style.textColor) : rgbOf(roles.onSurface);
  const look: SurfaceLook = {
    blur: style.blur / 100,
    see: style.see,
    refraction: style.refraction / 50,
    rim: style.rim / 50,
    grain: style.grain / 50,
    shadow: style.shadow / 50,
    opaque: style.surface === "opaque",
    borderWidth: style.borderWidth,
    borderColor: style.borderColor
      ? (hexToRgba(style.borderColor).map((c, i) => (i < 3 ? c / 255 : c)) as [
          number,
          number,
          number,
          number,
        ])
      : ([...rgbOf(roles.outlineVariant).map((c) => c / 255), 1] as [
          number,
          number,
          number,
          number,
        ]),
  };
  return {
    tint,
    alpha: style.surface === "opaque" ? 1 : transparencyAlpha(style.transparency),
    frameless: style.surface === "clear",
    legibility: style.legibility,
    textLuminance: luminance(text[0], text[1], text[2]),
    look,
  };
}

/** The spring a widget's motion uses. */
export function springFor(style: ResolvedStyle): SpringToken {
  return style.motionSpeed === "slow"
    ? "spatialSlow"
    : style.motionSpeed === "fast"
      ? "spatialFast"
      : "spatialDefault";
}

export { triple };

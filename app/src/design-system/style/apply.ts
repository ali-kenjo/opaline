// Turns a resolved style into what the renderer needs: CSS custom properties for the widget's
// DOM, the color roles of its own scheme, and the glass options for the compositor.
import type { CSSProperties } from "react";
import { argbFromHex } from "@material/material-color-utilities";
import { type Roles, buildRoles, cssName, cssVariables, triple } from "../color/scheme";
import type { SurfaceLook } from "../glass/compositor";
import type { GlassOptions, StageInks } from "../glass/GlassStage";
import { luminance } from "../glass/legibility";
import { type MaterialShapeName, materialShape } from "../shapes/material";
import type { Cubic } from "../shapes/cubic";
import { type SizeClass, cardPadding, cardRadius, type SpringToken } from "../tokens/tokens";
import { THEME_FONT_FALLBACKS } from "../type/lazyFonts";
import type { CardShape, GradientSpec, IconSet, ResolvedStyle, RoleTypography } from "./types";

/** Bundled families and their @font-face names (fontsource "… Variable"). */
export const BUNDLED_FONTS: Readonly<Record<string, string>> = {
  "Roboto Flex": "Roboto Flex Variable",
  Inter: "Inter Variable",
  "Noto Sans Arabic": "Noto Sans Arabic Variable",
};

/** A CSS font stack: the chosen family, theme-appropriate fallbacks, Arabic, and system UI. */
export function fontStack(family: string): string {
  const custom = THEME_FONT_FALLBACKS[family];
  if (custom) return custom;
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

/** Turns a validated `GradientSpec` into a CSS `*-gradient(…)` expression. */
export function gradientCss(g: GradientSpec): string {
  const stops = g.stops.map((s) => `${s.color} ${String(s.at)}%`).join(", ");
  if (g.kind === "radial") return `radial-gradient(circle, ${stops})`;
  if (g.kind === "conic") return `conic-gradient(from ${String(g.angle ?? 0)}deg, ${stops})`;
  return `linear-gradient(${String(g.angle ?? 135)}deg, ${stops})`;
}

const SHAPE_TO_MATERIAL: Partial<Record<CardShape, MaterialShapeName>> = {
  circle: "circle",
  square: "square",
  slanted: "slanted",
  arch: "arch",
  fan: "fan",
  arrow: "arrow",
  "semi-circle": "semiCircle",
  oval: "oval",
  pill: "pill",
  triangle: "triangle",
  diamond: "diamond",
  "clam-shell": "clamShell",
  pentagon: "pentagon",
  gem: "gem",
  sunny: "sunny",
  "very-sunny": "verySunny",
  "cookie-4-sided": "cookie4Sided",
  "cookie-6-sided": "cookie6Sided",
  "cookie-7-sided": "cookie7Sided",
  "cookie-9-sided": "cookie9Sided",
  "cookie-12-sided": "cookie12Sided",
  ghostish: "ghostish",
  "clover-4-leaf": "clover4Leaf",
  "clover-8-leaf": "clover8Leaf",
  burst: "burst",
  "soft-burst": "softBurst",
  boom: "boom",
  "soft-boom": "softBoom",
  flower: "flower",
  puffy: "puffy",
  "puffy-diamond": "puffyDiamond",
  "pixel-circle": "pixelCircle",
  "pixel-triangle": "pixelTriangle",
  bun: "bun",
  heart: "heart",
};

/** Unit-square cubics for a library `cardShape`, or `undefined` for `rounded-rect`. */
export function cardShapeCubics(shape: CardShape): readonly Cubic[] | undefined {
  const name = SHAPE_TO_MATERIAL[shape];
  return name ? materialShape(name).cubics : undefined;
}

const ICON_FONT: Record<IconSet, string> = {
  rounded: '"Material Symbols Rounded"',
  outlined: '"Material Symbols Outlined"',
  sharp: '"Material Symbols Sharp"',
  none: '"Material Symbols Rounded"',
};

export interface ColorContext {
  /** ARGB source colors the global setting can choose from. */
  wallpaper: number;
  accent: number;
  /** The system's (or global) dark preference. */
  systemDark: boolean;
}

/**
 * Whether a widget uses the dark scheme. "Automatic" follows the system, except on a solid custom
 * surface color, where the text scheme follows that color's brightness, so text never ends up
 * dark on a dark surface (0.18 is where black and white text contrast equally).
 */
export function isDark(style: ResolvedStyle, ctx: ColorContext): boolean {
  if (style.theme !== "auto") return style.theme === "dark";
  if (style.surface === "color" && style.surfaceColor) {
    const [r, g, b] = hexToRgba(style.surfaceColor);
    return luminance(r, g, b) < 0.18;
  }
  return ctx.systemDark;
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

function fontFeatures(slashedZero: boolean, stylisticSet: number): string {
  const parts: string[] = [];
  if (slashedZero) parts.push('"zero" 1');
  if (stylisticSet >= 1 && stylisticSet <= 20) {
    parts.push(`"ss${String(stylisticSet).padStart(2, "0")}" 1`);
  }
  return parts.length ? parts.join(", ") : "normal";
}

function writeRoleVars(vars: Record<string, string | number>, role: string, r: RoleTypography) {
  const p = `--w-role-${role}`;
  if (r.fontFamily) vars[`${p}-font`] = fontStack(r.fontFamily);
  if (r.fontWeight !== undefined) vars[`${p}-weight`] = r.fontWeight;
  if (r.fontWidth !== undefined) vars[`${p}-wdth`] = r.fontWidth;
  if (r.fontSize !== undefined) vars[`${p}-size`] = `${String(r.fontSize)}px`;
  if (r.letterSpacing !== undefined) vars[`${p}-letter`] = `${String(r.letterSpacing)}em`;
  if (r.textCase !== undefined) vars[`${p}-case`] = r.textCase;
  if (r.lineHeight !== undefined) vars[`${p}-lh`] = r.lineHeight;
  if (r.color) vars[`${p}-color`] = r.color;
  if (r.opacity !== undefined) vars[`${p}-opacity`] = r.opacity / 100;
  if (r.tabularNumbers !== undefined) {
    vars[`${p}-nums`] = r.tabularNumbers ? "tabular-nums" : "normal";
  }
  if (r.slashedZero !== undefined) vars[`${p}-features`] = r.slashedZero ? '"zero" 1' : "normal";
}

/** CSS custom properties for a widget root: its scheme plus every text/icon/spacing/role setting. */
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
  vars["--w-line-height"] = style.lineHeight;
  vars["--w-text-case"] = style.textCase;
  vars["--w-nums"] = style.tabularNumbers ? "tabular-nums" : "normal";
  vars["--w-font-features"] = fontFeatures(style.slashedZero, style.stylisticSet);
  vars["--w-label-case"] = style.uppercaseLabels ? "uppercase" : "none";
  vars["--w-text-shadow"] = style.textShadow ? "0 1px 3px rgb(0 0 0 / 0.45)" : "none";
  vars["--w-icon-family"] = ICON_FONT[style.iconSet];
  vars["--w-icon-fill"] = style.iconFill ? 1 : 0;
  vars["--w-icon-weight"] = style.iconWeight;
  vars["--w-icon-grade"] = style.iconGrade;
  vars["--w-icon-size"] = `${String(style.iconSize)}px`;
  if (style.iconColor) vars["--w-icon-color"] = style.iconColor;
  vars["--w-icons"] = style.icons && style.iconSet !== "none" ? "inline-block" : "none";
  const padPx = style.padding ?? Math.max(8, cardPadding(size) + DENSITY_DELTA[style.density]);
  const gapPx = style.gap ?? Math.max(2, 8 + DENSITY_DELTA[style.density] / 2);
  vars["--w-padding"] = `${String(padPx)}px`;
  vars["--w-gap"] = `${String(gapPx)}px`;
  vars["--w-radius"] = `${String(radiusFor(style, size))}px`;
  if (style.cornerRadii?.length === 4) {
    vars["--w-radii"] = style.cornerRadii.map((r) => `${String(r)}px`).join(" ");
  }
  vars["--w-press-scale"] = style.pressScale;
  vars["--w-hero"] =
    style.heroColor === "custom" && style.heroCustomColor
      ? hexToRgba(style.heroCustomColor).slice(0, 3).join(" ")
      : style.heroColor === "accent"
        ? (vars[cssName("primary")] as string)
        : "";
  if (style.roles) {
    for (const [role, spec] of Object.entries(style.roles)) {
      writeRoleVars(vars, role, spec);
    }
  }
  return vars;
}

/** Extra CSS properties for non-glass surface treatments (gradients, corner radii, glow, opacity). */
export function surfaceCss(style: ResolvedStyle): CSSProperties {
  const out: CSSProperties = {};
  if (style.opacity < 100) out.opacity = style.opacity / 100;
  if (style.cornerRadii?.length === 4) {
    out.borderRadius = style.cornerRadii.map((r) => `${String(r)}px`).join(" ");
  }
  if (style.surface === "gradient" && style.backgroundGradient) {
    out.background = gradientCss(style.backgroundGradient);
  }
  if (style.borderGlow > 0 && style.borderWidth > 0) {
    const glowColor = style.borderColor ?? "rgb(var(--md-primary))";
    out.boxShadow = `0 0 ${String(Math.round(style.borderGlow * 0.28))}px ${glowColor}`;
  }
  if (style.innerShadow > 0) {
    const inset = `inset 0 2px ${String(Math.round(style.innerShadow * 0.24))}px rgb(0 0 0 / ${String((style.innerShadow / 100) * 0.45)})`;
    out.boxShadow = out.boxShadow ? `${out.boxShadow}, ${inset}` : inset;
  }
  return out;
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
  // Legibility is judged on the weaker text: secondary labels use on-surface-variant, which sits
  // closer to the glass than on-surface in both light and dark schemes.
  const text = style.secondaryTextColor
    ? hexToRgba(style.secondaryTextColor)
    : style.textColor
      ? hexToRgba(style.textColor)
      : rgbOf(roles.onSurfaceVariant);
  const shadowColor = style.shadowColor
    ? (hexToRgba(style.shadowColor).map((c, i) => (i < 3 ? c / 255 : c)) as [
        number,
        number,
        number,
        number,
      ])
    : undefined;
  const look: SurfaceLook = {
    blur: style.blur / 100,
    see: style.see,
    refraction: style.refraction / 50,
    rim: style.rim / 50,
    grain: style.grain / 50,
    shadow: style.shadow / 50,
    opaque: style.surface === "opaque" || style.surface === "gradient",
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
    ...(style.dispersion > 0 ? { dispersion: style.dispersion / 100 } : {}),
    ...(style.specularAngle !== 315 ? { specularAngle: style.specularAngle } : {}),
    ...(style.specularWidth !== 100 ? { specularWidth: style.specularWidth / 100 } : {}),
    ...(style.innerGlow > 0 ? { innerGlow: style.innerGlow / 100 } : {}),
    ...(style.shadowOffsetY !== 8 ? { shadowOffsetY: style.shadowOffsetY } : {}),
    ...(style.shadowBlur !== 24 ? { shadowBlur: style.shadowBlur } : {}),
    ...(style.shadowSpread !== 0 ? { shadowSpread: style.shadowSpread } : {}),
    ...(shadowColor ? { shadowColor } : {}),
  };
  const shape = cardShapeCubics(style.cardShape);
  return {
    tint,
    alpha:
      style.surface === "opaque" || style.surface === "gradient"
        ? 1
        : transparencyAlpha(style.transparency),
    frameless: style.surface === "clear",
    legibility: style.legibility,
    autoInk: style.textColor === null,
    textLuminance: luminance(text[0], text[1], text[2]),
    look,
    ...(shape ? { shape } : {}),
  };
}

/** The two inks legibility 2.0 chooses between: on-surface roles of the dark and light scheme. */
export function inksFor(style: ResolvedStyle, ctx: ColorContext): StageInks {
  const dark = rolesFor({ ...style, theme: "dark" }, ctx);
  const light = rolesFor({ ...style, theme: "light" }, ctx);
  return {
    light: rgbOf(dark.onSurface),
    lightVariant: rgbOf(dark.onSurfaceVariant),
    dark: rgbOf(light.onSurface),
    darkVariant: rgbOf(light.onSurfaceVariant),
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

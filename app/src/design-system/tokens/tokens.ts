// Design tokens (docs/DESIGN.md). CSS custom properties mirror these in tokens.css.

/** The 4-pt spacing scale, in px. */
export const space = [0, 4, 8, 12, 16, 20, 24, 32, 40] as const;

export const grid = {
  cell: 84,
  gap: 12,
  safeMargin: 24,
} as const;

/** Grid spans of each size class. */
export const sizes = {
  "1x1": { w: 1, h: 1 },
  "2x1": { w: 2, h: 1 },
  "4x1": { w: 4, h: 1 },
  S: { w: 2, h: 2 },
  M: { w: 4, h: 2 },
  L: { w: 4, h: 4 },
  XL: { w: 8, h: 4 },
} as const;

export type SizeClass = keyof typeof sizes;

/** Pixel size of a span: n cells and n − 1 gaps. */
export function spanPx(cells: number): number {
  return cells * grid.cell + Math.max(0, cells - 1) * grid.gap;
}

/** S and smaller get the small radius and padding; M and larger the large ones. */
export function isSmall(size: SizeClass): boolean {
  const { w, h } = sizes[size];
  return w <= 2 && h <= 2;
}

export function cardRadius(size: SizeClass): number {
  return isSmall(size) ? 28 : 32;
}

export function cardPadding(size: SizeClass): number {
  return isSmall(size) ? 16 : 20;
}

/** Concentric corners: a nested element's radius. */
export function innerRadius(size: SizeClass): number {
  return cardRadius(size) - cardPadding(size);
}

/** Spring tokens, verified against androidx ExpressiveMotionTokens (2026-11-23). */
export const springs = {
  spatialFast: { stiffness: 800, damping: 0.6 },
  spatialDefault: { stiffness: 380, damping: 0.8 },
  spatialSlow: { stiffness: 200, damping: 0.8 },
  effectsFast: { stiffness: 3800, damping: 1 },
  effectsDefault: { stiffness: 1600, damping: 1 },
  effectsSlow: { stiffness: 800, damping: 1 },
} as const;

export type SpringToken = keyof typeof springs;

/** Glass slider default (Clear 0 … Tinted 100). */
export const glassDefault = 45;

/** Reduced motion: crossfades no longer than this. */
export const reducedMotionMs = 150;

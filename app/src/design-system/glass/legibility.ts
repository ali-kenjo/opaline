// Adaptive legibility (docs/DESIGN.md §4): raise a surface's tint until its primary text keeps
// 4.5 : 1 against the composited glass, using core's 8 × 8 luminance grid of the blurred
// wallpaper.

/** WCAG contrast ratio of two relative luminances. */
export function contrast(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** Relative luminance of an sRGB color (0–255 channels). */
export function luminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Mean luminance of the grid cells under a rect (fractions of the monitor, 0–1). */
export function luminanceUnder(
  grid: readonly number[],
  x: number,
  y: number,
  w: number,
  h: number,
  size = 8,
): number {
  const x0 = Math.max(0, Math.floor(x * size));
  const y0 = Math.max(0, Math.floor(y * size));
  const x1 = Math.min(size - 1, Math.floor((x + w) * size - 1e-9));
  const y1 = Math.min(size - 1, Math.floor((y + h) * size - 1e-9));
  let sum = 0;
  let n = 0;
  for (let gy = y0; gy <= y1; gy++) {
    for (let gx = x0; gx <= x1; gx++) {
      sum += grid[gy * size + gx] ?? 0;
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

/**
 * The smallest tint alpha ≥ `base` that gives `textLum` 4.5 : 1 against the glass, where glass
 * luminance ≈ mix(background, tint, alpha). Luminance mixes approximately linearly, which is
 * conservative enough for blurred backgrounds.
 */
export function legibleAlpha(
  base: number,
  backgroundLum: number,
  tintLum: number,
  textLum: number,
  // 4.5 : 1 plus a margin: the wallpaper luminance under a widget is an estimate (a coarse grid
  // of the blurred image), and the screenshot check measures what is really painted.
  target = 4.7,
): number {
  const glass = (a: number) => backgroundLum + (tintLum - backgroundLum) * a;
  if (contrast(glass(base), textLum) >= target) return base;
  let lo = base;
  let hi = 1;
  if (contrast(glass(hi), textLum) < target) return 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (contrast(glass(mid), textLum) >= target) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Glass slider (0 = clear … 100 = tinted) to the base tint alpha. */
export function sliderAlpha(slider: number): number {
  return 0.12 + (Math.min(100, Math.max(0, slider)) / 100) * 0.78;
}

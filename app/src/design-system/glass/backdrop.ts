// Legibility 2.0 (DESIGN-2 §8.4, ADR 0012): what is behind each widget. Brightness alone (the
// 1.x 8 × 8 grid) can't tell a calm gradient from a busy photo, so this samples the wallpaper
// image itself once per image and answers mean luminance and its spread (standard deviation)
// for any rectangle. The spread is what makes text fight the wallpaper on see-through glass.
import { luminance } from "./legibility";

/** Width of the luminance map: fine enough to keep the detail that makes a wallpaper busy (256 px averaged it away), small enough to compute once per wallpaper (about 1.3 MB). */
const MAP_WIDTH = 768;

export interface BackdropStats {
  /** Mean relative luminance 0–1. */
  mean: number;
  /** Standard deviation of the luminance 0–0.5: how busy the backdrop is. */
  spread: number;
  /** The darkest and brightest 1 % (percentiles): where dark and light text get lost. Text-like detail covers 1–2 % of a card; small specks (0.5 %) stay below it. */
  low: number;
  high: number;
}

const BINS = 64;

export class BackdropSampler {
  private constructor(
    private readonly map: Float32Array,
    private readonly w: number,
    private readonly h: number,
  ) {}

  /** Builds the luminance map of an image; `null` if it can't be read (no 2D canvas). */
  static from(
    source: CanvasImageSource & { width: number; height: number },
  ): BackdropSampler | null {
    const sw = source.width;
    const sh = source.height;
    if (!sw || !sh) return null;
    const w = Math.min(MAP_WIDTH, sw);
    const h = Math.max(1, Math.round((sh / sw) * w));
    const canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(w, h)
        : Object.assign(document.createElement("canvas"), { width: w, height: h });
    const ctx = canvas.getContext("2d") as
      CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    const map = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      map[i] = luminance(px[i * 4] ?? 0, px[i * 4 + 1] ?? 0, px[i * 4 + 2] ?? 0);
    }
    return new BackdropSampler(map, w, h);
  }

  /** Stats under a rectangle given in fractions (0–1) of the image. */
  stats(x: number, y: number, w: number, h: number): BackdropStats {
    const x0 = Math.max(0, Math.floor(x * this.w));
    const y0 = Math.max(0, Math.floor(y * this.h));
    const x1 = Math.min(this.w, Math.ceil((x + w) * this.w));
    const y1 = Math.min(this.h, Math.ceil((y + h) * this.h));
    const hist = new Uint32Array(BINS);
    let sum = 0;
    let sq = 0;
    let n = 0;
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const v = this.map[yy * this.w + xx] ?? 0;
        sum += v;
        sq += v * v;
        n++;
        const bin = Math.min(BINS - 1, Math.floor(v * BINS));
        hist[bin] = (hist[bin] ?? 0) + 1;
      }
    }
    if (n === 0) return { mean: 0.05, spread: 0, low: 0.05, high: 0.05 };
    const mean = sum / n;
    const percentile = (p: number) => {
      let seen = 0;
      for (let b = 0; b < BINS; b++) {
        seen += hist[b] ?? 0;
        if (seen >= p * n) return (b + 0.5) / BINS;
      }
      return 1;
    };
    return {
      mean,
      spread: Math.sqrt(Math.max(0, sq / n - mean * mean)),
      low: Math.min(mean, percentile(0.01)),
      high: Math.max(mean, percentile(0.99)),
    };
  }
}

export interface InkChoice {
  /** Which ink reads better: the light one (for dark glass) or the dark one. */
  ink: "light" | "dark";
  /** Worst-case contrast of that ink against the glass, as a WCAG ratio. */
  contrast: number;
  /** Whether a soft halo should sit behind the text. */
  halo: boolean;
}

/**
 * Chooses the text ink for a surface (text first, the tint only last). Light text is judged
 * against the brightest part of the glass (`glassHigh`), dark text against the darkest
 * (`glassLow`), because that is where each gets lost; `busy` says how much detail shows.
 */
export function chooseInk(
  glassLow: number,
  glassHigh: number,
  lightInkLum: number,
  darkInkLum: number,
): InkChoice {
  const ratio = (a: number, b: number) => {
    const [hi, lo] = a > b ? [a, b] : [b, a];
    return (hi + 0.05) / (lo + 0.05);
  };
  const light = ratio(lightInkLum, glassHigh);
  const dark = ratio(darkInkLum, glassLow);
  const ink = light >= dark ? "light" : "dark";
  const contrast = Math.max(light, dark);
  // Visible detail or contrast short of AAA gets a halo; it costs nothing on calm glass.
  const halo = glassHigh - glassLow > 0.08 || contrast < 7;
  return { ink, contrast, halo };
}

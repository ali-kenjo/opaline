// Procedural test wallpapers for the Lab (no image files, so no licensing questions): a dark,
// a mid and a bright one, so glass and legibility can be judged on all three.

export interface LabWallpaper {
  id: "dusk" | "forest" | "snow" | "detail";
  /** Full-size image (CSS background and the fallback). */
  url: string;
  /** Quarter-resolution blurred version, the way core renders it. */
  blurred: HTMLCanvasElement;
  /** The full-resolution image (glass 2.0 `sharp` see mode). */
  sharp: HTMLCanvasElement;
  /** 8 × 8 luminance grid of the blurred image. */
  luminance: number[];
  /** Average color, for the scheme's source. */
  pixels: Uint8ClampedArray;
}

type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

const painters: Record<LabWallpaper["id"], Painter> = {
  dusk(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, w * 0.3, h);
    g.addColorStop(0, "#1b0f3a");
    g.addColorStop(0.55, "#7a2e7e");
    g.addColorStop(1, "#ff8a4c");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    blobs(ctx, w, h, ["#ffb36b", "#c04f9b", "#3e2a8a"], 7);
  },
  forest(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#0d2b26");
    g.addColorStop(1, "#2f6b45");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    blobs(ctx, w, h, ["#9fd18b", "#1f4d3a", "#e7d27c"], 9);
  },
  snow(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "#f4f7fb");
    g.addColorStop(1, "#bccbe0");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    blobs(ctx, w, h, ["#ffffff", "#9fb6d6", "#dfe8f3"], 8);
  },
  // Fine detail (spike S1): sharp lines, dots and type, so blur and sharpness are easy to judge.
  detail(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "#14213d");
    g.addColorStop(0.5, "#3a2d6b");
    g.addColorStop(1, "#c0566b");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgb(255 255 255 / 0.22)";
    ctx.lineWidth = 1;
    for (let x = -h; x < w; x += 14) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + h, h);
      ctx.stroke();
    }
    ctx.fillStyle = "#ffd27a";
    for (let y = 20; y < h; y += 40) {
      for (let x = 20; x < w; x += 40) ctx.fillRect(x, y, 3, 3);
    }
    ctx.fillStyle = "rgb(255 255 255 / 0.85)";
    ctx.font = "600 22px sans-serif";
    for (let y = 60; y < h; y += 120) {
      for (let x = 30; x < w; x += 260) ctx.fillText("Opaline 10:09", x, y);
    }
  },
};

function blobs(ctx: CanvasRenderingContext2D, w: number, h: number, colors: string[], n: number) {
  // Deterministic layout: screenshots must not change between runs.
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < n; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = (0.15 + rand() * 0.3) * Math.min(w, h);
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    const c = colors[i % colors.length] ?? "#fff";
    grad.addColorStop(0, `${c}cc`);
    grad.addColorStop(1, `${c}00`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  return [c, ctx];
}

function luminanceGrid(ctx: CanvasRenderingContext2D, w: number, h: number): number[] {
  const data = ctx.getImageData(0, 0, w, h).data;
  const lin = (v: number) =>
    v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4;
  const out: number[] = [];
  for (let gy = 0; gy < 8; gy++) {
    for (let gx = 0; gx < 8; gx++) {
      let sum = 0;
      let n = 0;
      for (let y = Math.floor((gy * h) / 8); y < Math.floor(((gy + 1) * h) / 8); y++) {
        for (let x = Math.floor((gx * w) / 8); x < Math.floor(((gx + 1) * w) / 8); x++) {
          const i = (y * w + x) * 4;
          sum +=
            0.2126 * lin(data[i] ?? 0) +
            0.7152 * lin(data[i + 1] ?? 0) +
            0.0722 * lin(data[i + 2] ?? 0);
          n++;
        }
      }
      out.push(n ? sum / n : 0);
    }
  }
  return out;
}

export function makeWallpaper(id: LabWallpaper["id"], w: number, h: number): LabWallpaper {
  const [full, fctx] = canvas(w, h);
  painters[id](fctx, w, h);
  // Quarter resolution, then two more halvings and back up: a cheap, smooth blur.
  const [small, sctx] = canvas(Math.max(1, Math.round(w / 16)), Math.max(1, Math.round(h / 16)));
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(full, 0, 0, small.width, small.height);
  const [blurred, bctx] = canvas(Math.round(w / 4), Math.round(h / 4));
  bctx.imageSmoothingQuality = "high";
  bctx.drawImage(small, 0, 0, blurred.width, blurred.height);
  const thumb = canvas(64, 64)[1];
  thumb.drawImage(full, 0, 0, 64, 64);
  return {
    id,
    url: full.toDataURL("image/png"),
    blurred,
    sharp: full,
    luminance: luminanceGrid(bctx, blurred.width, blurred.height),
    pixels: thumb.getImageData(0, 0, 64, 64).data,
  };
}

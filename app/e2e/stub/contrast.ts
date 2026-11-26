// The contrast check of the Widget Lab (2.0 brief §3.4), measured from the screenshot: what a
// person sees, glass and wallpaper included. It hides the glyphs (layout unchanged), screenshots
// the cards, and compares each text color with the pixels right behind its text run: the harder
// quarter of them (75th percentile toward the text). WCAG: 4.5 : 1, or 3 : 1 for large text (24 px, or 18.66 px
// bold).
import type { Locator, Page } from "@playwright/test";

export interface LowContrast {
  card: string;
  text: string;
  ratio: number;
  needed: number;
}

interface TextBox {
  card: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: [number, number, number];
  large: boolean;
}

export async function findLowContrast(page: Page, scope: Locator): Promise<LowContrast[]> {
  // Positions relative to the scope element itself: its screenshot starts at its own top-left,
  // wherever the page is scrolled.
  await scope.scrollIntoViewIfNeeded();
  const { boxes, cssWidth } = await scope.evaluate((root) => {
    const o = root.getBoundingClientRect();
    const out: TextBox[] = [];
    for (const card of root.querySelectorAll<HTMLElement>('[role="group"]')) {
      const name = card.getAttribute("aria-label") ?? "?";
      for (const el of card.querySelectorAll<HTMLElement>("*")) {
        if (el.closest("[data-digit]")) continue;
        // Labels the fitter hid stay for screen readers only; they aren't painted.
        if (el.closest("[data-fit-hidden], [hidden]")) continue;
        if (el.closest('[aria-hidden="true"]') && !el.closest("[data-fit-variant]")) continue;
        const text = [...el.childNodes]
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent ?? "")
          .join("")
          .trim();
        if (!text) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || Number(cs.opacity) < 0.05) continue;
        // Icon glyphs have their own, lower requirement (non-text contrast); not checked here.
        if (cs.fontFamily.includes("Material Symbols")) continue;
        // Only the text itself: the run of its text nodes, trimmed to the font's height.
        const range = document.createRange();
        range.selectNodeContents(el);
        const runs = [...range.getClientRects()].filter((q) => q.width > 2 && q.height > 2);
        if (runs.length === 0) continue;
        const left = Math.min(...runs.map((q) => q.left));
        const right = Math.max(...runs.map((q) => q.right));
        const top = Math.min(...runs.map((q) => q.top));
        const bottom = Math.max(...runs.map((q) => q.bottom));
        const size = parseFloat(cs.fontSize);
        const band = Math.min(bottom - top, size);
        const r = {
          left,
          width: right - left,
          top: top + (bottom - top - band) / 2,
          height: band,
        };
        if (r.width < 4 || r.height < 4) continue;
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(cs.color);
        if (!m) continue;
        const bold = Number(cs.fontWeight) >= 700;
        out.push({
          card: name,
          text,
          x: r.left - o.x,
          y: r.top - o.y,
          w: r.width,
          h: r.height,
          color: [Number(m[1]), Number(m[2]), Number(m[3])],
          large: size >= 24 || (bold && size >= 18.66),
        });
      }
    }
    return { boxes: out, cssWidth: o.width };
  });
  // The backdrop exactly as it is behind the text: hide every glyph (layout unchanged), take the
  // screenshot, then read the pixels under each text run.
  await page.addStyleTag({
    content:
      '[role="group"] * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; }',
  });
  await page.waitForTimeout(100);
  const png = (await scope.screenshot()).toString("base64");
  return await page.evaluate(
    async ({ png, boxes, cssWidth }) => {
      const blob = await (await fetch(`data:image/png;base64,${png}`)).blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return [];
      ctx.drawImage(bitmap, 0, 0);
      // Screenshots are in device pixels (the WebKit profile renders at dpr 2).
      const k = bitmap.width / cssWidth;
      const lum = (r: number, g: number, b: number) => {
        const l = (c: number) => {
          const v = c / 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b);
      };
      const ratio = (a: number, b: number) => {
        const [hi, lo] = a > b ? [a, b] : [b, a];
        return (hi + 0.05) / (lo + 0.05);
      };
      const found: { card: string; text: string; ratio: number; needed: number }[] = [];
      for (const b of boxes) {
        const x = Math.max(0, Math.floor(b.x * k));
        const y = Math.max(0, Math.floor(b.y * k));
        const w = Math.min(bitmap.width - x, Math.ceil(b.w * k));
        const h = Math.min(bitmap.height - y, Math.ceil(b.h * k));
        if (w <= 0 || h <= 0) continue;
        const px = ctx.getImageData(x, y, w, h).data;
        const textLum = lum(b.color[0], b.color[1], b.color[2]);
        const backdrop: number[] = [];
        for (let i = 0; i < px.length; i += 4) {
          backdrop.push(lum(px[i] ?? 0, px[i + 1] ?? 0, px[i + 2] ?? 0));
        }
        if (backdrop.length < 8) continue;
        backdrop.sort((p, q) => p - q);
        // The backdrop's harder quarter: the 75th percentile toward the text's own brightness
        // (robust against a stray bright element at the edge of the text's box).
        const worst =
          textLum > (backdrop[Math.floor(backdrop.length / 2)] ?? 0)
            ? (backdrop[Math.floor(backdrop.length * 0.75)] ?? 0)
            : (backdrop[Math.floor(backdrop.length * 0.25)] ?? 0);
        const r = ratio(textLum, worst);
        const needed = b.large ? 3 : 4.5;
        if (r < needed)
          found.push({ card: b.card, text: b.text, ratio: Math.round(r * 100) / 100, needed });
      }
      return found;
    },
    { png, boxes, cssWidth },
  );
}

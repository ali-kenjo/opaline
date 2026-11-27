// One-click style chips and style-clipboard helpers for the live Inspector (PLAN-2 5.1, brief §6.1).
import type { Style } from "../design-system/style";
import type { Json } from "../widgets/json";

export interface StyleChip {
  id: string;
  label: string;
  patch: Partial<Style>;
}

export const INSPECTOR_STYLE_CHIPS: readonly StyleChip[] = [
  {
    id: "glass",
    label: "Glass",
    patch: { surface: "glass", transparency: 75, blur: 30, rim: 80, cardShape: "rounded-rect" },
  },
  {
    id: "clear",
    label: "Clear",
    patch: { surface: "clear", transparency: 100, blur: 0, textShadow: true, headerStyle: "none" },
  },
  {
    id: "tinted",
    label: "Tinted",
    patch: { surface: "tinted", transparency: 44, blur: 56, rim: 68 },
  },
  {
    id: "solid",
    label: "Solid",
    patch: { surface: "opaque", transparency: 0, blur: 0, borderWidth: 1 },
  },
  {
    id: "gradient",
    label: "Gradient",
    patch: {
      surface: "gradient",
      transparency: 0,
      backgroundGradient: {
        kind: "linear",
        angle: 135,
        stops: [
          { color: "#2b1e5a", at: 0 },
          { color: "#12294a", at: 100 },
        ],
      },
    },
  },
  {
    id: "shaped",
    label: "Shaped",
    patch: { cardShape: "cookie-12-sided", surface: "tinted", transparency: 42 },
  },
  {
    id: "bold",
    label: "Bold",
    patch: { fontWeight: 700, textScale: 1.15, uppercaseLabels: true },
  },
  {
    id: "minimal",
    label: "Minimal",
    patch: { headerStyle: "none", icons: false, borderWidth: 0, shadow: 15 },
  },
];

const STYLE_CLIP_KEY = "opaline.inspector.styleClip.v1";
let memoryStyleClip: Record<string, Json> | null = null;

export function writeStyleClipboard(style: Record<string, Json>): void {
  memoryStyleClip = style;
  try {
    window.localStorage.setItem(STYLE_CLIP_KEY, JSON.stringify(style));
  } catch {
    // Fallback stays in memory.
  }
}

export function readStyleClipboard(): Record<string, Json> | null {
  try {
    const raw = window.localStorage.getItem(STYLE_CLIP_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, Json>;
      }
    }
  } catch {
    // Fallback to memory.
  }
  return memoryStyleClip;
}

/** Places the floating inspector next to `target` so it never covers the widget. */
export function computeInspectorPos(
  target: { x: number; y: number; width: number; height: number } | null,
  viewportW: number,
  viewportH: number,
  panelW = 380,
  panelH = 620,
): { left: number; top: number } {
  const pad = 16;
  const maxLeft = Math.max(pad, viewportW - panelW - pad);
  const maxTop = Math.max(pad, viewportH - Math.min(panelH, viewportH - pad * 2) - pad);
  if (!target) {
    return { left: maxLeft, top: pad };
  }
  const rightX = target.x + target.width + 16;
  const leftX = target.x - panelW - 16;
  let left: number;
  if (rightX + panelW <= viewportW - pad) {
    left = rightX;
  } else if (leftX >= pad) {
    left = leftX;
  } else {
    // Pick whichever side of the viewport has more room.
    const spaceRight = viewportW - (target.x + target.width);
    const spaceLeft = target.x;
    left = spaceRight >= spaceLeft ? maxLeft : pad;
  }
  const top = Math.max(pad, Math.min(maxTop, Math.round(target.y)));
  return { left: Math.round(left), top };
}

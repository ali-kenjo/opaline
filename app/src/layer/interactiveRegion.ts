// Where the desktop layer takes clicks (ADR 0015): the whole window during Peek, Edit and
// overlays; otherwise only the interactive elements (`[data-interactive]`: widget buttons,
// toggles, sliders, text fields), so the desktop icons keep working everywhere else.
import { useEffect } from "react";
import type { Rect } from "./bridge";

/** The rectangles of the interactive elements under `root`, rounded out to whole pixels. */
export function interactiveRects(root: ParentNode): Rect[] {
  const out: Rect[] = [];
  for (const el of root.querySelectorAll<HTMLElement>("[data-interactive]")) {
    if (el.closest("[hidden]")) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const x = Math.floor(r.left);
    const y = Math.floor(r.top);
    out.push({ x, y, width: Math.ceil(r.right) - x, height: Math.ceil(r.bottom) - y });
  }
  return out;
}

export const sameRects = (a: readonly Rect[], b: readonly Rect[]) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * Keeps the window's input region in step: `full` while Peek, Edit or an overlay needs every
 * click; else the interactive elements, re-measured when the DOM under `root` changes (coalesced,
 * and sent only when the rectangles changed).
 */
export function useInputRegion(
  root: { current: HTMLElement | null },
  full: boolean,
  size: { width: number; height: number },
  apply: (rects: Rect[]) => void,
) {
  useEffect(() => {
    const el = root.current;
    let last: Rect[] | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const update = () => {
      timer = null;
      // Without the root yet, nothing is clickable (never the whole window by accident).
      const rects = full
        ? [{ x: 0, y: 0, width: size.width, height: size.height }]
        : el
          ? interactiveRects(el)
          : [];
      if (last && sameRects(last, rects)) return;
      last = rects;
      apply(rects);
    };
    const schedule = () => {
      timer ??= setTimeout(update, 50);
    };
    update();
    if (full || !el) return;
    // Structure changes only (controls appear, lists grow, layouts swap): never style, which
    // animations write every frame.
    const mo = new MutationObserver(schedule);
    mo.observe(el, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-interactive", "hidden"],
    });
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    return () => {
      mo.disconnect();
      ro.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [root, full, size.width, size.height, apply]);
}

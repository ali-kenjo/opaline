// Auto-fit for hero numbers (docs/DESIGN-2.md §3.3): a number that is wider than the space its
// card leaves first narrows the variable font's width axis down to the role's minimum, then
// shrinks down to 0.6 × its designed size, never below (the layout's own rules take over from
// there, §5). Like `Fit`, it measures in layout effects straight on the DOM and writes inline
// custom properties, so fitting never costs a re-render or a visible flash.
import { useLayoutEffect, useRef } from "react";

/** The narrowest `wdth` a hero may use (Roboto Flex goes down to 25). */
export const HERO_MIN_WDTH = 25;
/** The smallest a hero may shrink to, relative to its designed size. */
export const HERO_MIN_SCALE = 0.6;

export interface FitInput {
  /** The number's width as designed. */
  natural: number;
  /** Its width with `wdth` at the minimum (equal to `natural` when the font has no such axis). */
  atMinWidth: number;
  /** The width it may take. */
  avail: number;
  /** The `wdth` it is designed with (NaN when unknown). */
  baseWdth: number;
}

export interface FitPlan {
  /** A narrower `wdth`, if needed. */
  wdth?: number;
  /** A size factor below 1, if narrowing wasn't enough. */
  scale: number;
}

/** What it takes to make the number fit: narrower first, then smaller (pure; see the tests). */
export function planNumberFit({ natural, atMinWidth, avail, baseWdth }: FitInput): FitPlan {
  if (!(avail > 0) || natural <= avail + 0.5) return { scale: 1 };
  const narrows = Number.isFinite(baseWdth) && baseWdth > HERO_MIN_WDTH && atMinWidth < natural;
  if (narrows && atMinWidth <= avail) {
    // Width is close to linear in `wdth`: interpolate, rounding towards narrower.
    const t = (natural - avail) / (natural - atMinWidth);
    const wdth = Math.floor((baseWdth - (baseWdth - HERO_MIN_WDTH) * t) * 10) / 10;
    return { wdth: Math.max(HERO_MIN_WDTH, wdth), scale: 1 };
  }
  const width = narrows ? atMinWidth : natural;
  const scale = Math.max(HERO_MIN_SCALE, Math.floor((avail / width) * 1000) / 1000);
  return narrows ? { wdth: HERO_MIN_WDTH, scale } : { scale };
}

function innerWidth(el: HTMLElement): number {
  const cs = getComputedStyle(el);
  return el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
}

const lastKey = new WeakMap<HTMLElement, string>();

/**
 * Fits `content` (the number) into `block` (its role element, which carries the font size and
 * `--w-role-wdth`). The space is the block's width (a row shrinks it) or its parent's content
 * width (a centred column doesn't), whichever is smaller. `force` measures even if the text and
 * the parent's width are as last time.
 */
export function fitNumber(block: HTMLElement, content: HTMLElement, force = false): void {
  const parent = block.parentElement;
  const key = `${String(parent?.clientWidth ?? 0)}|${content.textContent}`;
  if (!force && lastKey.get(block) === key) return;
  lastKey.set(block, key);
  block.style.removeProperty("--w-role-wdth");
  block.style.removeProperty("font-size");
  const avail = Math.min(block.clientWidth, parent ? innerWidth(parent) : Infinity);
  const natural = content.getBoundingClientRect().width;
  if (!(avail > 0) || natural <= avail + 0.5) {
    block.removeAttribute("data-fitted");
    return;
  }
  const cs = getComputedStyle(block);
  const baseWdth = parseFloat(cs.getPropertyValue("--w-role-wdth"));
  const fontPx = parseFloat(cs.fontSize);
  let atMinWidth = natural;
  if (Number.isFinite(baseWdth) && baseWdth > HERO_MIN_WDTH) {
    block.style.setProperty("--w-role-wdth", String(HERO_MIN_WDTH));
    atMinWidth = content.getBoundingClientRect().width;
    block.style.removeProperty("--w-role-wdth");
  }
  const plan = planNumberFit({ natural, atMinWidth, avail, baseWdth });
  if (plan.wdth !== undefined) block.style.setProperty("--w-role-wdth", String(plan.wdth));
  if (plan.scale < 1 && fontPx > 0) block.style.fontSize = `${(fontPx * plan.scale).toFixed(2)}px`;
  // The plan is an estimate, and in a flex row the box shrinks along with the number (flex
  // shrinks every item in proportion), so measure again and tighten until it fits or reaches the
  // minimums: first the width axis in small steps, then the size.
  let wdth = plan.wdth;
  let scale = plan.scale;
  const space = () => Math.min(block.clientWidth, parent ? innerWidth(parent) : Infinity);
  for (let i = 0; i < 24; i++) {
    const width = content.getBoundingClientRect().width;
    const room = space();
    if (width <= room + 0.5) break;
    if (wdth !== undefined && wdth > HERO_MIN_WDTH) {
      wdth = Math.max(HERO_MIN_WDTH, wdth - 2);
      block.style.setProperty("--w-role-wdth", String(wdth));
    } else if (scale > HERO_MIN_SCALE && fontPx > 0) {
      scale = Math.max(
        HERO_MIN_SCALE,
        Math.floor(scale * Math.min(0.97, room / width) * 1000) / 1000,
      );
      block.style.fontSize = `${(fontPx * scale).toFixed(2)}px`;
    } else break;
  }
  block.setAttribute("data-fitted", "");
}

/** Keeps a hero number fitted: on every render (cheap when nothing changed), when its card or its
 * neighbours resize, and when web fonts load. `enabled` false leaves the number as designed. */
export function useNumberFit<B extends HTMLElement, C extends HTMLElement>(enabled: boolean) {
  const block = useRef<B>(null);
  const content = useRef<C>(null);
  useLayoutEffect(() => {
    if (enabled && block.current && content.current) fitNumber(block.current, content.current);
  });
  useLayoutEffect(() => {
    const b = block.current;
    const c = content.current;
    if (!enabled || !b || !c) return;
    const again = () => {
      fitNumber(b, c, true);
    };
    const ro = new ResizeObserver(again);
    ro.observe(b);
    if (b.parentElement) ro.observe(b.parentElement);
    let unfonts: () => void = () => undefined;
    if (typeof document !== "undefined" && "fonts" in document) {
      document.fonts.addEventListener("loadingdone", again);
      void document.fonts.ready.then(again);
      unfonts = () => {
        document.fonts.removeEventListener("loadingdone", again);
      };
    }
    return () => {
      ro.disconnect();
      unfonts();
      b.style.removeProperty("--w-role-wdth");
      b.style.removeProperty("font-size");
      b.removeAttribute("data-fitted");
    };
  }, [enabled]);
  return [block, content] as const;
}

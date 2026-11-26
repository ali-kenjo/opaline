// Responsive text without truncation (2.0 brief §3.2): a label is never cut. `Fit` renders its
// variants (longest first: with icon, full label, the field's written short label) and shows the
// first one that fits; when none fits, the text stays for screen readers and the tooltip only.
// `fitRows` does the same for label/value rows and drops a row whose value can't fit at all.
// Measuring happens in layout effects directly on the DOM, so fitting never costs a re-render;
// an element whose text and width didn't change since its last fit isn't measured again, and
// attributes are written only when they change (a data update must not restyle every label).
import { type ReactNode, useLayoutEffect, useRef } from "react";
import styles from "./data.module.css";

/** Runs `fit` again whenever web fonts finish loading: a font changes the text's width without
 * resizing its box, so the ResizeObserver alone would miss it. Returns the cleanup. */
function refitOnFonts(fit: () => void): () => void {
  if (typeof document === "undefined" || !("fonts" in document)) return () => undefined;
  document.fonts.addEventListener("loadingdone", fit);
  void document.fonts.ready.then(fit);
  return () => {
    document.fonts.removeEventListener("loadingdone", fit);
  };
}

/** How far a row may reach into the card's bottom padding (padding is 16–20 px). */
const ROW_SLACK = 8;

function overflows(el: HTMLElement): boolean {
  return el.scrollWidth > el.clientWidth + 0.5;
}

function setHidden(el: HTMLElement, hidden: boolean): void {
  if (el.hidden !== hidden) el.hidden = hidden;
}

function setFlag(el: HTMLElement, name: string, on: boolean): void {
  if (el.hasAttribute(name) !== on) el.toggleAttribute(name, on);
}

/** What a fit depended on last time: the text and the width it had. */
const lastFit = new WeakMap<HTMLElement, string>();

function unchanged(el: HTMLElement, width: number): boolean {
  const key = `${String(width)}|${el.textContent}`;
  if (lastFit.get(el) === key) return true;
  lastFit.set(el, key);
  return false;
}

/**
 * Shows the first variant of a `Fit` element that fits; hides the text if none does. `force`
 * fits even if the text and the parent's width are as last time (`fitRows` knows better: a
 * sibling value may have grown).
 */
export function fitVariants(el: HTMLElement, force = false): void {
  const parts = [...el.querySelectorAll<HTMLElement>(":scope > [data-fit-variant]")];
  if (unchanged(el, el.parentElement?.clientWidth ?? 0) && !force) return;
  setFlag(el, "data-fit-hidden", false);
  for (let i = 0; i < parts.length; i++) {
    parts.forEach((p, j) => {
      setHidden(p, j !== i);
    });
    if (!overflows(el)) return;
  }
  setFlag(el, "data-fit-hidden", true);
}

/**
 * Fits every row (`[data-fit-row]`) of `container`: its `Fit` labels first, then, if the row still
 * overflows (the value alone doesn't fit), the row is dropped. Values are never cut. Rows that
 * would end below the nearest `[data-fit-bounds]` element are dropped too.
 */
export function fitRows(container: HTMLElement): void {
  const rows = [...container.querySelectorAll<HTMLElement>("[data-fit-row]")];
  const width = container.clientWidth;
  for (const row of rows) {
    // A row whose text and the container's width are as last time keeps its result.
    if (unchanged(row, width)) continue;
    setHidden(row, false);
    for (const fit of row.querySelectorAll<HTMLElement>("[data-fit]")) fitVariants(fit, true);
    if (overflows(row)) setHidden(row, true);
  }
  // Vertically: rows that would end more than ROW_SLACK px into the card's bottom padding are
  // dropped, so a row is never half visible at the bottom edge.
  const bounds = container.closest<HTMLElement>("[data-fit-bounds]");
  if (!bounds) return;
  const limit = bounds.getBoundingClientRect().bottom + ROW_SLACK;
  for (const row of rows) {
    if (!row.hidden && row.getBoundingClientRect().bottom > limit) setHidden(row, true);
  }
}

export interface FitProps {
  /** Longest first; the last one that still doesn't fit hides the text. */
  variants: readonly ReactNode[];
  /** The full text, for screen readers and the tooltip. */
  label: string;
  className?: string | undefined;
}

/** Forgets what an element was fitted for, so the next fit measures again (size or fonts). */
function refit(el: HTMLElement, fit: (el: HTMLElement) => void): () => void {
  return () => {
    lastFit.delete(el);
    for (const child of el.querySelectorAll<HTMLElement>("[data-fit], [data-fit-row]")) {
      lastFit.delete(child);
    }
    fit(el);
  };
}

export function Fit({ variants, label, className }: FitProps) {
  const ref = useRef<HTMLSpanElement>(null);
  // Every render: cheap when nothing it depends on changed.
  useLayoutEffect(() => {
    if (ref.current) fitVariants(ref.current);
  });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const again = refit(el, (e) => {
      fitVariants(e, true);
    });
    const ro = new ResizeObserver(again);
    if (el.parentElement) ro.observe(el.parentElement);
    const unfonts = refitOnFonts(again);
    return () => {
      ro.disconnect();
      unfonts();
    };
  }, []);
  return (
    <span
      ref={ref}
      data-fit=""
      className={`${styles.fit} ${className ?? ""}`}
      title={label}
      aria-label={label}
      role="text"
    >
      {variants.map((v, i) => (
        <span key={i} data-fit-variant={i} className={styles.fitVariant} aria-hidden>
          {v}
        </span>
      ))}
    </span>
  );
}

/** Fits the rows inside it on every render and whenever its size changes. */
export function useFitRows<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    if (ref.current) fitRows(ref.current);
  });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const again = refit(el, fitRows);
    const ro = new ResizeObserver(again);
    ro.observe(el);
    const unfonts = refitOnFonts(again);
    return () => {
      ro.disconnect();
      unfonts();
    };
  }, []);
  return ref;
}

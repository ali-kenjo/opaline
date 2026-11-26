// Responsive text without truncation (2.0 brief §3.2): a label is never cut. `Fit` renders its
// variants (longest first: with icon, full label, the field's written short label) and shows the
// first one that fits; when none fits, the text stays for screen readers and the tooltip only.
// `fitRows` does the same for label/value rows and drops a row whose value can't fit at all.
// Measuring happens in layout effects directly on the DOM, so fitting never costs a re-render.
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

/** Shows the first variant of a `Fit` element that fits; hides the text if none does. */
export function fitVariants(el: HTMLElement): void {
  const parts = [...el.querySelectorAll<HTMLElement>(":scope > [data-fit-variant]")];
  el.removeAttribute("data-fit-hidden");
  for (let i = 0; i < parts.length; i++) {
    parts.forEach((p, j) => {
      p.hidden = j !== i;
    });
    if (!overflows(el)) return;
  }
  el.setAttribute("data-fit-hidden", "");
}

/**
 * Fits every row (`[data-fit-row]`) of `container`: its `Fit` labels first, then, if the row still
 * overflows (the value alone doesn't fit), the row is dropped. Values are never cut. Rows that
 * would end below the nearest `[data-fit-bounds]` element are dropped too.
 */
export function fitRows(container: HTMLElement): void {
  const rows = [...container.querySelectorAll<HTMLElement>("[data-fit-row]")];
  for (const row of rows) {
    row.hidden = false;
    for (const fit of row.querySelectorAll<HTMLElement>("[data-fit]")) fitVariants(fit);
    if (overflows(row)) row.hidden = true;
  }
  // Vertically: rows that would end more than ROW_SLACK px into the card's bottom padding are
  // dropped, so a row is never half visible at the bottom edge.
  const bounds = container.closest<HTMLElement>("[data-fit-bounds]");
  if (!bounds) return;
  const limit = bounds.getBoundingClientRect().bottom + ROW_SLACK;
  for (const row of rows) {
    if (!row.hidden && row.getBoundingClientRect().bottom > limit) row.hidden = true;
  }
}

export interface FitProps {
  /** Longest first; the last one that still doesn't fit hides the text. */
  variants: readonly ReactNode[];
  /** The full text, for screen readers and the tooltip. */
  label: string;
  className?: string | undefined;
}

export function Fit({ variants, label, className }: FitProps) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      fitVariants(el);
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (el.parentElement) ro.observe(el.parentElement);
    const unfonts = refitOnFonts(fit);
    return () => {
      ro.disconnect();
      unfonts();
    };
  });
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
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      fitRows(el);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    const unfonts = refitOnFonts(fit);
    return () => {
      ro.disconnect();
      unfonts();
    };
  });
  return ref;
}

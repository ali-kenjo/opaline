// The zero-truncation check (2.0 brief §3.2, §3.4): no label or value may be cut, neither by an
// ellipsis, nor by overflow, nor by the card's edge. User data (song titles, event names,
// container names) may end in an ellipsis and is marked `data-user-text` in the widget.
import type { Locator } from "@playwright/test";

export interface Truncation {
  card: string;
  text: string;
  why: "overflow" | "outside-card";
}

/** Scans every widget card inside `scope` and returns each cut label or value. */
export async function findTruncations(scope: Locator): Promise<Truncation[]> {
  return await scope.evaluate((root) => {
    const found: { card: string; text: string; why: "overflow" | "outside-card" }[] = [];
    const cards = root.querySelectorAll<HTMLElement>('[role="group"]');
    for (const card of cards) {
      const cardRect = card.getBoundingClientRect();
      const name = card.getAttribute("aria-label") ?? "?";
      for (const el of card.querySelectorAll<HTMLElement>("*")) {
        if (el.closest("[data-user-text]")) continue;
        // Odometer strips hold all ten digits and clip them on purpose; the card reads the value
        // from the odometer's label. Fit variants are aria-hidden but are the visible text.
        if (el.closest("[data-digit]")) continue;
        if (el.closest('[aria-hidden="true"]') && !el.closest("[data-fit-variant]")) continue;
        const ownText = [...el.childNodes]
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent ?? "")
          .join("")
          .trim();
        if (!ownText) continue;
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") continue;
        if (el.scrollWidth > el.clientWidth + 1 && style.overflowX !== "visible") {
          found.push({ card: name, text: ownText, why: "overflow" });
          continue;
        }
        const r = el.getBoundingClientRect();
        const outside =
          r.right > cardRect.right + 1 ||
          r.left < cardRect.left - 1 ||
          r.bottom > cardRect.bottom + 1 ||
          r.top < cardRect.top - 1;
        if (r.width > 0 && r.height > 0 && outside) {
          found.push({ card: name, text: ownText, why: "outside-card" });
        }
      }
    }
    return found;
  });
}

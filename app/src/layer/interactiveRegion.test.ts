// The layer takes clicks only on interactive elements outside Peek and Edit (ADR 0015).
import { describe, expect, it } from "vitest";
import { interactiveRects, sameRects } from "./interactiveRegion";

function el(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  // jsdom has no layout: give every element a box from its data-box attribute.
  for (const e of root.querySelectorAll<HTMLElement>("[data-box]")) {
    const [x, y, w, h] = (e.dataset.box ?? "0,0,0,0").split(",").map(Number);
    e.getBoundingClientRect = () =>
      ({
        left: x,
        top: y,
        right: (x ?? 0) + (w ?? 0),
        bottom: (y ?? 0) + (h ?? 0),
        width: w,
        height: h,
      }) as DOMRect;
  }
  return root;
}

describe("interactive region", () => {
  it("collects interactive elements only, rounded out, skipping hidden and empty ones", () => {
    const root = el(`
      <div data-box="0,0,300,200">card
        <button data-interactive data-box="10.4,20.6,50.2,30"></button>
        <div data-interactive data-box="5,5,0,0"></div>
        <div hidden><button data-interactive data-box="1,1,10,10"></button></div>
        <span data-box="100,100,20,20">text</span>
      </div>`);
    expect(interactiveRects(root)).toEqual([{ x: 10, y: 20, width: 51, height: 31 }]);
  });

  it("compares rectangles by value", () => {
    const a = [{ x: 1, y: 2, width: 3, height: 4 }];
    expect(sameRects(a, [{ x: 1, y: 2, width: 3, height: 4 }])).toBe(true);
    expect(sameRects(a, [])).toBe(false);
  });
});

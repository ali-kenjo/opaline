import { describe, expect, it } from "vitest";
import { cardPadding, cardRadius, innerRadius, spanPx } from "./tokens";

describe("tokens", () => {
  it("spans include the gaps", () => {
    expect(spanPx(2)).toBe(180);
    expect(spanPx(4)).toBe(372);
    expect(spanPx(1)).toBe(84);
  });

  it("radii are concentric", () => {
    expect(cardRadius("S")).toBe(28);
    expect(cardRadius("M")).toBe(32);
    expect(cardPadding("S")).toBe(16);
    expect(cardPadding("XL")).toBe(20);
    expect(innerRadius("S")).toBe(12);
    expect(innerRadius("L")).toBe(12);
  });
});

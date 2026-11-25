import { describe, expect, it } from "vitest";
import { applyDesktopLook, DEFAULT_LOOK, lookPrefs } from "./look";
import { BUILTIN_STYLE } from "./types";

describe("desktop look", () => {
  it("Glass at 50 % master leaves every widget as it is", () => {
    expect(applyDesktopLook(BUILTIN_STYLE, DEFAULT_LOOK)).toEqual(BUILTIN_STYLE);
  });

  it("Clear makes glass see-through without touching a widget that is already clearer", () => {
    const clear = applyDesktopLook(BUILTIN_STYLE, { ...DEFAULT_LOOK, look: "clear" });
    expect(clear.transparency).toBe(88);
    expect(clear.blur).toBe(24);
    const clearer = applyDesktopLook(
      { ...BUILTIN_STYLE, transparency: 95, blur: 5 },
      { ...DEFAULT_LOOK, look: "clear" },
    );
    expect(clearer.transparency).toBe(95);
    expect(clearer.blur).toBe(5);
  });

  it("Tinted uses one color for every widget", () => {
    const t = applyDesktopLook(BUILTIN_STYLE, {
      ...DEFAULT_LOOK,
      look: "tinted",
      lookColor: "#336699",
    });
    expect(t.surface).toBe("tinted");
    expect(t.tintColor).toBe("#336699");
  });

  it("the master transparency scales each widget relative to its own setting", () => {
    const clear = applyDesktopLook(
      { ...BUILTIN_STYLE, transparency: 60 },
      {
        ...DEFAULT_LOOK,
        masterTransparency: 100,
      },
    );
    expect(clear.transparency).toBe(100);
    const solid = applyDesktopLook(
      { ...BUILTIN_STYLE, transparency: 60 },
      {
        ...DEFAULT_LOOK,
        masterTransparency: 0,
      },
    );
    expect(solid.transparency).toBe(20);
  });

  it("reads core's appearance settings leniently", () => {
    expect(lookPrefs({ look: "dark", masterTransparency: 70 })).toEqual({
      look: "dark",
      lookColor: null,
      masterTransparency: 70,
    });
    expect(lookPrefs({ look: "neon", lookColor: "blue" })).toEqual(DEFAULT_LOOK);
    expect(lookPrefs(null)).toEqual(DEFAULT_LOOK);
  });
});

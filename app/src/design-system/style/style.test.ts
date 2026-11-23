import { describe, expect, it } from "vitest";
import { sliderAlpha } from "../glass/legibility";
import { glassDefault } from "../tokens/tokens";
import {
  BUILTIN_STYLE,
  STYLE_FIELDS,
  STYLE_KEYS,
  fontStack,
  glassOptions,
  resolveStyle,
  rolesFor,
  sanitizeStyle,
  styleVariables,
  transparencyAlpha,
} from ".";

const ctx = { wallpaper: 0xff6750a4, accent: 0xff3584e4, systemDark: true };

describe("style", () => {
  it("describes every key exactly once", () => {
    expect(STYLE_FIELDS.map((f) => f.key).sort()).toEqual([...STYLE_KEYS].sort());
  });

  it("the built-in default is the designed look", () => {
    expect(transparencyAlpha(BUILTIN_STYLE.transparency)).toBeCloseTo(sliderAlpha(glassDefault), 2);
    const g = glassOptions(BUILTIN_STYLE, rolesFor(BUILTIN_STYLE, ctx));
    expect(g.look).toMatchObject({
      blur: 0,
      refraction: 1,
      rim: 1,
      grain: 1,
      shadow: 1,
      opaque: false,
      borderWidth: 0,
    });
    expect(g.legibility).toBe(true);
  });

  it("resolves widget over global over default, with origins", () => {
    const r = resolveStyle({ transparency: 80, fontFamily: "Noto Serif" }, { transparency: 20 });
    expect(r.style.transparency).toBe(20);
    expect(r.origin.transparency).toBe("widget");
    expect(r.style.fontFamily).toBe("Noto Serif");
    expect(r.origin.fontFamily).toBe("global");
    expect(r.style.blur).toBe(0);
    expect(r.origin.blur).toBe("default");
  });

  it("drops unknown keys and invalid values", () => {
    expect(
      sanitizeStyle({
        blur: 30,
        radius: 900,
        surface: "chrome",
        fontFamily: 'x"}',
        bogus: 1,
        textColor: "#abcdef",
      }),
    ).toEqual({ blur: 30, textColor: "#abcdef" });
    expect(sanitizeStyle("nope")).toEqual({});
  });

  it("maps surfaces, opaque and custom colors to glass options", () => {
    const roles = rolesFor(BUILTIN_STYLE, ctx);
    const solid = glassOptions({ ...BUILTIN_STYLE, surface: "opaque" }, roles);
    expect(solid.alpha).toBe(1);
    expect(solid.look?.opaque).toBe(true);
    const colored = glassOptions(
      { ...BUILTIN_STYLE, surface: "color", surfaceColor: "#ff0000", transparency: 100 },
      roles,
    );
    expect(colored.tint).toEqual([255, 0, 0]);
    expect(colored.alpha).toBeCloseTo(0.12);
    const white = glassOptions({ ...BUILTIN_STYLE, textColor: "#ffffff" }, roles);
    expect(white.textLuminance).toBeCloseTo(1);
  });

  it("a custom seed or theme gives the widget its own scheme", () => {
    const own = rolesFor(
      { ...BUILTIN_STYLE, colorSource: "custom", seedColor: "#00ff00", theme: "light" },
      ctx,
    );
    const base = rolesFor(BUILTIN_STYLE, ctx);
    expect(own.surface).not.toBe(base.surface);
    expect(rolesFor(BUILTIN_STYLE, ctx)).toBe(base);
  });

  it("writes CSS variables for text, icons and overrides", () => {
    const s = {
      ...BUILTIN_STYLE,
      accentColor: "#112233",
      uppercaseLabels: true,
      icons: false,
      density: "compact" as const,
    };
    const v = styleVariables(s, rolesFor(s, ctx), "S") as Record<string, string | number>;
    expect(v["--md-primary"]).toBe("17 34 51");
    expect(v["--w-label-case"]).toBe("uppercase");
    expect(v["--w-icons"]).toBe("none");
    expect(v["--w-padding"]).toBe("12px");
    expect(v["--w-radius"]).toBe("28px");
    expect(fontStack("Inter")).toMatch(/^"Inter Variable"/);
    expect(fontStack("DejaVu Serif")).toMatch(/^"DejaVu Serif"/);
  });
});

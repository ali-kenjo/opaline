import { describe, expect, it } from "vitest";
import { CLASSIC_BLUR } from "../glass/compositor";
import { sliderAlpha } from "../glass/legibility";
import { glassDefault } from "../tokens/tokens";
import {
  BUILTIN_STYLE,
  STYLE_FIELDS,
  STYLE_KEYS,
  applyConditionalStyles,
  cardShapeCubics,
  exprHostFromTopics,
  fontStack,
  glassOptions,
  gradientCss,
  resolveCascade,
  resolveStyle,
  rolesFor,
  sanitizeStyle,
  styleVariables,
  surfaceCss,
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
    // 0.6 on the 2.0 blur scale is the 1.x glass (ADR 0012).
    expect(g.look).toMatchObject({
      blur: CLASSIC_BLUR,
      see: "wallpaper",
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
    expect(r.style.blur).toBe(CLASSIC_BLUR * 100);
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
    expect(colored.alpha).toBeCloseTo(0);
    const clear = glassOptions({ ...BUILTIN_STYLE, surface: "clear" }, roles);
    expect(clear.frameless).toBe(true);
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

  it("resolves the 6-layer cascade with accurate origins and merges roles", () => {
    const r = resolveCascade({
      theme: { blur: 30, transparency: 80, roles: { hero: { fontWeight: 780 } } },
      themeKind: { accentColor: "#f2903a" },
      global: { transparency: 70, roles: { label: { fontSize: 12 } } },
      kind: { borderWidth: 1 },
      widget: { blur: 15 },
      element: { fontWeight: 900 },
    });
    expect(r.style.blur).toBe(15);
    expect(r.origin.blur).toBe("widget");
    expect(r.style.transparency).toBe(70);
    expect(r.origin.transparency).toBe("global");
    expect(r.style.accentColor).toBe("#f2903a");
    expect(r.origin.accentColor).toBe("theme");
    expect(r.style.borderWidth).toBe(1);
    expect(r.origin.borderWidth).toBe("kind");
    expect(r.style.fontWeight).toBe(900);
    expect(r.origin.fontWeight).toBe("element");
    expect(r.origin.grain).toBe("default");
    expect(r.style.roles?.hero?.fontWeight).toBe(780);
    expect(r.style.roles?.label?.fontSize).toBe(12);
  });

  it("evaluates conditional styles in order and ignores invalid expressions", () => {
    const base = resolveStyle(
      {},
      {
        conditions: [
          { when: "cpu.temp >= 85", set: { borderColor: "#ff3b30", cardShape: "burst" } },
          { when: "cpu.load > 50", set: { borderWidth: 2, animate: true } },
          { when: "not valid ===", set: { blur: 0 } },
        ],
      },
    ).style;
    const cool = applyConditionalStyles(
      base,
      exprHostFromTopics({ "cpu.temp": 45, "cpu.load": 10 }),
    );
    expect(cool.matched).toEqual([]);
    expect(cool.style.cardShape).toBe("rounded-rect");

    const hot = applyConditionalStyles(
      base,
      exprHostFromTopics({ "cpu.temp": 90, "cpu.load": 75 }),
    );
    expect(hot.matched).toEqual([0, 1]);
    expect(hot.animate).toBe(true);
    expect(hot.style.borderColor).toBe("#ff3b30");
    expect(hot.style.cardShape).toBe("burst");
    expect(hot.style.borderWidth).toBe(2);
  });

  it("maps Style 2.0 glass controls, card shapes, gradients, and icon sets", () => {
    const s = {
      ...BUILTIN_STYLE,
      cardShape: "cookie-12-sided" as const,
      dispersion: 40,
      specularAngle: 180,
      specularWidth: 150,
      innerGlow: 30,
      shadowBlur: 32,
      shadowOffsetY: 12,
      shadowColor: "#102030",
      iconSet: "outlined" as const,
      iconGrade: 50,
      slashedZero: true,
      stylisticSet: 2,
      surface: "gradient" as const,
      backgroundGradient: {
        kind: "linear" as const,
        angle: 90,
        stops: [
          { color: "#112233", at: 0 },
          { color: "#445566", at: 100 },
        ],
      },
    };
    const g = glassOptions(s, rolesFor(s, ctx));
    expect(g.look).toMatchObject({
      dispersion: 0.4,
      specularAngle: 180,
      specularWidth: 1.5,
      innerGlow: 0.3,
      shadowBlur: 32,
      shadowOffsetY: 12,
    });
    expect(g.shape).toBeDefined();
    expect(cardShapeCubics("rounded-rect")).toBeUndefined();
    expect(gradientCss(s.backgroundGradient)).toBe(
      "linear-gradient(90deg, #112233 0%, #445566 100%)",
    );
    expect(surfaceCss(s).background).toContain("linear-gradient");
    const v = styleVariables(s, rolesFor(s, ctx), "M") as Record<string, string | number>;
    expect(v["--w-icon-family"]).toBe('"Material Symbols Outlined"');
    expect(v["--w-icon-grade"]).toBe(50);
    expect(v["--w-font-features"]).toBe('"zero" 1, "ss02" 1');
  });
});

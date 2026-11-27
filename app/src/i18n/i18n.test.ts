import { describe, expect, it } from "vitest";
import { isRtl, resolveLocale, resolvePackageString, t } from "./index";
import { AR, DE, EN, type MessageKey } from "./messages";

function placeholders(str: string): string[] {
  return [...str.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort();
}

describe("i18n catalogs (en, de, ar)", () => {
  it("has complete key and placeholder parity across English, German, and Arabic", () => {
    const enKeys = Object.keys(EN) as MessageKey[];
    expect(Object.keys(DE).sort()).toEqual([...enKeys].sort());
    expect(Object.keys(AR).sort()).toEqual([...enKeys].sort());
    for (const k of enKeys) {
      expect(EN[k].trim().length, `EN:${k}`).toBeGreaterThan(0);
      expect(DE[k].trim().length, `DE:${k}`).toBeGreaterThan(0);
      expect(AR[k].trim().length, `AR:${k}`).toBeGreaterThan(0);
      const expected = placeholders(EN[k]);
      expect(placeholders(DE[k]), `DE placeholders for ${k}`).toEqual(expected);
      expect(placeholders(AR[k]), `AR placeholders for ${k}`).toEqual(expected);
    }
  });

  it("resolves system locales and RTL direction accurately", () => {
    expect(resolveLocale("system", "de-DE")).toBe("de");
    expect(resolveLocale("system", "ar-EG")).toBe("ar");
    expect(resolveLocale("system", "fr-FR")).toBe("en");
    expect(resolveLocale("ar", "en-US")).toBe("ar");
    expect(isRtl("ar")).toBe(true);
    expect(isRtl("de")).toBe(false);
    expect(isRtl("en")).toBe(false);
  });

  it("interpolates ICU placeholders in all locales", () => {
    expect(t("en", "action.moveTo", { display: "HDMI-2" })).toBe("Move to HDMI-2");
    expect(t("de", "action.moveTo", { display: "HDMI-2" })).toBe("Nach HDMI-2 verschieben");
    expect(t("ar", "action.moveTo", { display: "HDMI-2" })).toBe("نقل إلى HDMI-2");
    expect(t("de", "inspector.scope.kind", { kind: "Clock" })).toBe("Alle Clock-Widgets");
    expect(t("ar", "inspector.scope.kind", { kind: "Clock" })).toBe("كل ودجات Clock");
  });

  it("resolves package-bundled translations with en and fallback chain", () => {
    const pkgTrans = {
      de: { title: "Systempuls" },
      ar: { title: "نبض النظام" },
      en: { title: "System Pulse" },
    };
    expect(resolvePackageString("de", pkgTrans, "title", "Fallback")).toBe("Systempuls");
    expect(resolvePackageString("ar", pkgTrans, "title", "Fallback")).toBe("نبض النظام");
    expect(resolvePackageString("en", pkgTrans, "missing", "Fallback")).toBe("Fallback");
  });
});

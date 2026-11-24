// Locale resolution, ICU `{param}` formatting, RTL helper, and document dir/lang synchronization.
import { CATALOG, type LanguagePref, type Locale, type MessageKey } from "./messages";

export type { LanguagePref, Locale, MessageKey };

export function resolveLocale(pref: string | undefined, navLang?: string): Locale {
  if (pref === "en" || pref === "de" || pref === "ar") return pref;
  const raw = (
    navLang ?? (typeof navigator !== "undefined" ? navigator.language : "en")
  ).toLowerCase();
  if (raw.startsWith("de")) return "de";
  if (raw.startsWith("ar")) return "ar";
  return "en";
}

export function isRtl(locale: Locale): boolean {
  return locale === "ar";
}

export function t(
  locale: Locale,
  key: MessageKey,
  params?: Readonly<Record<string, string | number>>,
): string {
  const template = CATALOG[locale][key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = params[name];
    return v !== undefined ? String(v) : `{${name}}`;
  });
}

/** Applies `lang` and `dir` to `document.documentElement` (for Settings/Onboarding windows). */
export function applyDocumentLocale(locale: Locale, mirrorDocument = true): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  el.lang = locale;
  if (mirrorDocument) {
    el.dir = isRtl(locale) ? "rtl" : "ltr";
  }
}

export function formatNumber(locale: Locale, value: number, digits = 0): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

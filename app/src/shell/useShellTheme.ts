// Applies Opaline's M3 Expressive palette, locale/RTL, and GNOME accessibility flags
// (high contrast, reduced motion, text scaling) to Settings and Onboarding windows.
import { argbFromRgb } from "@material/material-color-utilities";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_SOURCE, cssVariables } from "../design-system/color/scheme";
import { sourceFromWallpaper } from "../design-system/color/source";
import { applyPalette, setReducedMotion } from "../design-system/motion";
import { resolveStyle, rolesFor, sanitizeStyle } from "../design-system/style";
import { type Locale, applyDocumentLocale, isRtl, resolveLocale } from "../i18n";
import { type ShellState, fetchWallpaperBlobUrl } from "./api";

export function useShellTheme(state: ShellState | null): {
  wallpaperUrl: string | null;
  locale: Locale;
  rtl: boolean;
} {
  const [wallSource, setWallSource] = useState(DEFAULT_SOURCE);
  const [wallpaperUrl, setWallpaperUrl] = useState<string | null>(null);

  const locale = resolveLocale(state?.settings.language);
  const rtl = isRtl(locale);

  useEffect(() => {
    applyDocumentLocale(locale, true);
  }, [locale]);

  const highContrast = Boolean(state?.appearance?.highContrast);
  const reducedMotion =
    state?.appearance?.animations === false || Boolean(state?.appearance?.reducedMotion);
  const rawScale = state?.appearance?.textScale ?? 1;
  const textScale = Number.isFinite(rawScale) ? Math.min(2, Math.max(0.75, rawScale)) : 1;

  useEffect(() => {
    setReducedMotion(reducedMotion);
    const el = document.documentElement;
    el.dataset.highContrast = highContrast ? "true" : "false";
    el.dataset.reducedMotion = reducedMotion ? "true" : "false";
    el.style.setProperty("--text-scale", String(textScale));
  }, [highContrast, reducedMotion, textScale]);

  const primaryMonitor = state?.monitors.find((m) => m.primary) ?? state?.monitors[0] ?? null;
  const wallEntry =
    primaryMonitor && state?.wallpapers ? (state.wallpapers[primaryMonitor.key] ?? null) : null;
  const glassAsset = wallEntry?.glass ?? null;

  useEffect(() => {
    if (!glassAsset) return;
    let alive = true;
    let blobUrl: string | null = null;
    fetchWallpaperBlobUrl(glassAsset)
      .then((url) => {
        if (!alive) {
          if (url) URL.revokeObjectURL(url);
          return;
        }
        blobUrl = url;
        setWallpaperUrl(url);
        if (url) {
          return sourceFromWallpaper(url).then((src) => {
            if (alive) setWallSource(src);
          });
        }
        return undefined;
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [glassAsset]);

  const colors = useMemo(() => {
    const rgb = state?.appearance?.accentRgb;
    const accent =
      rgb?.length === 3
        ? argbFromRgb(
            Math.round((rgb[0] ?? 0) * 255),
            Math.round((rgb[1] ?? 0) * 255),
            Math.round((rgb[2] ?? 0) * 255),
          )
        : DEFAULT_SOURCE;
    const systemDark = state?.appearance?.colorScheme !== "light";
    return { wallpaper: wallSource, accent, systemDark };
  }, [state?.appearance, wallSource]);

  const roles = useMemo(() => {
    const baseStyle = sanitizeStyle(state?.settings.style);
    const style = resolveStyle(highContrast ? { ...baseStyle, contrast: 1 } : baseStyle).style;
    return rolesFor(style, colors);
  }, [state?.settings.style, colors, highContrast]);

  useEffect(() => {
    applyPalette(cssVariables(roles));
  }, [roles]);

  return { wallpaperUrl, locale, rtl };
}

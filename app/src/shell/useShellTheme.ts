// Applies Opaline's Material 3 Expressive color roles to Settings / Onboarding windows.
import { argbFromRgb } from "@material/material-color-utilities";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_SOURCE, cssVariables } from "../design-system/color/scheme";
import { sourceFromWallpaper } from "../design-system/color/source";
import { applyPalette } from "../design-system/motion";
import { resolveStyle, rolesFor, sanitizeStyle } from "../design-system/style";
import { type ShellState, fetchWallpaperBlobUrl } from "./api";

export function useShellTheme(state: ShellState | null): { wallpaperUrl: string | null } {
  const [wallSource, setWallSource] = useState(DEFAULT_SOURCE);
  const [wallpaperUrl, setWallpaperUrl] = useState<string | null>(null);

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
    const style = resolveStyle(sanitizeStyle(state?.settings.style)).style;
    return rolesFor(style, colors);
  }, [state?.settings.style, colors]);

  useEffect(() => {
    applyPalette(cssVariables(roles));
  }, [roles]);

  return { wallpaperUrl };
}

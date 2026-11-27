// Lazy theme font loader (DESIGN-2 §3.4, PLAN-2 4.15):
// Fonts load only while the active theme references them so unused families consume zero memory.
// Offline fallback stacks give JetBrains Mono, Space Grotesk, and Fraunces clean matching
// typography even when the optional font files aren't installed on the system.

export interface ThemeFontSpec {
  family: string;
  file: string;
  license?: string;
}

/** Curated offline fallback chains for theme display/mono/editorial font families. */
export const THEME_FONT_FALLBACKS: Readonly<Record<string, string>> = {
  "JetBrains Mono":
    '"JetBrains Mono", "Ubuntu Sans Mono", "DejaVu Sans Mono", "Noto Sans Mono", ui-monospace, monospace',
  "Space Grotesk":
    '"Space Grotesk", "Inter Variable", "Noto Sans Arabic Variable", system-ui, sans-serif',
  Fraunces: '"Fraunces", "Noto Serif", Georgia, "Liberation Serif", serif',
};

const loadedFaces = new Map<string, FontFace>();

/**
 * Loads `fonts` for `themeId` on demand via the CSS Font Loading API and releases any previously
 * loaded theme-scoped faces that are no longer needed. Safe in jsdom / headless environments.
 */
export async function syncThemeFonts(
  themeId: string,
  fonts: readonly ThemeFontSpec[],
): Promise<void> {
  if (typeof document === "undefined" || typeof FontFace === "undefined") return;
  const needed = new Set<string>();
  for (const f of fonts) {
    const key = `${themeId}:${f.family}:${f.file}`;
    needed.add(key);
    if (loadedFaces.has(key)) continue;
    try {
      const url = `opaline-asset://themes/${encodeURIComponent(themeId)}/${f.file}`;
      const face = new FontFace(f.family, `url("${url}")`);
      const ready = await face.load();
      document.fonts.add(ready);
      loadedFaces.set(key, ready);
    } catch {
      // Missing local asset falls back cleanly to THEME_FONT_FALLBACKS / system fonts.
    }
  }
  for (const [key, face] of loadedFaces) {
    if (!needed.has(key)) {
      document.fonts.delete(face);
      loadedFaces.delete(key);
    }
  }
}

export function loadedThemeFontCount(): number {
  return loadedFaces.size;
}

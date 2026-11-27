// Validates all ten built-in first-party look packages (spec/themes/<id>/theme.json),
// their curated starter layouts, and lazy font fallback stacks (PLAN-2 4.15–4.16).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildStarterLayout, BUILTIN_LOOK_IDS, starterLayoutForTheme } from "../../layer/presets";
import { fontStack, resolveCascade, sanitizeStyle } from "./index";

const themesDir = resolve(import.meta.dirname, "../../../../spec/themes");

describe("The ten built-in looks (4.15)", () => {
  it("loads and sanitizes all 10 spec/themes/<id>/theme.json manifests without dropping keys", () => {
    expect(BUILTIN_LOOK_IDS).toHaveLength(10);
    for (const id of BUILTIN_LOOK_IDS) {
      const raw = JSON.parse(readFileSync(resolve(themesDir, id, "theme.json"), "utf8")) as {
        id: string;
        name: string;
        style?: Record<string, unknown>;
        kinds?: Record<string, Record<string, unknown>>;
      };
      expect(raw.id).toBe(id);
      expect(raw.name.length).toBeGreaterThan(0);

      const rawStyle = raw.style ?? {};
      const clean = sanitizeStyle(rawStyle);
      for (const k of Object.keys(rawStyle)) {
        expect(clean, `theme "${id}" dropped style key "${k}"`).toHaveProperty(k);
      }

      const cascaded = resolveCascade({ theme: clean });
      expect(cascaded.style.surface).toBeDefined();

      for (const [kind, kStyle] of Object.entries(raw.kinds ?? {})) {
        const cleanKind = sanitizeStyle(kStyle);
        for (const k of Object.keys(kStyle)) {
          expect(cleanKind, `theme "${id}" kind "${kind}" dropped key "${k}"`).toHaveProperty(k);
        }
      }
    }
  });

  it("provides a valid starter layout that fits cleanly on a standard grid for every look", () => {
    for (const id of BUILTIN_LOOK_IDS) {
      const starter = starterLayoutForTheme(id);
      expect(starter.themeId).toBe(id);
      expect(starter.entries.length).toBeGreaterThanOrEqual(3);
      const built = buildStarterLayout(starter, 12, 8);
      expect(built.items.length).toBe(starter.entries.length);
      expect(Object.keys(built.widgets).length).toBe(starter.entries.length);
    }
  });

  it("maps theme display/mono/editorial fonts to clean offline fallback stacks", () => {
    expect(fontStack("JetBrains Mono")).toContain("monospace");
    expect(fontStack("Fraunces")).toContain("serif");
    expect(fontStack("Space Grotesk")).toContain("Inter Variable");
    expect(fontStack("Roboto Flex")).toContain("Roboto Flex Variable");
  });
});

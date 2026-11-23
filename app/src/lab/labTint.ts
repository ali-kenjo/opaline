// The stage-level glass tint and text luminance for a scheme (widgets override them per card).
import { buildRoles, type Variant } from "../design-system/color/scheme";
import { luminance } from "../design-system/glass/legibility";

export interface StageTint {
  rgb: [number, number, number];
  textLuminance: number;
}

export function labTint(source: number, variant: Variant, dark: boolean): StageTint {
  const roles = buildRoles({ source, variant, dark, contrast: 0 });
  const c = roles.surfaceContainer;
  const t = roles.onSurface;
  return {
    rgb: [(c >> 16) & 255, (c >> 8) & 255, c & 255],
    textLuminance: luminance((t >> 16) & 255, (t >> 8) & 255, t & 255),
  };
}

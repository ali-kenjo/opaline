// The inherit chain (ADR 0011): built-in default → global style → the widget's own style.
import { FIELD_BY_KEY, validValue } from "./fields";
import { BUILTIN_STYLE, type ResolvedStyle, STYLE_KEYS, type Style, type StyleKey } from "./types";

export type Origin = "default" | "global" | "widget";

export interface Resolution {
  style: ResolvedStyle;
  /** Where each value comes from, for the sheet's "inherited" labels and reset buttons. */
  origin: Record<StyleKey, Origin>;
}

/** Keeps only known keys with valid values (a stored file may be old or hand-edited). */
export function sanitizeStyle(raw: unknown): Style {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const field = FIELD_BY_KEY.get(k as StyleKey);
    if (field && validValue(field, v)) out[k] = v;
  }
  return out;
}

export function resolveStyle(global: Style = {}, own: Style = {}): Resolution {
  const style = { ...BUILTIN_STYLE } as Record<StyleKey, unknown>;
  const origin = {} as Record<StyleKey, Origin>;
  for (const key of STYLE_KEYS) {
    if (own[key] !== undefined) {
      style[key] = own[key];
      origin[key] = "widget";
    } else if (global[key] !== undefined) {
      style[key] = global[key];
      origin[key] = "global";
    } else {
      origin[key] = "default";
    }
  }
  return { style: style as unknown as ResolvedStyle, origin };
}

/** A merge patch that sets one key, or resets it to inherit with `null`. */
export function stylePatch(key: StyleKey, value: unknown): Record<string, unknown> {
  return { [key]: value ?? null };
}

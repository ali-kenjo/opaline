// Desktop look quick modes (2.0 brief §3.3, DESIGN-2 §6.4): one switch for every widget, applied
// on top of each widget's own resolved style, so switching back to Glass brings every widget's
// own look back. The master transparency scales every widget relative to its own setting.
import type { ResolvedStyle } from "./types";

export type DesktopLook = "glass" | "clear" | "tinted" | "dark" | "light" | "dimmed";

export const DESKTOP_LOOKS: readonly DesktopLook[] = [
  "glass",
  "clear",
  "tinted",
  "dark",
  "light",
  "dimmed",
];

export interface LookPrefs {
  look: DesktopLook;
  /** The Tinted look's one color (`#rrggbb`); `null` uses each widget's accent container. */
  lookColor: string | null;
  /** 0 (more solid) … 100 (clear); 50 leaves every widget as it is. */
  masterTransparency: number;
}

export const DEFAULT_LOOK: LookPrefs = { look: "glass", lookColor: null, masterTransparency: 50 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function applyDesktopLook(style: ResolvedStyle, prefs: LookPrefs): ResolvedStyle {
  const s = { ...style };
  switch (prefs.look) {
    case "glass":
      break;
    case "clear":
      if (s.surface === "opaque" || s.surface === "color") s.surface = "glass";
      s.transparency = Math.max(s.transparency, 88);
      s.blur = Math.min(s.blur, 24);
      break;
    case "tinted":
      if (s.surface !== "clear") s.surface = "tinted";
      if (prefs.lookColor) s.tintColor = prefs.lookColor;
      s.transparency = Math.min(s.transparency, 55);
      break;
    case "dark":
      s.theme = "dark";
      s.transparency = Math.min(s.transparency, 45);
      break;
    case "light":
      s.theme = "light";
      s.transparency = Math.min(s.transparency, 45);
      break;
    case "dimmed":
      s.appearance = "dimmed";
      break;
  }
  const m = clamp(prefs.masterTransparency, 0, 100);
  if (m !== 50 && s.surface !== "opaque") {
    // 0 doubles each widget's tint, 100 makes every widget completely clear.
    const factor = (100 - m) / 50;
    s.transparency = clamp(100 - (100 - s.transparency) * factor, 0, 100);
  }
  return s;
}

/** The look settings from core's `settings.appearance` (anything missing or invalid → default). */
export function lookPrefs(appearance: unknown): LookPrefs {
  const a = typeof appearance === "object" && appearance !== null ? appearance : {};
  const r = a as Record<string, unknown>;
  const look = DESKTOP_LOOKS.find((l) => l === r.look) ?? "glass";
  const lookColor =
    typeof r.lookColor === "string" && /^#[0-9a-fA-F]{6}$/.test(r.lookColor) ? r.lookColor : null;
  const master =
    typeof r.masterTransparency === "number" && Number.isFinite(r.masterTransparency)
      ? clamp(r.masterTransparency, 0, 100)
      : 50;
  return { look, lookColor, masterTransparency: master };
}

// Global Settings search index with deep links (PLAN-2 5.6, brief §6.4).

export type SettingsSectionId =
  | "looks"
  | "appearance"
  | "layout"
  | "widget-defaults"
  | "alerts"
  | "performance"
  | "privacy"
  | "desktop"
  | "shortcuts"
  | "backup"
  | "diagnostics"
  | "about";

export interface SettingSearchEntry {
  id: string;
  section: SettingsSectionId;
  sectionLabel: string;
  title: string;
  keywords: string;
}

export const SETTINGS_SEARCH_INDEX: readonly SettingSearchEntry[] = [
  {
    id: "looks-themes",
    section: "looks",
    sectionLabel: "Looks",
    title:
      "Built-in looks & themes (Opaline, Crystal, Bloom, Instrument, Air, Terminal, Neon, Paper, Mono, Classic)",
    keywords:
      "theme look crystal bloom instrument air terminal neon paper mono classic starter layout",
  },
  {
    id: "appearance-language",
    section: "appearance",
    sectionLabel: "Appearance",
    title: "Language (English, Deutsch, العربية)",
    keywords: "language locale i18n rtl arabic german english",
  },
  {
    id: "appearance-color",
    section: "appearance",
    sectionLabel: "Appearance",
    title: "Color source, scheme variant & contrast",
    keywords: "color wallpaper accent seed material expressive tonal contrast dark light",
  },
  {
    id: "appearance-look",
    section: "appearance",
    sectionLabel: "Appearance",
    title: "Desktop look mode & master transparency",
    keywords:
      "desktop look glass clear tinted dark light dimmed master transparency blur rim shadow",
  },
  {
    id: "layout-presets",
    section: "layout",
    sectionLabel: "Layout",
    title: "Starter presets & monitor placement mode (Grid / Free)",
    keywords: "preset layout grid free mode cell size margin monitor display",
  },
  {
    id: "layout-cellsize",
    section: "layout",
    sectionLabel: "Layout",
    title: "Grid cell size (72 / 84 / 96 / 112 px) & safe margins",
    keywords: "grid cell size 72 84 96 112 margin work area disconnected monitor",
  },
  {
    id: "defaults-inspector",
    section: "widget-defaults",
    sectionLabel: "Widget defaults",
    title: "Per-widget Inspector, Weather location, Network billing day & Calendar feeds",
    keywords: "widget defaults weather city open-meteo billing latency calendar ics eds inspector",
  },
  {
    id: "alerts-rules",
    section: "alerts",
    sectionLabel: "Alerts",
    title: "Threshold alerts & notifications",
    keywords: "alert notification threshold cpu memory gpu temperature battery",
  },
  {
    id: "performance-mode",
    section: "performance",
    sectionLabel: "Performance",
    title: "Performance profile (Eco / Balanced / Realtime) & battery pause",
    keywords: "performance eco balanced realtime battery pause cpu sampling",
  },
  {
    id: "privacy-network",
    section: "privacy",
    sectionLabel: "Privacy",
    title: "Public IP lookup, daily update checks & privileged RAPL sensors",
    keywords: "privacy network telemetry public ip update check rapl polkit helper",
  },
  {
    id: "desktop-integration",
    section: "desktop",
    sectionLabel: "Desktop integration",
    title: "GNOME Shell helper (Native Wayland vs Instant mode)",
    keywords: "gnome shell extension helper native wayland instant xwayland",
  },
  {
    id: "shortcuts-keys",
    section: "shortcuts",
    sectionLabel: "Shortcuts",
    title: "Keyboard shortcuts (Peek, Edit widgets) & conflict detection",
    keywords: "shortcut hotkey keybinding peek edit conflict super alt",
  },
  {
    id: "backup-export",
    section: "backup",
    sectionLabel: "Backup",
    title: "Export & import backup (settings, layouts, themes; secrets excluded)",
    keywords: "backup export import restore json reset rice theme",
  },
  {
    id: "diagnostics-live",
    section: "diagnostics",
    sectionLabel: "Diagnostics",
    title: "Live memory, providers, logs & debug report",
    keywords: "diagnostics memory pss cpu logs providers debug report",
  },
  {
    id: "about-updates",
    section: "about",
    sectionLabel: "About",
    title: "Version, license (GPL-3.0) & update checks",
    keywords: "about version license gpl updates github",
  },
];

export function searchSettings(query: string): SettingSearchEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return SETTINGS_SEARCH_INDEX.filter(
    (entry) =>
      entry.title.toLowerCase().includes(q) ||
      entry.sectionLabel.toLowerCase().includes(q) ||
      entry.keywords.includes(q),
  );
}

/** Detects duplicate or reserved GNOME shortcut conflicts. */
export function detectShortcutConflicts(peek: string, edit: string): string[] {
  const conflicts: string[] = [];
  const norm = (s: string) => s.trim().toLowerCase();
  const p = norm(peek);
  const e = norm(edit);
  if (p && e && p === e) {
    conflicts.push("Peek and Edit widgets cannot use the same shortcut.");
  }
  const reserved: Readonly<Record<string, string>> = {
    "<super>l": "GNOME Lock Screen",
    "<super>d": "GNOME Show Desktop",
    "<super>a": "GNOME Show Apps",
    "<alt>tab": "Window switcher",
    "<super>tab": "Application switcher",
  };
  if (reserved[p]) conflicts.push(`Peek (${peek}) conflicts with ${reserved[p]}.`);
  if (reserved[e]) conflicts.push(`Edit (${edit}) conflicts with ${reserved[e]}.`);
  return conflicts;
}

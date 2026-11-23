# ADR 0011: Every widget is fully customizable

Status: accepted (Phase 2 sign-off) · 2026-11-23

## Context
At the Phase 2 sign-off the user asked for widgets that are "fully customizable: color, fonts, transparency, and so
on", for the information on every widget to be editable, and for "as many settings as possible". The brief has a
settings sheet per widget and global appearance settings (Phase 6), but no per-widget style and no field editing.

## Decision
Customization is one shared system, built before the first widget (Phase 3 task 3.0), so every widget gets it the
same way instead of 14 hand-made settings sheets.

**Three layers, each overriding the one before:** built-in defaults → global style (Settings → Appearance, also
"Widgets → Defaults") → the widget's own style. Every per-widget value is optional; unset means "inherit", and each
row in the sheet shows where its value comes from and has a reset. A widget's style can be copied to others or to
all widgets of its kind, and saved as a named style.

**Style (every widget):**
- *Color:* source (wallpaper, GNOME accent, custom seed color), scheme variant, contrast level, light/dark/auto,
  accent override, text color override, colors of the hero visual (ramp or a fixed color).
- *Surface:* glass / tinted / opaque / custom color; transparency (glass slider 0–100); blur strength; tint color;
  refraction, specular rim and grain on/off and strength; shadow on/off and strength; border width and color;
  corner radius (with "follow size class"); padding / density.
- *Text:* font family for labels and for numbers (bundled Roboto Flex, Inter, Noto Sans Arabic, plus any installed
  system font, listed by core through fontconfig), weight, width (Roboto Flex `wdth`), size scale, letter spacing,
  tabular numbers, odometer animation on/off, text shadow for legibility.
- *Icons:* show/hide, filled or outlined, weight.
- *Motion:* animations on/off for this widget, speed (spring preset).
- *State:* appearance state override (Full / Dimmed / Automatic), dim level, hover lift on/off.

**Content (per widget, declared by its `settingsSchema`):** which fields are shown and in which order (drag to
reorder, toggle to hide), a custom label/title per field, which field is the hero, the hero visual style (ring,
bar, sparkline, number only), units (°C/°F, bit/byte, GB/GiB, 12/24 h), decimals, the source where there are several
(which GPU, drive, interface, battery, calendar, location), the sparkline's history range, thresholds and colors of
warning/critical levels, and the sampling class within the engine's limits (never faster than the topic's floor).

**Storage:** `settings.json` gains `style` (global) and `widgets` (`instanceId → { kind, style, content }`).
Core types and validates `style` (ranges, hex colors, known enums) like every other setting. `content` is stored as
a bounded JSON object (≤ 16 KB per widget) that core keeps opaque; the widget's `settingsSchema` validates it in the
frontend and drops unknown or invalid keys, so an old or hand-edited file can't break a widget.

**Legibility stays a guarantee by default:** adaptive legibility (DESIGN.md §4) still raises the tint
until text keeps 4.5 : 1. The user may turn it off per widget; the sheet then shows the measured contrast and a
warning below 4.5 : 1 instead of silently allowing unreadable text. High contrast / reduce transparency (system
settings) win over per-widget style.

## Consequences
- Phase 3 starts with 3.0 (style resolution, the generic settings sheet built from schemas, store changes, fonts
  list), then each widget only declares its content schema.
- The compositor already takes per-surface tint and alpha; per-surface blur strength, rim, grain and shadow become
  per-instance attributes (no extra draw calls).
- System fonts can make a widget look broken if the font lacks glyphs; the font picker previews each font with the
  widget's real text and falls back per glyph through WebKit's fontconfig fallback.
- Phase 6 (Settings app) reuses the same controls for the global style.
- More settings mean more states to test: the Lab gets a "style" panel that applies any style to every widget, and
  screenshot baselines cover a few extreme styles (opaque custom color, clear glass, large text, system font).

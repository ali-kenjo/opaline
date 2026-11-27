# Opaline 2.0 design language

Status: **in progress** (P1, 2026-11-26). §1–8 and §11 hold decisions; §9–10 and §12–15 are filled in later in P1
and in P4 (theme chapters and per-widget layouts).
`docs/DESIGN.md` stays the reference for the 1.1 system, which ships as the **Classic** theme.

## 1. Principles
- One hero per widget and size; the composition is designed per widget and per size, not one template.
- The wallpaper is part of the design: see-through by default, readable by adapting text before adding tint.
- Progressive disclosure: essentials first, everything else one level deeper.
- Shapes and color carry meaning (heat, sleep, charge, weather), never decoration alone; status is never color alone.
- Labels are never cut; user data may end in an ellipsis at a word boundary.
- Idle means no frames; reduced motion is respected everywhere.
- Original work only: no Apple or Google assets, fonts, icons, logos or trademarked names.

## 2. Theme model
How a theme is built (maps to `theme.json`, §5.2 of the brief):
- **Tokens**: color source and scheme (or a fixed palette), type scale, shape language, motion personality, glass
  defaults, spacing and density.
- **Style layers**: global, per widget kind, per role or block id.
- **Layouts**: optional compositions per widget kind and size.
- **Assets**: fonts (with licenses), images, `theme.css`.
- **Starter layouts**: shown in onboarding and Settings → Looks.

## 3. Type
- 3.1 **Roles**: `hero`, `unit` (shares the hero's baseline), `title`, `value`, `label`, `caption`, `accent`.
  Every block in a composition (P2) has one; themes style roles, not elements.
- 3.2 **Opaline scale** (from the P1 hybrid, `app/src/lab/directions/opaline.tsx`; tuned in P4 per widget):

  | Role | S | M | L / XL | Family and axes | Notes |
  | - | - | - | - | - | - |
  | hero | 80–104 px | 96–124 px | auto-fit | Roboto Flex, `wght` 780, `wdth` 30, `opsz` 144 | line height 0.86, tracking −1.5 %, tabular |
  | unit | 0.34 × hero | 0.34 × hero | 0.34 × hero | Roboto Flex `wght` 600, `wdth` 60 | same baseline as the hero |
  | value | 18 px | 18–24 px | 20–28 px | Roboto Flex `wght` 650, `wdth` 80 | tabular |
  | title | 15 px | 15–21 px | 21 px | Inter 600–650 | user data (song, event) may ellipsize |
  | label | 13 px | 13 px | 13 px | Inter 450, 74 % emphasis | written short form per field |
  | caption | 11–12 px | 11–12 px | 12 px | Inter 450, 74 % emphasis | times, scales, axis ticks |

  Crystal uses the same scale; Bloom uses Roboto Flex `wght` 690, `wdth` 100, `opsz` 72–96 inside shapes; Instrument
  uses `wght` 560, `wdth` 118, `opsz` 36 (extended, calm).
- 3.3 **Auto-fit** (P2 Number block): first narrow the `wdth` axis down to the role's minimum (hero 25), then reduce
  the size down to the role's minimum (hero 0.6 × its designed size). Never below; then the layout degrades (§5).
  Built for hero Number blocks in `app/src/design-system/components/fitNumber.ts` (e2e `hero-fit.spec.ts`).
- 3.4 **Fonts**: the width axis works only on bundled variable fonts (ADR 0013); system fonts get weight and named
  widths. Fonts load only while a theme uses them. Arabic falls back to Noto Sans Arabic in every role.
  `text-scaling-factor` multiplies every size.
- 3.5 **OpenType**: tabular figures for every number; slashed zero optional (Terminal, Instrument).
- 3.6 **Legibility on glass** (Opaline and Crystal): text carries a soft halo instead of a tint behind it: dark
  wallpapers `0 0 1px rgb(0 0 0 / .35), 0 1px 12px rgb(0 0 0 / .3)`, light wallpapers the same in white (§8.4).

## 4. Widget anatomy
- 4.1 **Hero first.** One hero per card and size (a number, a dial, a shape badge, the art); everything else is
  secondary or a caption. **No header** where the content explains itself (clock, weather, media, photos, date tile);
  elsewhere a glyph or a short title, never a large icon plus title above an obvious visual.
- 4.2 **Padding and radii** as in `DESIGN.md` §1–2 (S 16 px / M 20 px padding, radius 28 / 32, concentric inner radii);
  the hybrid uses 16 × 18 px. Rows may reach 8 px into the bottom padding, never further (§5).
- 4.3 **Per-size intent**: 1×1 and 2×1 are complications (one value); 1×2 vertical controls; S and M glanceable
  (hero plus at most two facts); 2×4 Tall and 6×4 Wide; L and XL small dashboards with charts and lists. Opaline puts
  Instrument's dial and charts at M and up, Pebble's shapes only where they mean something (§7).
- 4.4 **Interactive parts** (buttons, toggles, sliders in widgets): 40 px minimum hit target, 28 px visible minimum.

## 5. Responsive rules (implemented for today's widgets in P1; compositions inherit them in P2)
- 5.1 **Degradation order** for a label/value row: drop the icon → the field's written short label → hide the label
  (it stays in the tooltip and the accessible name) → drop the row. **Values are never cut**: a row whose value can't
  fit is dropped. Rows that would end more than 8 px into the card's bottom padding are dropped, last first.
  Code: `design-system/components/Fit.tsx` (`Fit`, `fitRows`), used by `StatLayout` and the clock.
- 5.2 **Short labels** are written per field (`FieldDef.shortLabel`: "Video memory" → "VRAM", "Read / write" → "I/O"),
  only used while the user hasn't renamed the field, and translated with the labels; never generated by cutting.
  Text with several natural forms lists them (the clock's date: long → "Mon, Nov 23" → "Nov 23").
- 5.3 **User data** (song titles, artists, event names, container and process names, network names) may end in an
  ellipsis at a word boundary and is marked `data-user-text`; labels and values never are.
- 5.4 **In-between sizes** use CSS container queries (ADR 0013).
- 5.5 **Enforced by the Lab**: `app/e2e/truncation.spec.ts` fails on any label or value that is clipped, ellipsized
  or reaches past any edge of its card (odometer digit strips excepted); the contrast check follows in task 1.9.

## 6. Color
- 6.1 Scheme pipeline unchanged: material-color-utilities from the wallpaper, the GNOME accent or a custom color.
- 6.2 **Color identity per widget kind**: a design color per kind, harmonized with the scheme's source in HCT
  (`Blend.harmonize`), giving four roles: `tint` (glass tint, tone 22 dark / 92 light, chroma ≤ 28), `container`
  (tone 78 / 86), `onContainer` (18 / 14), `accent` (76 / 48) and `onAccent` (14 / 98)
  (`app/src/lab/directions/data.ts`, moved into the design system in P2). Starting colors:

  | Kind | Design color | Used for |
  | - | - | - |
  | Clock, World clock | `#8f7cf0` | second hand, expressive digits |
  | CPU, Fans | `#f2903a` (thermal) | heat badge, history area, core bars |
  | Weather | sun `#ffb648`, sky `#6aa8ff` | sky shapes, temperature curve, rain bars |
  | Now Playing, Visualizer | `#e0609a`, or from the album art | progress, waveform |
  | Memory | violet (P4) | |
  | Storage | amber (P4) | |
  | Network | cyan (P4) | |
  | Battery & Power | green, amber and red when low (P4) | |
  | Calendar | the calendar's own color | |
- 6.3 **Ramps** (thermal, load, health) stay; status is never color alone (an icon, a word or a shape goes with it).
- 6.4 **Desktop look modes** (built in P1; `design-system/style/look.ts`): applied on top of every widget's own style,
  so Glass brings every widget's look back. Clear: transparency at least 88, blur at most 24. Tinted: one tint color
  for all (Settings → Appearance), transparency at most 55. Dark and Light: that scheme, transparency at most 45.
  Dimmed: the dimmed state. **Master transparency** 0–100 (50 = unchanged) scales each widget relative to its own
  transparency (0 doubles every tint, 100 makes all clear). On the Edit toolbar (Look) and in Settings → Appearance.

## 7. Shape
- 7.1 Card shapes: rounded rectangles today; continuous squircle corners, per-corner radii and library shapes as
  surface options (P3).
- 7.2 **Meanings** (only where a shape says something):
  - CPU heat badge: circle below 45 °C → 7-sided cookie below 65 → soft burst below 80 → burst from 80.
  - Weather: sun (`sunny`) and cloud (`puffy`); rain `puffyDiamond`; snow and storm shapes in P4.
  - Album art and photos: masked by a 12-sided cookie by default (any library shape as an option); the mask breathes
    with the bass (P4).
  - Sleeping GPU → moon/pill; battery liquid pill with bubbles; Wi-Fi signal shape (P4).
- 7.3 Morphs use `spatial.default`; under reduced motion shapes switch with a 150 ms crossfade.

## 8. Glass 2.0 and see-through
- 8.1 **Per-surface stack** (one pass): backdrop sample by see mode → refraction band → tint (color or gradient) →
  rim and specular → inner shadow → grain → border; drop shadow outside.
- 8.2 **See modes** (ADR 0012): `sampled` (1.x quarter resolution), `sharp` (full-resolution wallpaper; blur 0 is
  sharp, more blur walks its mipmaps, then crossfades into the Gaussian texture) — the default — and `alpha` ("Real
  transparency": the desktop shows through, desktop icons included; switches to `sharp` during Peek and Edit).
- 8.3 **Ranges**: blur 0–100 (0 = sharp), tint 0–100 independent of blur, refraction 0–2, rim 0–2, shadow 0–2,
  grain 0–2 (1 = the designed look). Opaline: tint ≈ 14 %, refraction 1.5, rim 1.6, shadow 0.8; Crystal tint 10 %,
  rim 1.9; Bloom tint 46 % in the kind's tint color; Instrument a smoked tint (`#0e0e12`) at 60 % with a 1 px
  12 % white hairline. **Opaline's default glass, tuned with the owner on the real desktop (2026-11-26): blur 30,
  transparency 80, "Keep text readable" on.** The built-in default stays the 1.x look (blur 60, transparency 60) until
  the theme engine (P3), so Classic stays exact; the Opaline theme carries the tuned values.
- 8.4 **Legibility 2.0** (built in P1; `design-system/glass/backdrop.ts`, `GlassStage.tsx`). Applies only where a
  widget is clearer than the 1.x look (transparency above 60, blur below 60 or real transparency), so Classic stays
  1.x. Per widget, once per wallpaper, from the wallpaper image itself (a 768 px wide luminance map, about 1.3 MB):
  mean brightness and the darkest and brightest 1 % behind the widget (text-like detail covers 1–2 % of a card).
  Then, in this order:
  1. **Ink**: light or dark text (the on-surface roles of the dark and light scheme), whichever reads better against
     the glass's worst case (light text against the brightest detail, dark text against the darkest).
  2. **Halo** behind the text when detail shows or contrast is below 7 : 1 (§3.6).
  3. With "Keep text readable" on and still below target (4.5 : 1, or 3 : 1 with a halo): **more blur first**, up to
     the 1.x level, which removes the detail behind the text while the glass stays clear;
  4. **the tint last**. Real transparency can't blur, so it goes straight to the tint.
  Without "Keep text readable", nothing changes the look: the widget settings sheet shows the measured contrast and
  warns below 4.5 : 1. For the 1.x path the tint is judged on the weaker secondary text color, with a 4.7 : 1 target
  (a margin over 4.5 for the coarse brightness estimate). A solid custom surface color picks its text scheme by its own
  brightness when the theme is Automatic.
- 8.5 Opaque mode (reduce transparency, high contrast) wins over everything.
- 8.6 CSS styles the content, never the glass: the glass is drawn by WebGL (`theme.css` and `user.css` can't change
  it; `docs/THEMING.md` says so).

## 9. Motion
- 9.1 Spring tokens (unchanged from `DESIGN.md` §6) and per-theme motion personalities (e.g. Bloom bouncier,
  Crystal calmer, Terminal instant).
- 9.2 Staggered entrances; value changes as odometer or crossfade; hover lift or 3-D tilt with a following
  specular highlight; press 0.97; shared-element morphs between sizes; theme-switch transitions.
- 9.3 Ambient motion (skies, auras, fan spin) only while visible and not covered; reduced motion and dimmed rules.

## 10. Icons
- Material Symbols Rounded, Outlined, Sharp (Apache-2.0), subset per set; fill, weight, grade; app icons from the
  system icon theme for processes, launchers and peripherals.

## 11. The ten looks

**Decided 2026-11-26** (P1 task 1.1, Lab page `lab.html?only=directions`, screenshots in `docs/design/`): the owner
wants all three directions. Lens becomes **Crystal**, Pebble becomes **Bloom**, Instrument becomes a new tenth theme,
**Instrument**, and the default **Opaline** is the hybrid: Lens's clear glass and bold condensed numerals as the base,
Pebble's shapes only where they carry meaning (CPU heat badge, weather sky, album-art mask), and Instrument's charts,
gauges and dial at the larger sizes and as clock faces.

One chapter each, with: character, type, shape language, surface treatment, motion personality, hero visuals, clock
faces, color handling, starter layouts, Lab sheet.
- 11.1 **Opaline** (default): the hybrid described above.
- 11.2 **Crystal** (direction A, Lens): clear glass, squircles, large heavy condensed numerals, almost no labels,
  text held by a soft halo.
- 11.3 **Bloom** (direction B, Pebble): glass tinted per widget kind, library-shape badges, tonal containers, wavy
  progress, playful morphs.
- 11.4 **Air**: frameless, haloed text, widgets floating on the wallpaper.
- 11.5 **Terminal**: JetBrains Mono, box-drawing frames, TUI bars and sparklines, ANSI-like palette from the wallpaper.
- 11.6 **Neon**: dark surfaces, glowing gradient outlines, synthwave palette, Space Grotesk.
- 11.7 **Paper**: matte and light, Fraunces with a grotesk, hairlines, no glass.
- 11.8 **Mono**: monochrome, high contrast, e-ink calm; the Dimmed state's natural partner.
- 11.9 **Classic**: exactly 1.1 (`DESIGN.md`).
- 11.10 **Instrument** (direction C): smoked glass with a hairline edge, analog dials, arc gauges with ticks, charts
  with real scales, extended numerals; a watch face or car cluster rather than a dashboard.

## 12. Signature layouts per widget
A page per widget (filled in P4): sizes supported, the hero at each size, element priorities, detail view, states
(loading, unavailable, asleep, needs permission, empty/auto-hide, alert), and Lab references.

## 13. States
Resting, hovered, pressed, lifted, dimmed, alert, loading, unavailable/asleep/needs permission, auto-hidden; how
each theme expresses them.

## 14. Accessibility and i18n
Contrast targets, focus rings, keyboard order inside compositions, generated accessible names, reduced motion, text
scale; RTL inside widgets while grid positions never mirror; Arabic type pairing per theme.

## 15. The Lab
Theme switcher, light and dark wallpapers, widget × size × theme × state matrix, the zero-truncation and contrast
checks, and which combinations have stored baselines (PLAN-2 decision 5).

# Opaline design system: "Glass + Expressive"

Status: Phase 2 (2026-11-23). The source of truth for values is `app/src/design-system/tokens/`; this document
explains them. Reference points (brief §4): Liquid Glass's uniform refraction, readability and consistent radii, and
Material 3 Expressive's dynamic color, shapes and spring motion. Everything here is original: no Apple or Google
assets, logos or trademarks. The shapes and motion values are ported from Apache-2.0 androidx sources, credited in
`THIRD_PARTY.md`.

## 1. Space and size

| Token | Value | Use |
| - | - | - |
| `--space-1` … `--space-8` | 4, 8, 12, 16, 20, 24, 32, 40 px | the 4-pt scale; nothing uses other gaps |
| `--pad-s` / `--pad-m` | 16 / 20 px | widget padding: S (2×2 and smaller) / M and larger |
| `--cell` / `--gap` | 84 / 12 px | the grid (§2.4): S = 2×2 = 180 × 180, M = 4×2, L = 4×4, XL = 8×4; 1×1, 2×1, 4×1 where allowed |
| `--margin-safe` | 24 px | inset of the grid inside each monitor's work area |

## 2. Shape

- **Concentric radii.** Card radius 28 px for S and smaller, 32 px for M and larger. Anything nested inside a card uses
  `inner = outer − padding` (S: 28 − 16 = 12 px; M: 32 − 20 = 12 px), so corners stay parallel.
- `--radius-pill` (999 px) for chips, toggles and buttons; `--radius-xs` 8 px for tiny elements.
- **Expressive shapes** (`design-system/shapes/`): a port of androidx `graphics-shapes` (RoundedPolygon,
  CornerRounding, Morph) and the 35 `MaterialShapes`. Shapes carry meaning, never decoration: heat (Sunny/Burst for
  hot), sleep (Clover → Pill as the dGPU sleeps), weather (Sunny, Cloud-ish Cookie), beat (Burst pulses with the
  visualizer), loading (the M3 Expressive loading indicator morphs Soft Burst → Cookie 9 → Pentagon → Pill →
  Sunny → Cookie 4 → Oval).

## 3. Color

- **Scheme.** `@material/material-color-utilities` builds a dynamic scheme from a source color: the wallpaper
  (default; QuantizerCelebi + Score on the 128 × 128 thumbnail core renders), the GNOME accent, or a custom color.
  Variants: Tonal Spot (default), Vibrant, Expressive, Fidelity, Neutral, Monochrome. Light/dark follows the system;
  contrast level −1 … 1 (the GNOME high-contrast setting implies 1 and opaque surfaces).
- **Roles → CSS.** Every M3 role becomes `--md-<role>` as an `R G B` triple, used as `rgb(var(--md-primary))` or
  `rgb(var(--md-primary) / 0.4)`. Palette changes animate with an effects spring (no overshoot).
- **Semantic ramps** are built in HCT from the scheme so they harmonize with it, and are always paired with an icon or
  a label (status never by color alone): **thermal** cool teal → amber → red, **load** primary → tertiary → error,
  **health** green → amber → error.
- **Now Playing** derives its own scheme from the album art.
- **Dimmed** (appearance state): desaturated, slightly darker glass, monochrome content in on-surface tones; primary
  values still ≥ 4.5 : 1.

## 4. Material: glass

Each widget surface is drawn by the glass compositor (one WebGL2 canvas behind the DOM per layer window), in this order:

1. **Wallpaper sample**: the quarter-resolution blurred wallpaper core renders, sampled at the widget's exact screen
   position.
2. **Tint**: `surface-container` mixed in at the glass strength (slider Clear 0 … Tinted 100, default 45).
3. **Edge refraction**: a lens-like displacement of the sample within ~14 px of the border.
4. **Specular rim**: a 1 px highlight lit from the top left; while hovered it leans faintly toward the pointer.
5. **Shadows**: a soft drop shadow (y + 8, blur 24, 28 % black) and a faint inner shadow along the bottom edge.
6. **Grain**: 2.5 % noise against banding.

- **Adaptive legibility.** Core's 8 × 8 luminance grid of the blurred wallpaper gives the background luminance under
  each widget; the tint is raised until the primary text color reaches 4.5 : 1 against the composited surface.
- **Opaque mode** (reduce transparency, high contrast): surfaces are `surface-container` at 100 %, outlines get
  stronger (`outline` role, 1.5 px).
- **Fallback** without WebGL2: CSS (the blurred wallpaper as a fixed-position background + the tint layer).
- **Backdrop** (Edit/Peek): the same compositor draws the heavier blur full-screen at 92 % opacity.
- The compositor draws only when something is dirty (layout, theme, wallpaper, pointer over a hovered widget, active
  springs); idle means no frames.

## 5. Elevation and states

| State | Change |
| - | - |
| resting | glass as above |
| hovered | rim brightens, tint −4 points, cursor-following rim highlight |
| pressed | scale 0.98 (spatial.fast) |
| lifted (dragging) | scale 1.04, shadow y + 16 / blur 40 / 36 % |
| dimmed | saturation 0.25, tint +12, content `on-surface-variant` |
| alert | 2 px `error` outline pulse (effects.slow), icon + label |
| loading | loading indicator shape morph, content skeleton at 40 % opacity |
| unavailable / asleep / needs permission | the reason as text with its icon; no placeholder numbers |

## 6. Motion

Spring tokens, verified against androidx `ExpressiveMotionTokens.kt` (androidx-main, 2026-11-23):

| Token | Stiffness | Damping ratio | Use |
| - | - | - | - |
| `spatial.fast` | 800 | 0.6 | press, small moves |
| `spatial.default` | 380 | 0.8 | layout, size, shape |
| `spatial.slow` | 200 | 0.8 | detail-view morph, large moves |
| `effects.fast` | 3800 | 1.0 | hover tint |
| `effects.default` | 1600 | 1.0 | color, opacity |
| `effects.slow` | 800 | 1.0 | palette changes, dimming |

- Mass 1; damping coefficient `c = 2·ζ·√k`.
- One in-house solver (`design-system/motion/`) runs every layout spring (DOM and glass) in a single rAF scheduler;
  every animation can be interrupted and retargets mid-flight with its current velocity. No rAF while idle.
- Numbers roll like an odometer: per-digit springs, tabular figures.
- **Reduced motion** (`enable-animations = false` or reduced-motion): springs are replaced by ≤ 150 ms crossfades,
  and there are no morphs.

## 7. Type and icons

- **Roboto Flex** (variable) for numerals and display text, tabular figures (`font-variant-numeric: tabular-nums`),
  with a subtle weight/width response to value changes. **Inter** (variable) for UI text. **Noto Sans Arabic** for
  Arabic. All bundled; nothing is loaded from the network.
- Scale (px / line height): display 44/48 · headline 30/36 · title 18/24 · body 14/20 · label 12/16 · micro 11/14.
  `text-scaling-factor` multiplies the root size.
- **Material Symbols Rounded** (variable), fill 0 → 1 and weight 400 → 600 animated with state (active, alert).

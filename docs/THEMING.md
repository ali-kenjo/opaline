# Theming and User CSS

Opaline supports complete theme packages (`theme.json` + optional assets and `theme.css`), shareable desktop setups (**rices**, `.opaline-rice`), and a live-reloaded `~/.config/opaline/user.css` escape hatch.

## Theme packages

A theme is either a folder (`<id>/theme.json`) or a `.opaline-theme` ZIP archive. Opaline searches three locations in order of increasing priority (later entries override earlier ones with the same `id`):

1. `/usr/share/opaline/themes/` (first-party themes: `opaline`, `classic`, …)
2. `~/.local/share/opaline/themes/` (installed themes)
3. `~/.config/opaline/themes/` (your own themes)

### `theme.json` structure

Include `"$schema": "file:///usr/share/opaline/schemas/theme.schema.json"` for autocomplete and validation.

- **Metadata:** `schemaVersion` (`1`), `id`, `name`, `author`, `version`, `license`, `description`, optional `previews` and `minOpalineVersion`.
- **Tokens (`tokens`):** `colorSource` (`wallpaper` / `accent` / `custom`), `seedColor`, `variant`, optional fixed `palette` overrides, `motionPersonality`, `shapeLanguage`.
- **Style layers:** `style` (all widgets), `kinds` (per widget kind such as `cpu`, `clock`, `weather`), `elements` (per role or `#block-id`).
- **Layouts (`layouts`):** Optional per-kind composition trees (`docs/COMPOSITION.md`).
- **Assets:** `fonts` (each entry **must** bundle a license file inside the package), `images`, and optional `css` (defaults to `theme.css` when present).

If any key in a theme is invalid, Opaline falls back key by key, displays a non-blocking problem notice with the file and JSON pointer, and never blanks the desktop.

## Data-attribute contract

Every widget and composition block carries stable HTML attributes that `theme.css` and `user.css` can target:

| Attribute | Where | Examples |
| - | - | - |
| `data-theme` | `<html>` and each widget root | `opaline`, `classic`, `my-theme` |
| `data-kind` | Widget root | `clock`, `cpu`, `memory`, `weather`, `media` |
| `data-size` | Widget root & inner container | `1x1`, `2x1`, `4x1`, `S`, `M`, `L`, `XL` |
| `data-state` | Widget root & blocks | `ready`, `loading`, `unavailable`, `asleep`, `needs-permission`, `alert` |
| `data-role` | Composition blocks | `hero`, `title`, `label`, `value`, `unit`, `caption`, `accent`, `badge`, `meter`, `decoration` |
| `data-block` | Composition blocks | Stable block id (`hours`, `date`, `temp`, …) |
| `data-type` | Composition blocks | `text`, `number`, `icon`, `ring`, `bar`, `chart`, `list`, … |

## CSS custom properties

Every widget root exposes Material 3 color triples (space-separated RGB for `rgb(var(--md-...) / <alpha>)`) and style variables:

- **Palette:** `--md-primary`, `--md-on-primary`, `--md-primary-container`, `--md-surface`, `--md-surface-container`, `--md-on-surface`, `--md-on-surface-variant`, `--md-outline`, `--md-outline-variant`, `--md-error`, `--md-tertiary`.
- **Typography & spacing:** `--w-font`, `--w-num-font`, `--w-weight`, `--w-wdth`, `--w-scale`, `--w-letter`, `--w-line-height`, `--w-nums`, `--w-font-features`, `--w-label-case`, `--w-text-shadow`, `--w-padding`, `--w-gap`, `--w-radius`, `--w-radii`.
- **Icons:** `--w-icon-family`, `--w-icon-fill`, `--w-icon-weight`, `--w-icon-grade`, `--w-icon-size`, `--w-icon-color`, `--w-icons`.
- **Per-role typography:** `--w-role-<role>-font`, `--w-role-<role>-weight`, `--w-role-<role>-wdth`, `--w-role-<role>-size`, `--w-role-<role>-letter`, `--w-role-<role>-lh`, `--w-role-<role>-color`, `--w-role-<role>-opacity`.

## Important: CSS styles content, not the WebGL glass

Opaline's frosted/clear glass surfaces, refraction, specular rims, chromatic dispersion, drop shadows, and expressive card shapes are rendered in a single pass by the **WebGL2 glass compositor** behind the DOM. Because the glass is drawn on a WebGL canvas rather than CSS `backdrop-filter`, CSS rules in `theme.css` and `user.css` style widget **content** (typography, spacing, colors, badges, borders on inner elements) and cannot alter the WebGL glass shader directly. Configure glass parameters (`blur`, `transparency`, `refraction`, `dispersion`, `rim`, `specularAngle`, `innerGlow`, `cardShape`, `shadow*`) through `theme.json` or `settings.json` instead.

## Security rules for CSS

Core reads and validates both `theme.css` and `~/.config/opaline/user.css` before publishing them to the layer (and the webview CSP enforces the same boundary):

- Remote `url(http://...)`, `url(https://...)`, `url(//...)`, and `url(file://...)` are rejected.
- `@import`, `javascript:`, and `expression()` are rejected.
- Files are capped at 256 KiB.
- Passing `opaline --safe-mode` disables both `theme.css` and `user.css` immediately.

## Example `user.css`

```css
/* Slightly tighter tracking on all Clock hero numerals */
[data-kind="clock"] [data-role="hero"] {
  letter-spacing: -0.03em;
}

/* Accent underline on CPU alerts */
[data-kind="cpu"][data-state="alert"] [data-role="hero"] {
  color: rgb(var(--md-error));
}
```

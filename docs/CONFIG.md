# Configuration files

Opaline stores all user configuration as readable, versioned JSON and CSS files under `$XDG_CONFIG_HOME/opaline/` (default `~/.config/opaline/`). Core watches these files with Linux `inotify` and applies outside edits live.

## Files

| Path | Purpose | Schema |
| - | - | - |
| `~/.config/opaline/settings.json` | Global preferences, active `theme`, global `style`, `kindStyles`, named `styles`, per-widget `widgets` configs and `elements` overrides | `/usr/share/opaline/schemas/settings.schema.json` |
| `~/.config/opaline/layouts.json` | Per-monitor widget and stack positions | `/usr/share/opaline/schemas/layouts.schema.json` |
| `~/.config/opaline/user.css` | Optional user stylesheet injected after the design system (see [THEMING.md](THEMING.md)) | — |
| `~/.config/opaline/themes/` | User theme folders (`<id>/theme.json`) and `.opaline-theme` archives | `/usr/share/opaline/schemas/theme.schema.json` |
| `~/.local/share/opaline/themes/` | Installed third-party themes | `/usr/share/opaline/schemas/theme.schema.json` |
| `/usr/share/opaline/themes/` | First-party themes shipped with Opaline (`opaline`, `classic`, …) | `/usr/share/opaline/schemas/theme.schema.json` |

## Editor validation and autocomplete

Every JSON file written by Opaline includes a `$schema` field pointing at its installed JSON Schema under `/usr/share/opaline/schemas/`:

- `settings.schema.json`
- `layouts.schema.json`
- `style.schema.json`
- `theme.schema.json`
- `composition.schema.json`
- `rice.schema.json`

Editors such as VS Code automatically provide completion, hover documentation, and inline range/enum validation when opening any Opaline file.

## Live reload and safety

- **Atomic writes & self-write suppression:** Core writes files atomically (`<name>.tmp` → `fsync` → `rename`) and records each file's SHA-256 hash in an in-memory ledger. When `inotify` reports Opaline's own write, the matching hash suppresses the reload so no feedback loop occurs.
- **Last-good-state fallback:** If an external edit produces invalid JSON or fails validation (for example, an out-of-range value or overlapping widgets), Opaline keeps the last valid state in memory, never blanks the desktop, and displays a non-blocking toast naming the file, JSON path, and reason.
- **Forward compatibility:** If a file has a higher `version` than the running Opaline build understands, Opaline reads what it recognizes and treats the file as read-only so an older build never clobbers newer settings.
- **1.x automatic migration:** Upgrading from Opaline 1.1 automatically rescales stored `blur` values to the 2.0 `0..100` scale (`60 + 0.4 * old`), sets `theme` to `"classic"` so existing desktops keep their 1.1 appearance, and preserves all widgets, styles, named styles, and layouts.

## Style cascade

Every style key is optional (unset means inherit) and resolves in six layers from lowest to highest priority:

1. **Built-in defaults** (`BUILTIN_STYLE`, Classic 1.1 baseline)
2. **Theme** (`theme.json` `style`, `kinds.<kind>`, `elements.<role|#id>`)
3. **Global user style** (`settings.json` `style`)
4. **Widget kind** (`settings.json` `kindStyles.<kind>`)
5. **Widget instance** (`settings.json` `widgets.<id>.style`)
6. **Element** (`settings.json` `widgets.<id>.elements.<role|#id>`)

Ordered **conditional styles** (`conditions`: `when <expression> → set { ... }`) are evaluated after the cascade against live topic values using the Opaline expression language (`docs/EXPRESSIONS.md`).

## Safe mode

Start Opaline with `opaline --safe-mode` (or choose **Start in safe mode** from the application launcher context menu) to disable `user.css`, `theme.css`, custom sources, and plugins while keeping your files untouched. If Opaline crashes twice in a row on startup, safe mode activates automatically on the next launch.

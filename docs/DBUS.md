# Opaline D-Bus API Reference (v2)

Opaline exposes two session-bus interfaces for scripting, automation, the `opaline ctl` CLI, and GNOME Shell desktop integration. Every argument is validated by core before mutating state or touching files on disk.

---

## 1. Core Application Interface

- **Bus name:** `io.github.ali_kenjo.Opaline`
- **Object path:** `/io/github/ali_kenjo/Opaline`
- **Interface:** `io.github.ali_kenjo.Opaline1`
- **API version:** `2` (strictly backwards-compatible with v1 clients)

### Properties

| Property | Type | Access | Description |
| - | - | - | - |
| `ApiVersion` | `u` | read | Current D-Bus API version (`2`). |
| `BackendMode` | `s` | read | Active placement backend (`"native"` or `"instant"`). |
| `LayerExecutable` | `s` | read | Path to the `opaline` binary launched by the Native helper. |
| `LayerEnvironment` | `a{ss}` | read | Allow-listed environment variables forwarded to the Native layer. |

### Methods

#### v1 Core Controls (unchanged)

| Method | Args | Returns | Description |
| - | - | - | - |
| `Peek` | — | — | Raises all widget layers above normal windows until dismissed. |
| `Edit` | — | — | Toggles Edit mode across all monitors. |
| `OpenSettings` | — | — | Opens or focuses the Settings window. |
| `OpenOnboarding` | — | — | Opens or focuses the Onboarding window. |
| `Quit` | — | — | Cleanly shuts down core and layer processes. |

#### v2 Scripting & Automation Methods

All JSON-returning methods return compact UTF-8 JSON strings and raise standard `org.freedesktop.DBus.Error.InvalidArgs` or `org.freedesktop.DBus.Error.Failed` errors on validation failure.

| Method | Signature | Description |
| - | - | - |
| `GetStatus` | `() → s` | Returns version, backend, active profile, theme, look, pause/safe-mode flags, monitors, and widget count. |
| `GetSetting` | `(s path) → s` | Reads a setting or style key by dot or JSON-Pointer path (e.g. `theme`, `appearance.look`, `style.blur`). |
| `SetSetting` | `(s path, s value_json) → s` | Applies a schema-validated merge patch for `path` to `settings.json`. Emits `ThemeChanged` if `theme` changes. |
| `ListWidgets` | `() → s` | Lists placed widgets (`id`, `kind`, `monitor`, `x`, `y`, `w`, `h`). |
| `AddWidget` | `(s kind, s monitor, i x, i y, i w, i h) → s` | Places a new widget on `monitor` (connector, key, or `""` for primary) and returns its generated `id`. |
| `RemoveWidget` | `(s id) → s` | Removes a placed widget or stack by `id`. |
| `MoveWidget` | `(s id, s monitor, i x, i y, i w, i h) → s` | Moves/resizes an existing widget (keep current monitor when `monitor` is `""`). |
| `ToggleWidget` | `(s id) → s` | Toggles a widget's visibility in the active profile (`hiddenWidgets`). |
| `ListProfiles` | `() → s` | Returns `activeId` and all saved desktop profiles. |
| `SetProfile` | `(s id) → s` | Switches to profile `id` (animates layout/theme/look), emits `ProfileChanged`, and engages manual override. |
| `SaveProfile` | `(s id, s name) → s` | Snapshots current theme, look, appearance, performance mode, and per-monitor layouts as profile `id`. |
| `DeleteProfile` | `(s id) → s` | Deletes a saved profile by `id`. |
| `SetTheme` | `(s id) → s` | Switches the active theme package and emits `ThemeChanged`. |
| `SetLook` | `(s look) → s` | Switches desktop look (`glass`, `clear`, `tinted`, `dark`, `light`, `dimmed`) and sets manual override. |
| `SetVariable` | `(s name, s value_json) → s` | Updates variable topic `var.<name>` and emits `VariableChanged`. |
| `RunWidgetAction` | `(s widget_id, s action) → s` | Dispatches a named widget action and emits `WidgetAction`. |
| `PeekMonitor` | `(s connector) → ()` | Raises only the given monitor's layer (`""` raises all monitors). |
| `ExportBackup` | `() → s` | Exports settings and layouts JSON (GNOME Keyring secrets are never exported). |
| `ImportBackup` | `(s json) → s` | Validates and imports a backup JSON bundle. |
| `AutomationStatus` | `() → s` | Returns rules, per-rule active/hysteresis state, live desktop context, and `manualOverride`. |
| `ResumeAutomation` | `() → s` | Clears manual override so automation rules resume immediately. |

### Signals

| Signal | Arguments | Description |
| - | - | - |
| `ProfileChanged` | `(s profile_id)` | Emitted whenever the active profile changes (manual or rule-driven). |
| `ThemeChanged` | `(s theme_id)` | Emitted whenever the active theme changes. |
| `VariableChanged` | `(s name, s value_json)` | Emitted when a user variable (`var.<name>`) is updated. |
| `WidgetAction` | `(s widget_id, s action)` | Emitted when a scripted or automated widget action runs. |

---

## 2. GNOME Shell Helper Interface (API v2)

- **Bus name:** `io.github.ali_kenjo.Opaline.Shell1`
- **Object path:** `/io/github/ali_kenjo/Opaline/Shell1`
- **Interface:** `io.github.ali_kenjo.Opaline.Shell1`
- **Compatibility:** Core supports `ApiVersion` **N** (`2`) and **N−1** (`1`). Upgrading the helper to v2 requires one GNOME Shell re-login to activate workspace, focused-app, fullscreen, and per-monitor Peek signals.

### Properties

| Property | Type | Version | Description |
| - | - | - | - |
| `ApiVersion` | `u` | v1+ | Interface major version (`2`). |
| `ApiRevision` | `u` | v1+ | Additive revision within the major version (`2`). |
| `DesktopFocused` | `b` | v1+ | True when desktop or layer has focus. |
| `OverviewVisible` | `b` | v1+ | True while GNOME Overview is open. |
| `LayerWindows` | `u` | v1+ | Count of mapped Native layer windows. |
| `ActiveWorkspace` | `i` | v2 | Zero-based active workspace index. |
| `FocusedApp` | `s` | v2 | `WM_CLASS` instance of the focused normal window (or `""`). |
| `Fullscreen` | `b` | v2 | True when any normal window on the active workspace is fullscreen. |

### Methods & Signals (v2 additions)

- `SetRaisedMonitor(s connector, b raised)`: raises/lowers only the matching monitor's layer window.
- `ActiveWorkspaceChanged(i index)`: emitted on workspace switch.
- `FocusedAppChanged(s app)`: emitted when the focused app changes.
- `FullscreenChanged(b fullscreen)`: emitted when fullscreen state toggles.
- `ShortcutActivated(s name)`: now emits `peek`, `edit`, `next-profile`, `cycle-look`, and `peek-primary`.

---

## 3. CLI Examples (`opaline ctl`)

```bash
opaline ctl status --json
opaline ctl get appearance.look
opaline ctl set appearance.glass 25
opaline ctl profile save coding "Coding Desk"
opaline ctl profile use coding
opaline ctl theme instrument
opaline ctl look clear
opaline ctl widgets list --json
opaline ctl widgets add clock --monitor eDP-1 --x 0 --y 0 --w 4 --h 2
opaline ctl var set focusMode true
opaline ctl peek --monitor eDP-1
opaline ctl automation status --json
opaline ctl automation resume
opaline ctl completions bash > ~/.local/share/bash-completion/completions/opaline
```

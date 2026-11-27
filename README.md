# Opaline 2.0

**Glass widgets for your Ubuntu desktop.**

Opaline brings a deeply customizable, glass-and-Material-3 widget layer to Ubuntu 26.04 LTS (GNOME 50): place, stack, resize, style, build, script, and automate live widgets right on your wallpaper — above desktop icons and below application windows, across every workspace and monitor.

## Highlights in 2.0

- **30 built-in widgets** across 7 categories:
  - **System:** Clock (6 expressive faces), CPU, Memory, GPU (respects dGPU runtime sleep), Storage (health & eject), Network, Battery & Power, Fans, Processes, Docker / Podman.
  - **Controls:** Quick Controls (GNOME 50 Wi-Fi, Bluetooth, Airplane, DND, Night Light, Dark style, Keep awake, PipeWire volume, per-monitor brightness, validated launchers).
  - **Time & Personal:** Notes (Markdown + interactive checkboxes), To-do (`todo.txt`), Timers / Stopwatch / Pomodoro (persisted in core), Countdowns, World Clock, Calendar (EDS + ICS).
  - **Media, Photos & Ambient:** Now Playing (MPRIS), Audio Visualizer (10 styles, PipeWire sink monitor — never lights the mic indicator), Photo Frame (core-downscaled thumbnails + EXIF *"On this day"*), Weather (Open-Meteo), Sun & Moon, Quote of the Day, Aura, Decorations.
  - **Developer & Online:** GitHub, Home Assistant, MQTT Topic, Feeds (sanitized RSS/Atom/JSON Feed), n8n Workflows.
- **Glass 2.0 & 10 First-Party Looks:** Single-pass WebGL2 sharp/blurred wallpaper sampling, edge dispersion, inner glow, adaptive 4.5:1 legibility, Desktop look quick modes (*Glass · Clear · Tinted · Dark · Light · Dimmed*), and 10 themes (*Opaline, Crystal, Bloom, Instrument, Air, Terminal, Neon, Paper, Mono, Classic*).
- **Live Inspector, Free Mode & Visual Widget Builder:** Code-split floating Inspector with scope cascade, eyedropper, contrast meter, and unified Edit undo/redo; Grid and work-area-anchored Free mode with z-order & multi-select align; Visual Widget Builder with live `opaline-expr` preview; custom data sources (Command, File, SSRF-pinned HTTP/JSON + JSONPath, D-Bus, MQTT + TLS, Variables) with GNOME Keyring secret storage.
- **Profiles, Automation, `opaline ctl` & D-Bus API v2:** Named desktop profiles, `opaline-expr` automation rules with minimum duration, hysteresis, and manual override + **Resume automation**, GNOME Shell Helper API v2 (`ActiveWorkspaceChanged`, `FocusedAppChanged`, `FullscreenChanged`, N−1 compatible), `opaline ctl` CLI with `--json` and bash/zsh/fish completions ([`docs/DBUS.md`](docs/DBUS.md)).
- **Sandboxed Code Plugins & Community Gallery:** ADR 0014 `opaline-plugin://` Web Worker sandbox with strict CSP, permission approval & SHA-256 re-approval on change, 2 s watchdog, `opaline validate` / `opaline pack`, signed Gallery verifier ([`docs/SDK.md`](docs/SDK.md)).
- **Languages & Accessibility:** English, German (`Deutsch`), and Arabic (`العربية`, RTL chrome/Inspector/Builder while grid coordinates never mirror), package translations, High Contrast, Reduce Motion, and text scaling.

## Installation (Ubuntu 26.04 LTS)

Download the latest `.deb` from [GitHub Releases](https://github.com/ali-kenjo/opaline/releases) and install it:

```bash
sudo apt install ./Opaline_<version>_amd64.deb
```

Launch **Opaline** from the app grid (or run `opaline`). First-run onboarding previews looks & layouts directly over your real wallpaper and enables GNOME desktop integration (widgets work immediately in Instant mode and switch to Native Wayland mode on your next login).

## Privacy & Security

Opaline collects **zero telemetry** and requires **no accounts**. Outbound network requests occur only for opt-in or explicitly triggered features, and secrets live strictly in GNOME Keyring (`org.freedesktop.secrets`):

| Feature | Default | Notes |
| - | - | - |
| Weather (Open-Meteo) | After choosing a city / location | No API key; cached 15–60 min |
| Public IP lookup | **Off** | Opt-in in Settings → Privacy |
| Album art (`https://`) | Only while playing streamed media | Fetched and cached by core |
| Developer integrations (GitHub, HA, n8n, MQTT, Feeds, HTTP sources) | **Off** | Opt-in per source; SSRF-pinned; tokens in GNOME Keyring |
| Community Gallery | Only when **Browse gallery** is clicked | Zero background traffic; SHA-256 + minisign verified |
| Update checks (GitHub Releases) | On (opt-out) | Daily check; `.deb` verified with SHA-256 + minisign |

See [`docs/SECURITY.md`](docs/SECURITY.md) for the complete 2.0 threat model and automated security suite.

## CLI & Scripting (`opaline ctl`)

```bash
opaline ctl status --json
opaline ctl profile save coding "Coding Desk"
opaline ctl profile use coding
opaline ctl look clear
opaline ctl var set focusMode true
opaline validate examples/template-plugin
opaline pack examples/template-plugin
```

Full interface reference: [`docs/DBUS.md`](docs/DBUS.md) · Plugin SDK: [`docs/SDK.md`](docs/SDK.md).

## Building & Testing from Source

Requirements on Ubuntu 26.04 LTS: Rust (stable ≥ 1.90), Node 24 with `pnpm`, and:

```bash
sudo apt install build-essential pkg-config libglib2.0-bin desktop-file-utils appstream \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev \
  libpipewire-0.3-dev clang cmake
```

Build the `.deb`:

```bash
pnpm install
./scripts/stage-deb-assets.sh
cd app && pnpm tauri build --bundles deb
```

Run the full test suite:

```bash
cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings && cargo fmt --all --check
cd app && pnpm lint && pnpm typecheck && pnpm test && pnpm lint:helper && pnpm test:e2e
```

## License

Opaline is licensed under **GPL-3.0-or-later**. See [`LICENSE`](LICENSE) and [`THIRD_PARTY.md`](THIRD_PARTY.md).

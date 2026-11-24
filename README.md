# Opaline

**Glass widgets for your Ubuntu desktop.**

Opaline brings Android-style home-screen widgets to Ubuntu 26.04 LTS (GNOME 50): add, move, resize, stack, and customize live widgets right on your wallpaper — above desktop icons and below application windows, across every workspace and monitor.

## Highlights

- **14 built-in widgets:** Clock, CPU, Memory, GPU (NVIDIA / AMD / Intel, respects dGPU runtime sleep), Storage (with NVMe/ATA health & eject), Network (rates, Wi-Fi, latency, VPN, monthly usage), Battery & Power (with power profile switching & peripheral batteries), Fans, Processes (app-grouped with End task), Now Playing (MPRIS + album-art palette), Audio Visualizer (PipeWire default-sink monitor, never microphone), Weather (Open-Meteo, no API key), Calendar (GNOME EDS + ICS/webcal), and Docker / Podman.
- **Glass + Material 3 Expressive:** Single-pass WebGL2 wallpaper-sampled glass with refraction, specular rim, grain, adaptive 4.5:1 legibility, dynamic wallpaper/GNOME accent palettes, and M3 Expressive spatial/effects springs.
- **Full Android-style Edit mode (`Super+Alt+E` or 450 ms long-press):** Drag with spring reflow, 4 pill resize handles, drag-to-stack with Smart Rotate, drag-to-remove + 5 s Undo snackbar, `Ctrl+Z`/`Ctrl+Shift+Z`, full keyboard control, cross-display moves, live Widget Picker, and 5 starter presets.
- **Peek (`Super+Alt+W`):** Instantly raise all widgets over a blurred backdrop from any workspace.
- **Fully customizable:** Every widget exposes Content + Style settings (colors, glass blur/transparency/refraction/rim, fonts including installed system fonts, density, thresholds, update rates).
- **Languages & Accessibility:** English, German (`Deutsch`), and Arabic (`العربية`, full RTL chrome & widget internals while preserving your widget grid positions), plus GNOME High Contrast, Reduce Animation, and text scaling.

## Installation (Ubuntu 26.04 LTS)

Download the latest `.deb` from [GitHub Releases](https://github.com/ali-kenjo/opaline/releases) and install it:

```bash
sudo apt install ./opaline_<version>_amd64.deb
```

Launch **Opaline** from the app grid (or run `opaline`). On first launch, the guided onboarding lets you pick a starter layout over your real wallpaper and enables GNOME desktop integration (widgets work immediately in Instant mode and automatically switch to Native Wayland mode on your next login).

## Privacy

Opaline collects **zero telemetry**. Outbound HTTPS requests happen only for features you use or opt into:

| Feature | Default | Notes |
| - | - | - |
| Weather (Open-Meteo) | Only after choosing a city or automatic location | No API key; cached 15–60 min |
| Public IP lookup | **Off** | Opt-in in Settings → Privacy; cached 10 min |
| Album art (`https://`) | Only when playing streamed media | Fetched and cached by core; webviews have no network access |
| Update checks (GitHub Releases) | On (opt-out) | Daily check; `.deb` verified with SHA-256 + minisign before `pkexec apt install` |

Debug reports (`opaline --diagnose` and **Settings → Diagnostics → Copy debug report**) strip all topic values (SSIDs, IP addresses, hostnames, usernames, and monitor serials). See [`docs/SECURITY.md`](docs/SECURITY.md) for the full security review.

## Troubleshooting

### Native mode vs. Instant mode
- **Native mode (preferred):** Uses the bundled GNOME Shell desktop-integration helper (`opaline-desktop@ali-kenjo.github.io`) to run the widget layer as a trusted Wayland client behind normal windows and above Ubuntu's desktop icons (DING). GNOME Shell loads newly installed helpers on your next login — until then, Opaline runs seamlessly in Instant mode and switches to Native live once loaded.
- **Instant mode (fallback):** Runs through Xwayland with zero setup. You can toggle Native mode anytime in **Settings → Desktop integration**.

### Blank windows on NVIDIA-primary setups
WebKitGTK 4.1 can occasionally render blank windows when an NVIDIA proprietary GPU is the primary desktop renderer. Opaline automatically selects Mesa on hybrid Intel/NVIDIA laptops; on NVIDIA-only systems, set:

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 opaline
```

### Reporting a bug or hardware issue
Run `opaline --diagnose` (or click **Copy debug report** in **Settings → Diagnostics**) and attach the redacted JSON using the **Hardware / Sensor Report** issue template.

## Building from source

Requirements on Ubuntu 26.04 LTS: Rust (stable), Node 24 with `pnpm` (`corepack enable`), and:

```bash
sudo apt install build-essential pkg-config libglib2.0-bin desktop-file-utils appstream \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev \
  libpipewire-0.3-dev clang cmake
```

Build and package the `.deb`:

```bash
pnpm install
./scripts/stage-deb-assets.sh
cd app && pnpm tauri build --bundles deb
```

Run tests:

```bash
cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings && cargo fmt --all --check
cd app && pnpm lint && pnpm typecheck && pnpm test && pnpm lint:helper && pnpm test:e2e
```

## License

Opaline is licensed under **GPL-3.0-or-later**. See [`LICENSE`](LICENSE) and [`THIRD_PARTY.md`](THIRD_PARTY.md).

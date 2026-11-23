# Opaline 1.0 plan

Status: approved 2026-11-22. The phases come from §10 of the brief. Each phase ends with its
acceptance checks, a note in `docs/PROGRESS.md` and a commit (conventional commits, small and reviewable).
Tasks marked 🧑 need you; the exact steps are given when we get there.

## Decisions to confirm before Phase 0

1. **dGPU acceptance check** (ADR 0003): the brief's "GPU reaches `suspended` within 60 s" can't pass on this
   laptop (RTD3 "Not supported", and the external monitor is driven by the NVIDIA GPU). I propose the three
   replacement checks in the ADR.
2. **Privileged helper scope** (ADR 0004): RAPL only; SSD health comes from UDisks2, which works without root here.
3. **Tauri 2 stable**, not the 3.0 alphas (ADR 0002).
4. **Repository root = this folder** (`widgets-app/`), pushed later as `github.com/ali-kenjo/opaline`. I'll create
   the GitHub repo and push only when you say so.
5. **Git identity**: commits as `ali-kenjo` with your GitHub noreply address and no co-author/"Generated with"
   lines, as in your other projects.
6. **Logs** go to `~/.local/state/opaline/logs/` (XDG state dir), in addition to the three dirs in the brief.

## Phase 0: Foundations

Goal: the skeleton works end to end, and the riskiest platform assumptions are tested before anything is built on them.

| # | Task |
| - | - |
| 0.1 | `git init`, licence (GPL-3.0-or-later), `.gitignore`, `.editorconfig`, `CLAUDE.md`, `README.md` stub, `THIRD_PARTY.md` |
| 0.2 | 🧑 `sudo apt install libpipewire-0.3-dev` (the only missing build dependency). Without sudo: `corepack enable` (pnpm) and the Tauri CLI as a dev dependency |
| 0.3 | Cargo workspace (`crates/opaline-ipc`, `crates/opaline-core`, `crates/opaline-privileged`, `app/src-tauri`), edition 2024, workspace lints (`clippy::unwrap_used`, `expect_used` denied outside tests), `rustfmt.toml` |
| 0.4 | pnpm workspace: Vite + React 19 + TS strict, ESLint (flat config) + Prettier, Vitest, Playwright (WebKit) |
| 0.5 | `opaline-ipc`: frame codec (length + kind + MessagePack/raw), handshake types, protocol version, fuzz/round-trip tests |
| 0.6 | `opaline` binary with argument modes (core, `--layer`, `--diagnose`, forwarding flags); single instance via the session bus name; `tracing` to journald + rotating file |
| 0.7 | Core: no window, tray (Peek · Edit · Pause · Settings · Quit, wired to stubs), IPC server with `SO_PEERCRED` check |
| 0.8 | Layer: one transparent undecorated window per monitor from Mutter `DisplayConfig`, IPC client with retry, shows a test widget that displays a value from core |
| 0.9 | **Spike A, WebGL2 + transparency** in the Tauri webview on both monitors (1.25 and 1.0 scale): a WebGL2 canvas drawing a blurred-wallpaper rounded rect over a transparent window |
| 0.10 | **Spike B, RAM**: PSS of core + layer with two windows; try a related view for a shared web process. Result → ADR |
| 0.11 | **Spike C, Instant mode basics**: `GDK_BACKEND=x11` layer with keep-below, skip-taskbar, sticky; check DING order, Alt-Tab, overview, dock, Show Desktop at 1.25 scale with `xwayland-native-scaling`; plus an input-shape test (clicks reach DING outside the widget) |
| 0.12 | `--diagnose` skeleton (system, displays, backends) with redaction |
| 0.13 | CI workflow in an `ubuntu:26.04` container: fmt, clippy, tests, lint, tsc, Vitest, `.deb` build artifact |
| 0.14 | ADR updates from the spikes; `docs/PROGRESS.md` entry; commit |

**Acceptance:** CI green; core shows its tray; the test layer window connects to core and shows live data; spike
results recorded (any blocker brought to you before P1).

## Phase 1: Sensor engine

| # | Task |
| - | - |
| 1.1 | `Provider` trait, `Probe`/availability model, supervised tasks, `catch_unwind` isolation, backoff, cost accounting |
| 1.2 | Sampler with subscriptions, activity classes, aligned ticks, battery/Eco modifier |
| 1.3 | `scripts/capture-fixtures.sh` (redacted snapshot of the sysfs/procfs files and D-Bus replies we use) → `fixtures/hp-i5-10300h/`; synthetic fixtures: AMD CPU + GPU, Intel Arc, desktop without battery, VM without GPU, sleeping dGPU, NVMe with implausible temperature |
| 1.4 | CPU: `/proc/stat`, cpufreq, coretemp/k10temp/zenpower + thermal-zone fallback with plausibility filter, throttle counters, loadavg/uptime/cpuinfo |
| 1.5 | Memory: meminfo, PSI, swap, zswap |
| 1.6 | GPU: DRM enumeration, display-to-GPU mapping, runtime-PM rule, NVML (runtime-loaded, lazy, released), amdgpu sysfs, i915/xe freq + RC6 approx, fdinfo per-app engine time, RTD3/awake-reason reporting |
| 1.7 | Storage: mountinfo filter (no loop/squashfs/tmpfs/overlay), drive grouping, statvfs, diskstats, hwmon NVMe temp, UDisks2 health (NVMe + ATA), eject/power-off commands |
| 1.8 | Network: rates, physical/virtual classification, NetworkManager (SSID, signal, band, bitrate, VPN, connectivity), ethernet speed, ICMP datagram latency with TCP fallback, data usage persisted with counter-reset handling and billing day, public IP (opt-in) |
| 1.9 | Battery & power: UPower (incl. peripherals), PowerProfiles (UPower name with net.hadess fallback), AC state, power-mode command |
| 1.10 | Audio spectrum: PipeWire default-sink monitor capture following default changes, FFT (2048, Hann, log bands, attack/decay, peak hold), start/stop rules; **check the microphone privacy indicator** and document it |
| 1.11 | Media: MPRIS players, most-recently-active selection, position extrapolation + `Seeked`, controls, album art (file:// direct, https fetched in core with limits + cache) |
| 1.12 | Processes: /proc parsing, systemd-scope + snap-scope app grouping, `.desktop` names/icons, PSS for top N, End task / Force quit with PID-reuse check |
| 1.13 | Docker/Podman: endpoint resolution per ADR 0005, bollard containers/stats/compose grouping, start/stop/restart, Docker Desktop start via systemd user bus |
| 1.14 | Fans (hwmon, unlabeled → "Fan N"), clock/time zones/`clock-format`, calendar via EDS (**ADR** on access path: EDS D-Bus directly vs `libecal` vs Shell CalendarServer) plus ICS/webcal, weather (Open-Meteo forecast/AQ/geocoding, Location portal, cache/refresh rules) |
| 1.15 | Wallpaper & appearance: GSettings background (all picture-options, colors, shading, slideshow XML), per-monitor render + quarter-res blur + backdrop blur, cache, custom protocol; accent, color-scheme (portal), animations, high contrast, text scaling, ScreenSaver lock |
| 1.16 | Privileged helper: `GetCpuEnergy()`, D-Bus activation files, polkit policy, idle exit, rate limit |
| 1.17 | History rings + SQLite rollups; alerts engine (hysteresis, duration, cooldown, notifications with actions, snooze) |
| 1.18 | Full `--diagnose`; a `opaline --dump <topic>` dev command to compare against reference tools |

**Acceptance:** values match `top`, `free`, `nvidia-smi`, `sensors`, `df`, `ip -s link`, `upower -d`, `docker ps`
on this laptop (script output recorded in PROGRESS.md); parser tests pass on all fixtures; the ADR 0003 dGPU
checks pass. 🧑 You start Docker Desktop once (or allow me to) for the Docker comparison.

## Phase 2: Design system and Widget Lab

| # | Task |
| - | - |
| 2.1 | `docs/DESIGN.md`: tokens, spacing, radii, elevation, states, the glass layers, motion tokens, type scale |
| 2.2 | Color pipeline: material-color-utilities scheme from wallpaper/accent/custom, variants, contrast level, M3 roles → CSS custom properties with animated transitions, HCT ramps (thermal, load, health) |
| 2.3 | Shapes: TypeScript port of androidx `graphics-shapes` (RoundedPolygon, CornerRounding, Morph) + `MaterialShapes`; attribution in THIRD_PARTY.md; unit tests against reference outputs |
| 2.4 | Motion: verify the M3 Expressive spring values in androidx source; in-house spring solver (interruptible, retargeting), one rAF scheduler; odometer numbers; reduced-motion path |
| 2.5 | Glass compositor (WebGL2): SDF rects/polygons, wallpaper sampling aligned to screen position, tint, refraction, specular rim, shadows, grain, dirty-only rendering; CSS fallback; opaque mode; adaptive legibility |
| 2.6 | Typography & icons: Roboto Flex, Inter, Noto Sans Arabic, Material Symbols Rounded bundled locally (licences in THIRD_PARTY.md), variable-axis animation |
| 2.7 | Base components: card, pill, ring, sparkline, heat strip, wavy progress, M3 Expressive loading indicator, context menu, sheet, snackbar, toolbar, buttons, switches, sliders |
| 2.8 | Widget Lab route (dev builds only) with widget × size × theme × state matrix over selectable wallpapers; Playwright WebKit screenshot baselines |

**Acceptance:** WebGL2 works in the Tauri webview here; Lab screenshots baselined; 🧑 your visual sign-off.

## Phase 3: Widgets

One commit per widget (or small group), each with all sizes, detail view, settings sheet, alerts, loading /
unavailable / asleep states, Full + Dimmed, light + dark, hover, focus ring, context menu, Lab entries.

Order (shared pieces first): Clock → CPU → Memory → GPU → Storage → Network → Battery & Power → Processes →
Fans → Now Playing → Visualizer → Weather → Calendar → Docker.

**Acceptance:** 🧑 your visual sign-off per widget; every unavailable/asleep state can be demonstrated in the Lab
and, where the hardware allows, live.

## Phase 4: Layer and desktop integration

| # | Task |
| - | - |
| 4.1 | `DesktopBackend` trait, live backend switching, status reporting |
| 4.2 | Instant backend (from spike C): placement per monitor, keep-below, skip-taskbar, sticky, Show Desktop recovery, work areas via `_GTK_WORKAREAS_D<n>`, Peek via always-on-top, GlobalShortcuts portal; tested at 1.0/1.25/1.5/2.0 |
| 4.3 | Shell helper: `metadata.json`, GSettings schema, `layer.js`, `stacking.js` (ADR 0006), `dbus.js` (`Shell1`), `keys.js`, clean `disable()`, ESLint |
| 4.4 | Devkit workflow (`gnome-shell --devkit`) documented in CLAUDE.md; helper tests in the nested session |
| 4.5 | Native backend in core: helper detection, `ApiVersion` N/N−1, enable via `org.gnome.Shell.Extensions`, `enabled-extensions` fallback |
| 4.6 | Input regions (both modes), Peek (both modes), appearance states (Automatic/Full/Dimmed) with focus/hover/covered signals |
| 4.7 | Monitor hot-plug, scale and resolution changes, layer-covered → sampling class |
| 4.8 | Measure RAM in Native mode against the 280 MB budget (ADR 0009) |

**Acceptance (both modes):** above desktop icons, below apps, on all workspaces, hidden from Alt-Tab/overview/dock,
survives Show Desktop, clicks outside widgets reach desktop icons; switching to Native after a re-login works
without restarting Opaline. 🧑 You install the helper (`sudo` copy or a dev `.deb`), log out and back in when I ask.

## Phase 5: Edit mode and layout engine

| # | Task |
| - | - |
| 5.1 | Grid engine: per-monitor grid from work area − 24 px margins, 84 px cells / 12 px gaps, spans, collision resolution with minimal movement, refit on resolution/scale change (property tests) |
| 5.2 | Per-monitor layouts keyed per §3.6 of ARCHITECTURE; waiting widgets for missing monitors, optional show-on-primary |
| 5.3 | Edit mode: long-press (450 ms) and other entry points, raised layer + backdrop + dot grid + toolbar, Pointer Events |
| 5.4 | Move (lift, ghost, springs, snap), resize (pill handles, span snapping, live reflow), remove (target + badge + 5 s undo snackbar) |
| 5.5 | Stacks (create by drop, flip by scroll/swipe, dots, stack editor, Smart Rotate) |
| 5.6 | Undo/redo, full keyboard model, cross-display moves (context menu + 600 ms edge hold), all displays in edit mode together |
| 5.7 | Widget picker bottom sheet with search, categories, live previews at each size, drag-to-place / click-to-place, hardware reasons |
| 5.8 | Presets: Essentials, Performance, Creator, Developer, Minimal |
| 5.9 | Detail views (shared-element morph up to 8×6) and the glass context menu |
| 5.10 | Layer windows sized to the widgets' bounds outside edit mode (about −29 MB in Instant mode, ADR 0009); full work area while editing |

**Acceptance:** everything in §2.2–2.4 of the brief works with mouse, touchpad and keyboard.

## Phase 6: Product shell

| # | Task |
| - | - |
| 6.1 | Onboarding (welcome animation, starter layout over the real wallpaper, desktop integration, privacy, optional CPU power, finish flight) |
| 6.2 | Settings window, all sections of §2.9 |
| 6.3 | Tray + desktop-file actions + app-grid launch → Edit; shortcuts via portal (Instant) and helper (Native) |
| 6.4 | Notifications with actions, autostart toggle, privacy controls, export/import JSON |
| 6.5 | Updates: daily check, in-app card, download, SHA-256 + minisign verification, `pkexec apt install` |

**Acceptance:** 🧑 the full first-run flow works on a fresh user account (you create a test user, or I give you
the exact `adduser` steps).

## Phase 7: Quality

| # | Task |
| - | - |
| 7.1 | German and Arabic translations (🧑 you review the strings); RTL pass on chrome and widget internals |
| 7.2 | Accessibility: keyboard, screen-reader labels (Orca check), high contrast, reduced motion, text scaling, non-colour status |
| 7.3 | Budgets: `scripts/measure-budget.sh` for every line of §7; fix until met; numbers in PROGRESS.md |
| 7.4 | Security review: capabilities, CSP, IPC peer checks, command validation, privileged helper (allow-list, polkit, rate limit), network requests |
| 7.5 | Fault isolation tests: a deliberately panicking/hanging provider can't take core down or stall the sampler |

**Acceptance:** no crashing provider can take core down; all budgets recorded in `docs/PROGRESS.md`.

## Phase 8: Release

| # | Task |
| - | - |
| 8.1 | `.deb` contents, maintainer scripts (helper enable/disable, clean uninstall), AppStream validation |
| 8.2 | Clean Ubuntu 26.04 VM: install, upgrade (0.9 → 1.0), uninstall, in Native and Instant modes (🧑 VM setup, I give the steps) |
| 8.3 | minisign key (🧑 you keep the secret key), signed checksums, release workflow on tags |
| 8.4 | README with screenshots/GIFs, privacy statement, troubleshooting (NVIDIA blank windows, Native vs Instant), hardware-report issue template |
| 8.5 | 🧑 v1.0.0 tag and GitHub release, with your go-ahead |

**Acceptance:** you can install the release `.deb` on a clean system and everything works.

## Risks, in order of concern

1. **RAM budget with two monitors** (two WebKit web processes). Spike B in P0 settles it.
2. **Instant mode under Xwayland with fractional scaling** (`xwayland-native-scaling` is on). Spike C in P0.
3. **Stacking next to DING without `make_below`** (ADR 0006). Proven in P4, with a devkit session first.
4. **Glass compositor cost** at 0.5 % CPU idle. It renders only when dirty, so idle should be free; measured in P2/P7.
5. **dGPU check** can't be done as written on this laptop (ADR 0003).

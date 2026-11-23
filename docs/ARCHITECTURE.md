# Opaline architecture

Status: approved 2026-11-22; updated with the Phase 0 findings. It follows the brief (`OPALINE_BUILD_PROMPT.md`) and the facts in
`docs/SENSORS.md`. Where the brief and this machine disagree, the decision is recorded in `docs/adr/`.

## 1. Overview

```
                    ┌──────────────────────── GNOME Shell 50 (Mutter, Wayland) ───────────────────────┐
                    │  opaline-desktop@ali-kenjo.github.io  (GJS helper, tiny)                        │
                    │    • watches core's bus name • spawns layer as trusted Wayland client          │
                    │    • places/sticks/lowers layer windows • exports …Opaline.Shell1 on D-Bus      │
                    └──────────────┬───────────────────────────────────────────────┬──────────────────┘
                                   │ D-Bus (session)                                │ Meta.WaylandClient
                                   ▼                                                ▼
 ┌────────────────────────── opaline (core) ──────────────────────┐   ┌──────── opaline --layer ────────┐
 │ Tauri 2, no window by default, single instance                 │   │ Tauri 2, one transparent webview│
 │  sensor engine ─ sampler ─ history ─ alerts                    │   │ window per monitor              │
 │  settings/layout store (single source of truth)                │◄─►│  IPC client (Rust)              │
 │  IPC server (Unix socket, MessagePack)                         │   │  → Tauri Channels → React       │
 │  DesktopBackend: Native (helper) | Instant (spawn Xwayland)    │   │  glass compositor (WebGL2)      │
 │  tray · notifications · portals · D-Bus service · updates      │   │  input region per window        │
 │  Settings / Onboarding windows on demand                       │   └─────────────────────────────────┘
 └───────────┬────────────────────────────────────────────────────┘
             │ D-Bus (system), only if the user enabled it
             ▼
 ┌──────── opaline-privileged ───────┐
 │ D-Bus activated, polkit, read-only│
 │ RAPL energy counters; exits idle  │
 └───────────────────────────────────┘
```

One Rust binary, `opaline`, has three modes chosen by its arguments:

| Invocation | Role |
| - | - |
| `opaline` | core (default). If core is already running, it asks the running core to enter Edit mode and exits. |
| `opaline --layer [--backend native\|instant]` | renderer for all monitors |
| `opaline --diagnose` | prints the redacted sensor inventory as JSON and exits (no Tauri, no GTK) |
| `opaline --peek`, `--edit`, `--settings`, `--quit` | forwarded to the running core over D-Bus (used by desktop-file actions) |

`opaline-privileged` is a separate small binary (no Tauri, no GTK), because it runs as root.

Why one binary for core and layer: one package, one version, no skew between them, and the layer can link only
what it needs at runtime (it never starts the sensor engine). Why separate processes anyway: in Native mode the
**helper must spawn the layer** to make it a trusted Wayland client, while core has to run in both modes and
own the tray, so they can't be the same process (ADR 0001).

## 2. Repository layout

The repository root is this folder (`widgets-app/`, to be pushed as `github.com/ali-kenjo/opaline`).

```
CLAUDE.md  README.md  LICENSE  THIRD_PARTY.md  Cargo.toml (workspace)  package.json  pnpm-workspace.yaml
docs/        ARCHITECTURE.md  SENSORS.md  PLAN.md  PROGRESS.md  DESIGN.md  adr/
crates/
  opaline-ipc/          protocol types, framing, topic names; no tokio dependency in the types module
  opaline-core/         library: providers, sampler, history, alerts, store, backends, wallpaper, diagnose
  opaline-privileged/   binary: system-bus service
app/
  src-tauri/            binary `opaline`: Tauri glue for core and layer modes, tray, windows, protocols
  src/
    design-system/      tokens, color pipeline, glass compositor, shapes + morph, springs, type, icons
    widgets/            one folder per widget (defineWidget modules)
    layer/              layer app: grid, edit mode, peek, picker, detail views, stacks
    settings/  onboarding/  lab/  i18n/
desktop-integration/    GNOME Shell helper (ESM): extension.js, layer.js, stacking.js, dbus.js, keys.js
packaging/              deb assets, polkit policy, dbus service + conf, autostart, metainfo, icons
fixtures/<machine>/     redacted sysfs/procfs snapshots + D-Bus replies for parser tests
scripts/                fixture capture, budget measurement, release signing
.github/workflows/
```

## 3. Core process

### 3.1 Runtime

- One tokio multi-thread runtime with **2 worker threads** plus a small blocking pool (max 4) for sysfs/procfs
  reads, SQLite and image work. GTK/Tauri runs on the main thread as Tauri requires.
- Single instance: core owns `io.github.ali_kenjo.Opaline` on the session bus. A second start that finds the name
  taken calls a method on the running instance (Edit, Peek, Settings, Quit) and exits.
- Session D-Bus interface `io.github.ali_kenjo.Opaline1`: `Peek()`, `Edit()`, `OpenSettings()`, `Quit()`,
  `PauseUpdates(b)`, property `BackendMode`. The helper only *watches* this name; it calls nothing heavy.

### 3.2 Providers

```rust
trait Provider: Send + 'static {
    fn id(&self) -> ProviderId;                       // "cpu", "gpu", "storage", …
    fn probe(&mut self) -> Probe;                     // what exists here, with reasons for what doesn't
    fn topics(&self) -> &[TopicDesc];                 // e.g. cpu.load, cpu.temp, cpu.perThread
    fn sample(&mut self, cx: &SampleCx) -> Result<Vec<TopicUpdate>, ProviderError>;
    fn cost_hint(&self) -> Cost;                      // cheap | moderate | expensive (decides batching)
}
```

- `Probe` produces per-topic availability: `Available`, `Unavailable(reason)`, `Asleep`, `NeedsPermission(fix)`.
  The UI shows these reasons verbatim (translated), never placeholder numbers.
- **Fault isolation.** Each provider runs on its own task. `sample()` runs inside `catch_unwind` on the
  blocking pool; a panic or error marks the provider `Failed { since, error }`, reports it in Diagnostics, and
  retries with exponential backoff (5 s → 5 min). Nothing a provider does can take core down. Async providers
  (D-Bus, PipeWire, Docker) run in a supervised task that is restarted on panic.
- **Cheap reads.** Hot sysfs/procfs files are opened once and re-read with `pread(0)` into a reused buffer; no
  allocation per sample in the steady state. Parsers are pure functions over `&[u8]`, which is what the fixture
  tests exercise.
- Event-driven where the source supports it (UPower, NetworkManager, MPRIS, UDisks2, GSettings, Mutter, PowerProfiles
  signals): those providers don't poll at all.

Provider list and sources: see `docs/SENSORS.md` and §6 of the brief. Notable machine-driven rules:

- **GPU runtime-PM rule.** For every discrete GPU, `power/runtime_status` is read first on every tick. If it is
  `suspended`, the GPU topic is `Asleep` and NVML/amdgpu files are not touched. NVML is initialised lazily only
  while a GPU topic has subscribers and the GPU is active, and shut down (`nvmlShutdown`) after 10 s without
  subscribers, so Opaline is never the reason a GPU stays awake (ADR 0003).
- RAPL package power only through the privileged helper, only when the user enabled it, otherwise hidden.
- NVMe/SATA health from UDisks2 (unprivileged, confirmed here); live NVMe temperature from hwmon.

### 3.3 Sampler and adaptive rates

The sampler keeps, per topic, the set of subscribers and each subscriber's **activity class**:

| Class | Interval |
| - | - |
| `Interactive` (desktop focused, Peek, Edit, detail open) | 1 s (spectrum 60 Hz) |
| `Ambient` (dimmed) | 2 s |
| `Covered` (layer covered) | 5 s, history only, nothing pushed to the layer |
| `Idle` (locked/idle) | alert-critical topics only, 10 s |
| modifier: on battery + Eco | ×2 |

A topic's interval is the fastest needed by any subscriber or by an alert rule. With no subscriber and no alert rule,
the topic is not sampled. Ticks are aligned to a shared 1 s clock so providers wake together (fewer CPU wake-ups,
which matters more for the 0.5 % budget than the reads themselves).

### 3.4 History

- In memory: per numeric series a ring buffer of `f32` at 1 s × 900 (15 min) and 10 s × 8640 (24 h).
  ≈ 40 KB per series; about 60 series in a default layout → < 3 MB.
- SQLite (`rusqlite`, `bundled`, WAL) at `~/.local/share/opaline/history.sqlite`: 1-minute rollups (min/avg/max)
  for 30 days and the network data-usage counters. Written in one transaction per minute from the blocking pool.
- History is only kept for series that are subscribed or have an alert rule, plus network usage (always, it is
  cheap and the 30-day chart needs it).

### 3.5 Alerts

Rule = `{ topic, comparator, threshold, clear_threshold (hysteresis), for_duration, cooldown, enabled }`.
Each rule is a small state machine `Normal → Pending(since) → Firing → Cooldown`. Firing sends a desktop
notification through `org.freedesktop.Notifications` directly via zbus (we need action buttons "Open" and
"Snooze 1 h", which the Tauri notification plugin doesn't offer on Linux) and sets the widget's alert state.

### 3.6 Store (settings and layouts)

- `~/.config/opaline/settings.json` and `layouts.json`, each `{ "version": N, … }` with typed migrations
  (`vN → vN+1`, tested against stored samples).
- Atomic writes: write `*.tmp`, `fsync`, `rename`, `fsync` the directory. Writes are debounced (500 ms).
- Core is the only writer. The layer and the Settings window get a full snapshot on connect, then patches
  (JSON-Patch-like ops over IPC/Tauri events). Layout edits come back as commands and are validated
  (grid bounds, allowed spans, no overlap) before they're applied. Undo/redo lives in the layer per edit
  session and sends the resulting layout as one command per step.
- Monitor key: `<vendor>-<product>-<serial>:<connector>` (e.g. `AUO-0x82ed-0x00000000:eDP-1`). Matching on
  reconnect: exact key → same vendor/product/non-zero serial on another connector → same connector and
  vendor/product → no match (layout waits). On this machine both serials are zero, so the connector carries
  the identity.

### 3.7 IPC (core ⇄ layer)

- Socket: `$XDG_RUNTIME_DIR/opaline/ipc.sock`; directory `0700`, socket `0600`. Core checks the peer with
  `SO_PEERCRED` (same UID) and rejects anything else.
- Framing: `u32` little-endian length + 1 byte frame kind + payload. Kind `0x01` = MessagePack (`rmp-serde`)
  message; kind `0x02` = raw spectrum frame (`u16` topic id, `u32` seq, `[u8; bands]` levels). Max frame 1 MiB.
- Handshake: `Hello { protocol: u16, role: Layer, pid, monitors_seen }` → `Welcome { protocol, settings, layouts,
  availability }`. Protocol mismatch = clear error in Diagnostics, never a crash.
- Messages: `Subscribe { topic, class }`, `Unsubscribe`, `SetActivity { monitor, class }`, `Update { topic, seq,
  value }` (coalesced: at most one frame per tick with all changed topics), `Command { id, cmd }` →
  `CommandResult { id, Ok | Err(reason) }`, `StorePatch`, `BackendEvent` (raised, covered, focus, monitors).
- The layer tolerates starting before core: it retries the connect with backoff (100 ms → 2 s) and shows nothing
  until the handshake completes (widgets appear with their loading state < 1.5 s after core is up).
- Commands that touch the system (End task, Docker actions, media controls, eject, power mode) are validated in
  core: End task only for PIDs owned by the user's UID, re-checked against `/proc/<pid>/stat` start time to avoid
  PID reuse; Docker/UDisks2 actions only for IDs/object paths from the current listing; media commands only to
  bus names currently listed as MPRIS players.

### 3.8 Wallpaper pipeline

- Watches `org.gnome.desktop.background` (GSettings, via `gio`) and `color-scheme`.
- Per monitor, renders the wallpaper exactly as GNOME places it (`zoom`, `scaled`, `stretched`, `centered`,
  `wallpaper`, `spanned`, `none` with primary/secondary color and `solid`/`horizontal`/`vertical` shading) at the
  monitor's logical size, then a **quarter-resolution** blurred variant (`libblur` Gaussian) and a separate heavier
  blur for the Edit/Peek backdrop. GNOME's XML slideshow wallpapers are handled by following the current slide.
- Cache: `~/.cache/opaline/wallpaper/<content-hash>-<w>x<h>-<variant>.webp`. Served to webviews through the
  custom protocol `opaline-asset://wallpaper/<monitor-key>/<variant>?v=<hash>`.
- Source color: `material-color-utilities` is a TypeScript library, so its QuantizerCelebi + Score run in the
  webview on a 128×128 thumbnail that core provides, once per wallpaper change. Core caches the result.
- Image decoding: `image` crate (PNG/JPEG/WebP) plus `jxl-oxide` for JPEG XL.

### 3.9 Desktop backends

```rust
trait DesktopBackend {
    fn kind(&self) -> BackendKind;                 // Native | Instant
    async fn start(&mut self, layer: LayerSpec) -> Result<()>;
    async fn stop(&mut self) -> Result<()>;
    async fn set_raised(&self, raised: bool) -> Result<()>;   // Peek / Edit
    fn events(&self) -> BackendEvents;             // monitors, work areas, focus, covered, overview, shortcut
}
```

- **Selection**: on start and whenever the helper's bus name `io.github.ali_kenjo.Opaline.Shell1` appears or
  vanishes, core reads `ApiVersion`. Compatible (N or N−1) → Native; otherwise Instant. Switching is live: the old
  backend stops its layer, the new one starts its layer, and the layer reconnects (state survives in core).
- **Native**: the helper owns the layer's lifetime (spawned only while core's bus name is owned). Core never
  spawns the layer in this mode; it asks the helper via its D-Bus API.
- **Instant**: core spawns `opaline --layer --backend instant` with `GDK_BACKEND=x11`. Window options:
  `decorations(false)`, `transparent(true)`, `skip_taskbar(true)`, `always_on_bottom(true)`,
  `visible_on_all_workspaces(true)`. Monitors and scale come from Mutter `DisplayConfig`. Each window covers its
  monitor's **work area** (Mutter publishes `_GTK_WORKAREAS_D<n>`, which Tauri's `Monitor::work_area()` returns by
  connector name). Windows are created hidden, get `USPosition` geometry hints, and are then moved and shown, because
  Mutter otherwise maps them on the pointer's monitor; a `configure-event` guard keeps them in place (ADR 0008).
  Keep-below puts the window in Mutter's BOTTOM layer, above DING (DESKTOP layer) and below apps (ADR 0006). Covered detection isn't available in Instant mode (GNOME restricts `Shell.Introspect`), so it uses
  the Ambient rate there; screen lock still drops to Idle. Shortcuts via the GlobalShortcuts portal (v1 present).
- **Input region (both)**: the layer computes the union of widget rects per window (after layout springs settle,
  plus the lifted widget while dragging) and sets it with `gdk_window_input_shape_combine_region` on the window's
  GTK handle. In Edit/Peek the whole window takes input. Empty region = clicks pass straight to DING.

### 3.10 Settings and Onboarding windows

Normal decorated Tauri windows owned by core, created on demand and destroyed on close (so they cost nothing when
closed). They use the same design system as the layer. Tray (`tauri` tray via libayatana-appindicator, confirmed
present) offers Peek · Edit widgets · Pause updates · Settings · Quit. Because vanilla GNOME has no tray, the same
actions are in the `.desktop` file actions (dock right-click) and in the Edit toolbar. Launching Opaline from the
app grid while it runs enters Edit mode.

## 4. GNOME Shell helper

Tiny, ESM, GJS. No timers, no polling, no rendering. Files:

| File | Job |
| - | - |
| `extension.js` | `enable()`/`disable()`; watches `io.github.ali_kenjo.Opaline` with `Gio.bus_watch_name`; owns the pieces below |
| `layer.js` | spawns `opaline --layer --backend native` with `Meta.WaylandClient.new_subprocess(global.context, launcher, argv)`; on `window-created` checks `owns_window()`; for each owned window: `hide_from_window_list()`, `stick()`, places it on the monitor named in its title (`opaline-layer:<connector>`) with `move_resize_frame` to the monitor's geometry; re-applies on `monitors-changed` and `workareas-changed`; `unminimize()` if minimized (Show Desktop) |
| `stacking.js` | keeps layer windows below normal windows but above DING (see below) |
| `dbus.js` | exports `io.github.ali_kenjo.Opaline.Shell1`: `ApiVersion`, `GetMonitors()`, `GetWorkAreas()`, `SetRaised(b)`, signals `MonitorsChanged`, `WorkAreasChanged`, `DesktopFocusChanged(b)`, `OverviewChanged(b)`, `LayerCovered(s, b)`, `ShortcutActivated(s)` |
| `keys.js` | registers Peek/Edit with `Main.wm.addKeybinding` from the helper's GSettings schema; emits `ShortcutActivated` |

**Stacking without `make_below`.** Meta-18 has no `make_below` (checked in the typelib). DING puts its own window in
Mutter's DESKTOP layer, so in the NORMAL layer `lower()` puts our window at the bottom of the app windows but still
above DING. On `restacked`, the helper calls `lower()` on a layer window only when a normal window sits below it
(with a re-entrancy guard). `SetRaised(true)` (Peek/Edit) uses `make_above()` and `activate()`; `SetRaised(false)`
reverses it. To be proven in a devkit session and on the real session in P4 (ADR 0006).

**Covered / focus.** `LayerCovered(connector, b)` is computed from `global.display` window state changes
(maximized/fullscreen on that monitor and the active workspace), event-driven only. `DesktopFocusChanged` follows
`notify::focus-window` (focus on DING, on our windows, or none = desktop).

**Lifecycle.** `disable()` disconnects every signal, unexports the D-Bus object, removes keybindings and kills the
layer subprocess; core sees the name vanish and switches to Instant mode.

**Versioning.** `ApiVersion` is an integer. Core supports N and N−1. `metadata.json` declares `shell-version:
["50"]` (add `"51"` after testing). Install path `/usr/share/gnome-shell/extensions/opaline-desktop@ali-kenjo.github.io/`.
First run calls `org.gnome.Shell.Extensions.EnableExtension` (confirmed available); if the running shell doesn't
know the UUID yet (installed after login), core adds it to `org.gnome.shell enabled-extensions` and says Native
starts after the next login.

## 5. Layer renderer

### 5.1 Windows

One process, one undecorated transparent webview window per monitor, titled `opaline-layer:<connector>`, sized to
the monitor (Native) or its work area (Instant). Monitors are added/removed live. Every window after the first is a
WebKit *related view* of the first, so all of them share one web process (ADR 0009; one process per window would add
roughly another 80 MB with two monitors).

### 5.2 Frontend

- React 19 + TypeScript strict + Vite, Zustand store per window, CSS Modules + CSS custom properties, no UI kit.
- Data path: Rust IPC client → `tauri::ipc::Channel` per window → a small decoder → Zustand slices per topic.
  Widgets subscribe with selectors, so a CPU update re-renders only CPU widgets.
- **One rAF scheduler** (`design-system/motion/scheduler.ts`): the in-house spring solver drives layout position,
  size and shape for both DOM (via `transform`/CSS variables, outside React) and the glass compositor, in the same
  tick. Idle = no rAF callbacks at all. Nothing renders while the backend reports the layer covered.
- Widgets are `defineWidget({ id, name, category, sizes, subscriptions, settingsSchema, render, detail, alerts,
  availability })` modules. `render` gets `{ size, data, appearance, settings }` and returns the layout for the
  size class. Subscriptions are declared, so the layer subscribes/unsubscribes topics as widgets mount, become
  visible or get covered.
- Charts: custom Canvas2D sparklines/heat strips in widgets, uPlot in detail views.

### 5.3 Glass compositor

One WebGL2 canvas behind the DOM per window. Each frame it draws every glass surface in one pass:
SDF rounded rects and SDF polygons (for expressive shapes, from the shapes port), sampling the quarter-res blurred
wallpaper texture at the surface's on-screen position, then tint (surface-container role × glass slider), edge
refraction (displacement near the border), specular rim (top-left, pointer-reactive while hovered), outer + inner
shadow, 2–3 % grain. It redraws only when dirty (layout, theme, wallpaper, pointer-over-hovered-widget, active
springs). Adaptive legibility: core provides per-region mean luminance of the blurred wallpaper; the tint alpha
for each widget is raised until primary text reaches 4.5:1. Fallback without WebGL2: CSS (fixed-position blurred
wallpaper background + tint layer). High contrast / reduce transparency: opaque surfaces.

### 5.4 Appearance, motion, i18n

- Color: `@material/material-color-utilities` builds the scheme (source: wallpaper / GNOME accent / custom;
  variant; contrast). M3 roles → CSS custom properties; palette changes are animated with effects springs.
  Thermal/load/health ramps are generated in HCT from the scheme.
- Springs: tokens from the M3 Expressive motion scheme (values verified against androidx source in P2),
  damping = 2ζ√k (m = 1). `enable-animations = false` → crossfades ≤ 150 ms, no morphs.
- i18n: FormatJS, ICU messages in `app/src/i18n/{en,de,ar}.json`; locale-aware numbers/dates/units with overrides
  (°C/°F, bits/bytes). In Arabic, UI chrome and widget internals use `dir="rtl"`; the user's widget positions are
  logical grid coordinates and are never mirrored.

## 6. Privileged helper

Rust, zbus, system bus name `io.github.ali_kenjo.Opaline.Privileged`, interface `…Privileged1`, D-Bus activated
(`packaging/dbus/…service` + bus policy `.conf`), exits after 60 s idle. One method in 1.0: `GetCpuEnergy()` →
`a(stt)` (domain name, `energy_uj`, `max_energy_range_uj`) read from a fixed allow-list of
`/sys/class/powercap/intel-rapl*` paths. Polkit action `io.github.ali_kenjo.opaline.read-sensors`
(`allow_active=yes`, others `no`). Rate limit: 4 calls/s per sender. `GetNvmeSmart` is dropped because UDisks2
gives SMART unprivileged (ADR 0004); it comes back only if a machine shows it's needed.

## 7. Security and privacy

- Tauri capabilities: the layer windows get only the commands they use (layout commands, subscribe, widget commands);
  Settings/Onboarding windows get settings commands. No shell/fs/http plugins exposed to any webview.
- CSP: `default-src 'self'; img-src 'self' opaline-asset: data: blob:; style-src 'self' 'unsafe-inline';
  font-src 'self'; connect-src ipc: http://ipc.localhost; script-src 'self'` (inline styles are needed for spring-driven
  CSS variables; verify the exact IPC origin for Tauri 2 on Linux in P0).
- Webviews never load remote content. Core fetches album art (https, ≤ 5 MB, image types only, cached) and weather.
- Network use: Open-Meteo (weather, geocoding, air quality), public IP (opt-in), GitHub Releases (update check,
  opt-out), album-art URLs from MPRIS. HTTP client: `reqwest` with `rustls`. No telemetry.
- Debug reports redact SSIDs, IP/MAC addresses, hostnames, usernames, serial numbers and home paths.

## 8. Performance plan (budgets §7)

| Budget | How we meet it | How we measure |
| - | - | - |
| ≤ 0.5 % CPU idle | aligned 1 s ticks, `pread` reuse, event-driven providers, coalesced IPC frames, no rAF when idle, widgets redraw on data change only, sparklines scroll only while visible | `scripts/measure-budget.sh`: `/proc/<pid>/stat` utime+stime over 60 s for core + layer + WebKit processes |
| ≤ 280 MB RAM (core + layer; the brief says 220, raised by you on 2026-11-23, ADR 0009) | core has no webview unless Settings is open; layer windows share one web process if possible; history in `f32` rings | PSS from `smaps_rollup` for all Opaline processes |
| ≤ 0.1 % covered/locked | no pushes to the layer, rAF stopped, Idle class | same script with a maximized window |
| ≤ 3 % visualizer @ 60 fps | FFT in Rust, `u8` bands as raw binary frames, one canvas draw per frame | same script during playback |
| no dropped frames | layout springs outside React, compositor single pass, `will-change` only while animating | WebKit frame timing in the Lab + manual check |
| widgets ≤ 1.5 s after core start | layer starts in parallel with providers; widgets render loading state immediately; first sample of cheap providers before handshake | timestamped log events |

**Biggest risk: RAM.** Measured in Phase 0 (release, two monitors, shared web process, test widget): core 27 MB,
layer 94 MB, WebKit network process 16 MB, web process 121 MB, **259 MB total** (the brief's 220 MB budget is now 280 MB, ADR 0009) after loading only
Mesa's EGL, and **0.13 % idle CPU**. The remaining levers and their measured effect are in ADR 0009: windows sized to
the widgets (about −29 MB), JavaScriptCore without JIT (−10 MB, costs CPU), or a higher budget. Caches and the cache
model made no difference. Also keep the bundle small and measure the web process per widget in the Lab.

## 9. Packaging and updates

- `.deb` via the Tauri bundler, plus `packaging/` extras: helper (with compiled GSettings schema),
  `opaline-privileged` + D-Bus service/conf + polkit policy, AppStream metainfo, hicolor SVG icon, desktop file with
  actions. Depends: `libwebkit2gtk-4.1-0`, `libgtk-3-0`, `libayatana-appindicator3-1`, `libpipewire-0.3-0`.
- NVIDIA blank-window workaround: if the GPU that renders the webview is NVIDIA (detected from the GL renderer
  string / `__GLX_VENDOR_LIBRARY_NAME` / PRIME offload env), set `WEBKIT_DISABLE_DMABUF_RENDERER=1` before GTK
  starts. On this machine apps render on the Intel iGPU (`renderD128`) even for the NVIDIA-driven HDMI monitor.
- Autostart: `~/.config/autostart/io.github.ali_kenjo.Opaline.desktop` with `X-GNOME-Autostart-enabled`.
- Updates: daily GitHub Releases check; download `.deb` + `SHA256SUMS` + minisign signature; verify both; install with
  `pkexec apt install ./opaline_<v>_amd64.deb`.
- CI: GitHub Actions in an `ubuntu:26.04` container: rustfmt, clippy `-D warnings`, cargo test (fixtures), ESLint,
  Prettier, tsc, Vitest, Playwright WebKit screenshots of the Lab, helper ESLint, `.deb` build, artifacts.

## 10. Diagnostics and logging

- `tracing` with `tracing-journald` and a rotating file in `~/.local/state/opaline/logs/` (XDG state dir; the
  brief lists only config/data/cache, and state is the right XDG place for logs).
- `opaline --diagnose`: probes every provider without starting Tauri and prints redacted JSON.
- Settings → Diagnostics: Opaline's own CPU/RAM history, backend mode, helper `ApiVersion`, per-provider status
  and cost, recent logs, "Copy debug report".

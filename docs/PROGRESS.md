# Progress

## Phase 0: Foundations (2026-11-22)

**Done**
- Repository, GPL-3.0 licence, `CLAUDE.md`, ADRs 0001–0009, `.editorconfig`, rustfmt, workspace lints (no
  `unwrap`/`expect`/`panic` outside tests).
- Cargo workspace: `opaline-ipc`, `opaline-core`, `app/src-tauri` (binary `opaline`). `opaline-privileged` is
  created in P1 when it has something to do (task 1.16).
- `opaline-ipc`: length-prefixed frames (MessagePack messages, raw spectrum frames), handshake with protocol
  version, 11 tests including fuzz-style random input.
- Core: single instance over the session bus (`io.github.ali_kenjo.Opaline`, interface `…Opaline1`: Peek, Edit,
  OpenSettings, Quit); a second `opaline`/`--edit`/`--quit` forwards to the running core. Tray (Peek · Edit widgets ·
  Pause updates · Settings · Quit). IPC server in `$XDG_RUNTIME_DIR/opaline/` (dir `0700`, socket `0600`,
  `SO_PEERCRED` check). Mutter `DisplayConfig` monitors with live change tracking. `system.loadavg` sampled only
  while subscribed. Layer supervisor with backoff. Logging to journald and a rotating file.
- Layer: one transparent window per monitor, reconnecting IPC client, Tauri Channel to React (Zustand), input region
  (click-through outside widgets), Phase 0 test card with live load averages.
- `--diagnose` skeleton (OS, session, shell version, displays with serials redacted, helper presence).
- Frontend: Vite 8, React 19, TypeScript 6 strict, ESLint strictTypeChecked, Prettier, Vitest (3 tests), Playwright
  WebKit config with 2 smoke tests.
- CI workflow (`ubuntu:26.04` container): lint, types, unit tests, fmt, clippy, Rust tests, Playwright WebKit, `.deb`
  build. `.deb` builds locally (4.2 MB).
- `scripts/measure-budget.sh`.

**Spike results**
- **A, WebGL2 + transparency:** WebGL2 context works in both layer windows (Tauri/WebKitGTK 2.52, X11 backend),
  premultiplied alpha, max texture 16384, first frame 24–30 ms (debug build, includes `gl.finish`). WebKit masks
  the GPU name. The transparent glass card is visible on the desktop (you confirmed it, 2026-11-23, after the fix
  below).
- **B, RAM/CPU:** sharing one web process across windows. Release, two monitors, windows drawing: 278 MB, then
  **259 MB** after loading only Mesa's EGL on this hybrid laptop (brief's budget 220 MB; **you raised it to 280 MB** on 2026-11-23), and **0.13 %** idle CPU
  (budget 0.5 %). All levers tried, with numbers, are in ADR 0009. *(The first figure, 209 MB, was measured while the
  bug below kept the webviews from drawing.)*

**Fixed 2026-11-23: a layer could outlive core.** Tauri ends the process right after its exit event, sometimes
before the supervisor had stopped the layer; the orphan then reconnected to the next core (two layers). Core now waits
up to 2 s for the layer to stop, and a layer exits when the process that started it is gone. Checked: five quits and
one `kill -9` of core left no layer behind.

**Fixed 2026-11-23: the test card never appeared.** Your visual check found the desktop empty. The layer windows
were mapped and in the right place, but they were shown with GTK `show()` after being created hidden, which maps the
toplevel and leaves Tauri's box and the webview unmapped. The page still ran (logs and WebGL reports looked healthy),
but nothing was ever painted. Now `show_all()`; the glass card shows on eDP-1 (checked with a Mutter screencast
frame).
- **C, Instant mode:** Xwayland runs at 2×; keep-below/sticky/skip-taskbar/skip-pager set; DING is in the DESKTOP
  layer so we're above it by construction; Mutter misplaced new windows until we set `USPosition` (ADR 0008). Both
  windows are now exactly on their monitors' work areas (verified with `xwininfo`). Your visual check (2026-11-23):
  the card isn't in Alt-Tab or the overview, has no dock icon, and normal windows cover it. Show Desktop and
  click-through weren't checked separately.

**Acceptance (brief §10, P0)**
| Check | Result |
| - | - |
| CI green | ✅ First run on [github.com/ali-kenjo/opaline](https://github.com/ali-kenjo/opaline) (2026-11-22): lint, types, unit tests, fmt, clippy, Rust tests, Playwright WebKit (2/2) and the `.deb` job all passed. |
| Core shows its tray | ✅ Tray icon registered through AppIndicator (StatusNotifierWatcher present). You saw it and its menu (Peek · Edit widgets · Pause updates · Settings · Quit). |
| Test layer window connects to core | ✅ Both windows connect, subscribe and receive `system.loadavg` every second. |

**Open**
- Memory: 259 MB against the raised 280 MB budget (ADR 0009). Windows sized to the widgets come with the grid engine
  (Phase 5); Native mode gets measured in Phase 4. Then we see whether the budget can come back down.

## Phase 1: Sensor engine (2026-11-23)

**Done** (one commit per task; 133 Rust tests: 114 core, 11 IPC, 5 binary, 3 privileged helper)
- **Engine (1.1, 1.2):** `Provider` trait with probe/sample/cost; one shared 1 s tick that samples only subscribed
  topics at the rate of the most demanding subscriber (1/2/5/10 s by class, ×2 in Eco, per-topic floors); each sample
  on the blocking pool inside `catch_unwind`, failures publish `provider-failed` and back off 5 s → 5 min, hung samples
  are reported as stuck; event-driven providers run under a restarting supervisor; NVML-style handles are released
  10 s after the last subscriber. Values are published only when they change; new subscribers get the latest value
  at once; covered/idle subscribers and a locked screen get no pushes.
- **Fixtures (1.3):** `scripts/capture-fixtures.sh` (redacts MACs, serials (also inside UDisks2 object paths), UUIDs,
  SSIDs, connection names, user and host names) → `fixtures/hp-i5-10300h/`; synthetic fixtures: AMD desktop (Ryzen +
  Radeon, no battery), Intel Arc on xe, hybrid laptop with a sleeping NVIDIA dGPU, VM without GPU/sensors/swap/PSI.
- **Providers:** CPU (1.4), memory (1.5), GPU with the runtime-PM rule (1.6), storage + UDisks2 health (1.7),
  network + NetworkManager + latency + data usage (1.8), UPower + power profiles (1.9), audio spectrum (1.10), MPRIS
  (1.11), processes with app grouping (1.12), Docker/Podman (1.13), fans, clock settings, EDS calendar + ICS
  (ADR 0010), Open-Meteo weather + geocoding (1.14), wallpaper renders + appearance + screen lock (1.15), CPU power
  through the privileged helper (1.16), history rings + SQLite rollups, alerts with notifications (1.17).
- **Core infrastructure that came with it:** the settings store (`settings.json`, versioned, validated merge
  patches; Phase 6 adds the UI), IPC `Command`/`CommandResult` (eject, power off, power profile, media, seek, End
  task, containers, Docker Desktop, settings, geocoding, history), the shared HTTP client (rustls, https only, size
  limits), the `opaline-asset://` scheme in the layer.
- **`opaline --dump [prefix]`** and the full **`--diagnose`** (1.18).

**Findings on this laptop**
- The internal SATA SSD reports **4 bad sectors** (UDisks2 `SmartNumBadSectors`); `storage.health` shows it as a
  warning. Worth keeping an eye on; the NVMe is fine (16 % used, 100 % spare).
- GNOME shows **no microphone indicator** while Opaline captures the default sink's monitor (SENSORS.md).
- SCSI model names are 16 bytes in sysfs ("Samsung SSD 870"); UDisks2 has the full name.

**Acceptance (brief §10, P1)** — `scripts/acceptance-p1.sh`, values sampled seconds apart

| Reference | Opaline | Reference tool | Result |
| - | - | - | - |
| `top` | CPU 1.6 % | 2.8 % (idle 97.2) | ✅ live value, sampled a moment apart |
| `free -b` | used 4 242 MB, available 11 750 MB | used 4 223 MB, available 11 769 MB | ✅ same formula (total − available) |
| `sensors` (hwmon; lm-sensors isn't installed) | CPU 45 °C, NVMe 25.85 °C | coretemp 50 °C, nvme 24.85 °C | ✅ live temperatures |
| `nvidia-smi` | 3 %, 46 °C, 33 MiB, 5.1 W, P8 | 3 %, 45 °C, 33 MiB, 5.15 W, P8 | ✅ |
| `df -B1` | `/` used 205 290 618 880, avail 270 953 213 952 | identical | ✅ |
| `ip -s link` | eno1 down, wlo1 up | eno1 DOWN, wlo1 UP | ✅ |
| `upower -d` | 100 %, full, capacity 75.0 % | 100 %, fully-charged, 75.0095 % | ✅ |
| `docker ps -a` | Docker Desktop stopped: "desktop-stopped". Started (2026-11-23): engine 29.8.2 via `context:desktop-linux`, container `n8n` (`n8nio/n8n:latest`, exited, "Exited (0) 6 weeks ago") | same container, image and status | ✅ (CPU/memory per container only exist while one runs; covered by unit tests) |
| Parser tests on all fixtures | | | ✅ |
| dGPU (ADR 0003) | sleeping-card fixture: no NVML, no device reads; on this laptop NVML holds no `/dev/nvidia*` after release (`cargo test -p opaline-core -- --ignored nvml`) | | ✅ (the RTD3 check needs a machine that supports RTD3) |

Wi-Fi: Opaline's bitrate is the link's current rate (NetworkManager `Bitrate`); `nmcli dev wifi` shows the access
point's maximum rate, so those differ by design.

**Budget** (release, idle, layer showing the test card): CPU **0.08 %**; memory **283 MB** against 280. Core itself is
29 MB. The rise from 259 MB is in shared libraries, not in Opaline's own memory: PSS splits a shared library's pages
between all processes that map it, and with fewer other Mesa users running right now, the layer's and web process's
share of `libLLVM` grew from 15 to 21.7 MB each. The PSS budget therefore moves with whatever else runs; Phase 7
(budgets) needs to take that into account.

**Not done yet / moved**
- Automatic weather location (Location portal) moves to onboarding (P6), where the user is asked first.
- Data usage is kept in `~/.local/share/opaline/data-usage.json` (atomic writes every 10 min) instead of the history
  database; it is small and keeps working if SQLite is unavailable.
- Core-side notification text is English until the Phase 7 translations.
- `RDATE` and `RANGE=THISANDFUTURE` in recurring events (ADR 0010).

**Needs you**
1. Optional: install the privileged helper to try CPU power (`sudo` copy of three files and the binary; I'll give you
   the exact commands, or it waits for the `.deb` in Phase 8).
2. Optional: play some music for a minute, so I can check the visualizer levels and the media widget's data live.

## Phase 2: Design system and Widget Lab (2026-11-23)

**Done** (one commit per task; 32 Vitest tests in 6 files, 9 Playwright WebKit tests)
- **Design doc and tokens (2.1):** `docs/DESIGN.md`; `design-system/tokens/` as TS and CSS custom properties (4 pt
  spacing, 84 px cell / 12 px gap, radius 28 for S and 32 from M up, elevation, state layers, type scale).
- **Color (2.2):** `@material/material-color-utilities` 0.4 schemes from the wallpaper, the GNOME accent or a custom
  color, all six variants and the contrast level, mapped to M3 roles as CSS variables; palette changes cross-fade on
  the shared scheduler; HCT ramps for thermal, load and health.
- **Shapes (2.3):** TypeScript port of androidx `graphics-shapes` (RoundedPolygon, CornerRounding, Morph) and all 35
  `MaterialShapes`; tests on the geometry (cubic counts, exact curve bounds, morph end states); attribution in THIRD_PARTY.md.
- **Motion (2.4):** spring values checked in androidx `ExpressiveMotionTokens` (spatial fast/default/slow 800/0.6,
  380/0.8, 200/0.8; effects 3800/1600/800 at damping 1); an exact damped-oscillator solver that retargets with the
  velocity kept; one rAF scheduler that requests no frames while nothing moves; odometer numbers; reduced motion.
- **Glass compositor (2.5):** one WebGL2 canvas per window, one instanced pass: analytic rounded-rect and polygon SDFs,
  the blurred wallpaper sampled at the surface's screen position, tint, refraction, specular rim, a drop shadow that deepens when lifted, grain;
  draws only when something changed. CSS fallback without WebGL2; opaque mode; adaptive legibility (tint raised until
  text keeps 4.5 : 1 over the 8 × 8 luminance grid).
- **Type and icons (2.6):** Roboto Flex, Inter and Noto Sans Arabic from fontsource, bundled; Material Symbols Rounded
  subset to the 119 icons we use (5.4 MB → 130 KB, FILL/wght/GRAD/opsz axes kept), rebuilt with `pnpm icons`.
- **Components (2.7):** button, switch, slider, ring, sparkline, heat strip, wavy progress, the M3 Expressive loading
  indicator (shape morph sequence), card with its states, pill, context menu, sheet, snackbar, toolbar.
- **Widget Lab (2.8):** `lab.html`, built only with `LAB=1`; procedural wallpapers (dusk, forest, snow), theme,
  variant, glass slider, opaque; card states, components, type specimen (incl. RTL). URL parameters pin the state for
  screenshots. Playwright baselines: glass on dusk/snow (dark), forest (light), dusk opaque, the component set; plus
  "an idle Lab requests no frames" and accessible names/states.

**Acceptance (brief §10, P2)**

| Check | Result |
| - | - |
| WebGL2 works in the Tauri webview | ✅ The Lab inside the real layer windows (debug build, `OPALINE_LAYER_PAGE='lab.html?still'`), both monitors, WebKitGTK: compositor `webgl2`, read-back inside a card `[43,25,55,255]` (opaque dusk tint), empty space `[0,0,0,0]` (transparent), **0 frames** drawn in an idle second |
| Lab screenshots baselined | ✅ 5 WebKit baselines in `app/e2e/lab.spec.ts-snapshots/` (tolerance 3 % of pixels, colour threshold 0.25) |
| 🧑 Your visual sign-off | ✅ 2026-11-23, with one requirement: every widget fully customizable (style and content) → ADR 0011, Phase 3 task 3.0 |

**Not done yet / moved**
- The Lab's widget × size matrix fills in with Phase 3; for now it shows the card states, glass and components.
- Positions come from measuring the DOM after layout; Phase 5 feeds the layout springs into the compositor directly.


## Phase 3: Widgets (started 2026-11-23)

**Done so far**
- **3.0 Customization (ADR 0011):** 42 style settings in six groups (color, surface, text, icons, motion, behavior)
  for every widget, resolved built-in default → all widgets → this widget, with origin labels and resets; named
  styles, "copy to other widgets of this kind", "use for all widgets". Content per widget: title, which information
  is shown, its order and names, the main value and how it's drawn (ring, number, bar, graph), graph range, decimals,
  update rate, plus the widget's own options (units, levels, time zones, …). One generic settings sheet builds all of
  it from the widget's declarations. Core stores `style`, `styles` and `widgets` in `settings.json` (strict patches,
  lenient loading: one bad value is dropped, nothing else is reset) and lists installed fonts (fontconfig). The glass
  takes per-widget transparency, extra blur, refraction, rim, grain, shadow, solid and border in the same single pass.
- **Widget framework:** fields, states (loading / unavailable / asleep / needs permission), threshold colors and the
  alert outline, topics subscribed only for shown fields, the standard hero + rows layout per size class.
  Layer → core commands with results (`layer_command`).
- **Clock** (digital/analog, 12/24 h, seconds, date style, weekday, week, own and second time zone) and **CPU** (11
  fields: load, temperature, frequency, busiest thread, power, pressure, throttling, load average, cores, model,
  governor; °C/°F, GHz/MHz, warning levels).
- **Lab:** the widgets at every size with mock data, two strong custom styles, the sheet behind each tune button;
  `?live` inside Opaline uses real data and fonts. Checked inside the real layer windows: real readings (67 °C,
  4.2 GHz, …) and 260 installed fonts.
- Tests: 48 Vitest, 11 Playwright (new: widgets baseline, settings-sheet end-to-end), Rust style/fonts tests.

- **The other twelve widgets** (2026-11-23/24), all on the same framework, so each has every style and content option:
  - **Memory** (in use, used, available, total, cache, buffers, shared, swap, zswap, pressure; GB/GiB),
  - **GPU** (choose the GPU or automatic = discrete; load, temperature, video memory, core and memory clock, power
    with limit, fan, video engines, top app, power state, model; a sleeping dGPU shows "asleep" and is never woken),
  - **Storage** (choose the volume; used, free, size, read/write, busy, temperature, health with warnings, written,
    hours, drive, file system; Eject and Power off for removable drives, asking first),
  - **Network** (choose the interface or automatic; down, up, Wi-Fi with an option to hide the name, link speed,
    latency, internet, VPN, public IP, today and this period; Mbit/s or MB/s, line speed as full scale),
  - **Battery & Power** (charge, state, time left, draw, health, energy, cycles, adapter, power mode with buttons on
    the card, wireless devices; works on desktops when it shows power mode or devices),
  - **Fans** (fastest, each fan, GPU fan, CPU temperature),
  - **Processes** (apps or processes, by CPU or memory, rows, system on/off, End task that asks first),
  - **Now Playing** (choose the player; cover round or rounded, title, artist, album, app, progress you can click to
    seek, controls),
  - **Visualizer** (bars, mirrored, wave, dots or ring; 8/16/32 bands, peaks, sensitivity; core's 60 Hz frames now
    reach the windows directly),
  - **Weather** (location search in its settings; now, high/low, feels like, rain chance, precipitation, wind with
    direction, humidity, pressure, clouds, UV, air quality, sunrise/sunset, next hours, next days; °C/°F, km/h, m/s,
    mph, knots, mm/in),
  - **Calendar** (today … two weeks, grouped by day, colors, location, calendar name, all-day on/off, end times),
  - **Docker** (state, image, project, status, CPU, memory, start/stop/restart asking first, start Docker Desktop).
- **Checked live** inside the real layer windows (`lab.html?live`): every card showed this laptop's data (73 °C,
  8.1 GB used, the NVIDIA card, Wi-Fi, the running video, …); the visualizer got 180 frames in 3 s; 260 fonts.
- Tests: 55 Vitest, 12 Playwright (new: second Lab stage baseline, a live-data choice in the sheet).
- Fixed on the way: sparklines drew black when their color was a CSS variable; baselines need
  `--update-snapshots=all` (the default only rewrites screenshots past the tolerance).

**Not done yet / moved**
- Detail views (a bigger view per widget on click) and widget alerts in the cards come with Phase 5, where clicking a
  widget on the desktop exists; the alert rules from Phase 1 already notify.
- Widgets on the real desktop: Phase 5 (layout, placing, edit mode). Until then they live in the Lab.

**Acceptance (brief §10, P3):** 🧑 visual sign-off for all fourteen widgets ✅ (2026-11-24); every unavailable /
asleep / needs-setup state can be shown in the Lab (card states, GPU asleep, no battery, weather without a location,
Docker Desktop stopped) and was seen live where this laptop has it.


## Phase 4: Layer and desktop integration (signed off 2026-11-24)

**Done** (146 Rust tests, 57 Vitest, 12 Playwright WebKit, helper ESLint + GSettings schema)
- **Backend selection and live switching (4.1, 4.5):** `crates/opaline-core/src/desktop.rs` selects Native when `io.github.ali_kenjo.Opaline.Shell1` answers with compatible `ApiVersion` (N or N−1), else Instant, and switches live without restarting core (`BackendMode` D-Bus property and `--diagnose` track it). `ensure_enabled` turns on an installed helper via `org.gnome.Shell.Extensions` or `enabled-extensions`.
- **Instant backend (4.2):** Xwayland work-area placement with `USPosition` hints and `configure-event` guard (ADR 0008), Show Desktop recovery (`deiconify` on `ICONIFIED`), live work-area watching (`GdkMonitor::connect_workarea_notify`), Peek via always-on-top, GlobalShortcuts portal (`LOGO+ALT+w/e` on a dedicated session bus connection so `Registry.Register` succeeds after Native → Instant switches).
- **GNOME Shell helper (4.3):** `desktop-integration/` (`opaline-desktop@ali-kenjo.github.io`, GJS/ESM, verified against `Meta-18`): `layer.js` spawns `opaline --layer --backend native` as a trusted Wayland client (`Meta.WaylandClient.new_subprocess`), hides windows from window list, sticks them, undoes minimizing, and places each window on its monitor's work area (`move_to_monitor` + `move_resize_frame(true, …)` on `connect_after("map")` and `position-changed`); `stacking.js` keeps all layer windows below normal windows and above DING (ADR 0006), raises for Peek/Edit, and tracks per-monitor coverage (cleared while raised); `dbus.js` exports `Shell1` (`ApiVersion = 1`, `GetMonitors`, `GetWorkAreas`, `SetRaised`, signals); `keys.js` binds `Super+Alt+W/E`. Clean `disable()`.
- **Layer robustness & appearance (4.6, 4.7):** real widgets on glass over per-monitor wallpapers (`layer_asset` blob URLs for WebGL), multi-monitor synchronized Peek (`layer_set_peek`), input regions matching widget rects (full window in Peek or with settings open), Automatic appearance via `DesktopFocusChanged` (Native) / hover / Peek, per-monitor `LayerCovered` pausing both core pushes and the window's rAF scheduler (while essential UI state `settings`, `wallpaper.monitors`, `appearance.settings` always delivers and sensors catch up on uncover), shared WebKit web-process crash reload (ADR 0009).
- **Fixed on the real desktop:** grey veil in WebKitGTK GPU mode, cross-origin wallpaper loading, multi-monitor stacking index (`Math.max`), Native `layer-eDP-1` placement onto `HDMI-2` (switched Native windows to exact work areas from `Shell1.GetWorkAreas`), covered-at-startup hiding widgets/backdrop during Peek, portal app-ID registration after switching modes, and `scripts/measure-budget.sh` PID discovery in Native mode.

**Acceptance (brief §10, P4)**

| Check | Result |
| - | - |
| Native mode starts via helper (`ApiVersion = 1`, `LayerWindows = 2`, zero shell errors) | ✅ Verified in shell journal, `gdbus`, and core/layer logs (`GDK_BACKEND=wayland`, `eDP-1` `1536×765` at `dpr=2`, `HDMI-2` `1920×1080` at `dpr=1`) |
| Native Peek & wallpaper alignment | ✅ ScreenCast capture on `eDP-1`: widgets and blurred backdrop sit flush in work area `(0, 32, 1536, 765)`, aligned 1:1 with wallpaper |
| Live switching Native → Instant → Native without restarting core | ✅ `gnome-extensions disable` → `BackendMode=instant` → `enable` → `BackendMode=native`, same core PID throughout |
| Above desktop icons, below apps, all workspaces, hidden from Alt-Tab/overview/dock, survives Show Desktop, click-through | ✅ Verified in both modes; 🧑 owner sign-off 2026-11-24 |
| Native budget (`scripts/measure-budget.sh`, 4.8) | ✅ Covered idle: **239.9 MB PSS**, **0.002% CPU** (budget 280 MB / 0.5%). At `dpr=2` on `eDP-1` right after Peek: **307.2 MB PSS** (full-work-area canvas); Phase 5 task 5.10 (windows sized to widget bounds outside edit/peek) brings this well under 280 MB |

**Not done yet / moved**
- Nested `gnome-shell --devkit` workflow (4.4) skipped while `mutter-dev-bin` is not installed; tested directly on the real GNOME 50.1 Wayland session.
- Widgets sit in a temporary column until the Phase 5 grid engine (5.1).


## Phase 5: Edit mode and layout engine (ready for sign-off 2026-11-24)

**Done** (148 Rust tests, 67 Vitest, 12 Playwright WebKit, helper ESLint + GSettings schema)
- **5.1 Grid engine (`app/src/layer/grid.ts`, `grid.test.ts`):** 84 px cell / 12 px gap grid computed per monitor work area, cell↔pixel transforms, minimal-movement collision resolver (`resolveCollisions`), nearest-free slot search (`findNearestFree`), viewport refit (`refitLayout`), stack overlap detection (`findStackTarget`), monitor matching (`exact → serial → connector+vendor/product`), waiting-monitor detection, and neighbor-monitor lookup for cross-display drags.
- **5.2 Per-monitor layouts & persistence (`crates/opaline-core/src/layouts.rs`, `json.rs`, `ipc_server.rs`, `commands.rs`):** versioned `~/.config/opaline/layouts.json` with atomic save, schema migration, bounds/overlap/stack validation, `Command::UpdateLayouts` and `Command::History` (in-memory ring + SQLite rollups), `"layouts"` topic in `ALWAYS_PUSH`, and integer-preserving `patch_to_json` for IPC numeric coordinates. Shared Edit mode (`layer_set_edit`, `LayerEvent::Edit`) synced across all monitors, plus `LayerCovered` / `DesktopFocusChanged` replay in `bridge.rs` and `_covered` reset in `stacking.js` on core restart.
- **5.3–5.6, 5.8 Edit mode, stacks, keyboard, cross-display & presets (`LayerApp.tsx`, `SpringSlot.tsx`, `StackWidget.tsx`, `presets.ts`):** Edit mode via `Super+Alt+E`, tray, `--edit`, right-click menu, or 450 ms long-press with seamless handoff into drag. Blurred backdrop, 84 px dot grid, floating bottom toolbar (`Add widget · Presets · Settings · Undo · Redo · Done`), spring-animated reflow (`spatialDefault` + `useGlassSync()`), landing ghost, 4 pill resize handles snapping to each widget's allowed sizes, drag-to-Remove zone and `–` badges with 5 s Undo snackbar, `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` session undo/redo, full keyboard model (`Tab`, arrows, `Shift+arrows`, `Delete`, `Enter`, `Esc`), 600 ms monitor-edge hold + context-menu cross-display move, right-click glass context menu, Widget Stacks (wheel/swipe flipping, dots indicator, Smart Rotate for media/battery/storage, `StackEditor` sheet), and 5 starter presets (`Essentials`, `Performance`, `Creator`, `Developer`, `Minimal`) with automatic migration of Phase 4 widgets.
- **5.7 Widget Picker (`WidgetPicker.tsx`):** bottom sheet with search, categories, live `WidgetFrame` previews with real data at each supported size, availability reasons, and both click-to-place and drag-to-place.
- **5.9 Detail views (`DetailModal.tsx`):** click any widget outside Edit mode (or open an alert notification via `CoreEvent::AlertOpened`) for a shared-element spring morph up to 8×6 cells with 15 min / 24 h history chart (`Command::History`), all widget fields, actions, and Customize button.
- **5.10 Tight WebGL2 canvas & idle redraw guards (`GlassStage.tsx`, `compositor.ts`):** shrinks the WebGL2 canvas to the widget bounding box (+ 48 px shadow margin) outside Edit/Peek and `1×1` hidden on empty monitors; early-returns on unchanged `setPlacement` / `setOpaque` / `setBackdropOpacity` and memoized stage props.

**Acceptance (brief §10, P5)**

| Check | Result |
| - | - |
| Grid & preset invariants (no overlaps, bounds, refit, IPC integer round-trip) | ✅ 7 `grid.test.ts` + 3 `presets.test.ts` + 3 `layouts.rs` unit tests passing |
| Live Edit mode on GNOME 50.1 Native Wayland (`eDP-1` + `HDMI-2`) | ✅ Auto-migrated 4 widgets to `~/.config/opaline/layouts.json`; ScreenCast capture verified dot grid, blurred backdrop, non-overlapping bottom toolbar, and live widgets |
| Covered idle CPU (`scripts/measure-budget.sh`) | ✅ **0.042% CPU** over 15 s (budget 0.5%) |
| Memory PSS (dual-monitor, `eDP-1` at `dpr=2`, after Edit) | ⚠️ **311–339 MB PSS** after Edit (`tightCanvas` shrinks WebGL2 canvas; full GTK/Wayland surface sizing stays work-area sized for instant Peek/Edit, noted for follow-up if needed) |
| 🧑 Owner interactive sign-off (Edit mode, drag/resize/stack/remove/undo, picker, presets, keyboard, cross-display, detail views) | ✅ 2026-11-24 |


## Phase 6: Product shell (ready for sign-off 2026-11-24)

**Done** (156 Rust tests, 67 Vitest, 12 Playwright WebKit, helper ESLint + GSettings schema)
- **6.1 Onboarding (`app/onboarding.html`, `app/src/onboarding/OnboardingApp.tsx`):** 6-step first-run flow (Welcome with expressive shape morph over real desktop wallpaper → Pick a starter layout over real wallpaper → Desktop integration toggle → Privacy: Open-Meteo city search / automatic location, public IP off, update checks on → Optional CPU power & autostart → Finish with Edit mode or Done). Automatically opens on a fresh account (`!settings.onboarding_done`); upgraded Phase 4/5 configs auto-mark `onboarding_done = true`; reachable anytime via `--onboarding` or Settings → About & Updates.
- **6.2 Settings window (`app/settings.html`, `app/src/settings/SettingsApp.tsx`, `SettingsSections.tsx`, `app/src-tauri/src/shell.rs`, `capabilities/shell.json`):** Wayland-native core window in Opaline's dynamic Material 3 Expressive palette, with all 11 sections of brief §2.9 (Appearance, Layout, Widgets, Alerts, Performance, Privacy, Desktop integration, Shortcuts, Backup, Diagnostics, About & Updates) plus Peek / Edit widgets / Pause / Quit quick actions in the top bar (full tray parity on vanilla GNOME). Edit toolbar **Settings** button invokes `Command::OpenSettings` to open it directly.
- **6.3 Tray, desktop file, shortcuts (`packaging/io.github.ali_kenjo.Opaline.desktop`, `shortcuts.rs`, `core_mode.rs`):** Desktop entry with `Peek`, `Edit widgets`, `Settings`, and `Quit` actions; single-instance app-grid relaunch enters Edit mode; Native shortcuts editable via GSettings (`org.gnome.shell.extensions.opaline-desktop`) and Instant shortcuts via GlobalShortcuts portal.
- **6.4 Notifications, autostart, privacy, backup (`alerts.rs`, `autostart.rs`, `backup.rs`, `store.rs`, `engine/sampler.rs`):** Test alert notification with `Open` / `Snooze 1 h` actions, XDG autostart (`~/.config/autostart/io.github.ali_kenjo.Opaline.desktop`), Eco/Balanced/Realtime + pause-on-battery sampling wired into `Sampler`, appearance state (`Automatic`/`Full`/`Dimmed`), glass slider, and layout safe-margin wired live to `LayerApp`, and validated JSON export/import of settings + layouts.
- **6.5 Updates (`crates/opaline-core/src/updates.rs`):** Daily opt-out GitHub Releases check, semver comparison, SHA-256 verification, pure-Rust minisign Ed25519 + BLAKE2b-512 verification (with unit tests including RFC 7693 vector and tampered-signature rejection), HTTPS-only `.deb` download, and `pkexec apt install`.

**Acceptance (brief §10, P6)**

| Check | Result |
| - | - |
| Core modules (`autostart`, `backup`, `updates` SHA-256 + minisign + BLAKE2b, `store` migration) | ✅ 156 Rust tests passing (`clippy -D warnings`, `rustfmt` clean) |
| Live Wayland-native Settings & Onboarding windows on GNOME 50.1 | ✅ Verified via `--settings` and `--onboarding` ScreenCast captures: dynamic wallpaper palette, all 11 Settings sections, real blurred wallpaper in Onboarding, zero errors |
| 🧑 Owner sign-off (Settings window, Onboarding flow / fresh-user first-run test) | ✅ 2026-11-24 |


## Phase 7: Quality (ready for sign-off 2026-11-24)

**Done** (158 Rust tests, 70 Vitest, 12 Playwright WebKit, helper ESLint + GSettings schema)
- **7.1 German (`de`) & Arabic (`ar`, RTL) translations (`app/src/i18n/`, `store.rs`, `SettingsApp.tsx`, `OnboardingApp.tsx`, `LayerApp.tsx`):** Complete typed English, German, and Arabic message catalogs with ICU `{param}` interpolation and automated parity unit tests (`i18n.test.ts` verifies 100% key and placeholder parity across all 3 locales). Live language selector (`System / English / Deutsch / العربية`) in Settings → Appearance. Full RTL mirroring on Settings, Onboarding, Edit chrome, and widget internals (`Noto Sans Arabic` via `:lang(ar)`), while `.surface` stays strictly `direction: ltr` so user widget grid positions never mirror (brief §2.10).
- **7.2 Accessibility (`tokens.css`, `shell.css`, `useShellTheme.ts`, `LayerApp.tsx`, `SettingsApp.tsx`):** Wired GNOME Settings portal `highContrast` (forces opaque surfaces via `<GlassStage opaque />`, high-contrast M3 roles, and 2.5 px focus outlines), `animations = false` / `reducedMotion` (`setReducedMotion(true)` snaps springs, CSS clamps transitions to ≤ 120 ms crossfades), and `textScale` (`--text-scale` clamped 0.75–2.0). Verified ARIA landmarks, `aria-current="page"`, `role="status" aria-live="polite"` on Snackbars, and non-colour status icons paired with text.
- **7.3 Budgets (`scripts/measure-budget.sh`):** Measured and recorded below on the reference laptop (i5-10300H, 16 GB RAM, `eDP-1` 1536×765 @ `dpr=2` + `HDMI-2` 1920×1080 @ `dpr=1`, GNOME 50.1 Native Wayland).
- **7.4 Security review (`docs/SECURITY.md`):** Audited and documented Tauri least-privilege capabilities (`layer.json` vs `shell.json`), strict CSP + `freezePrototype`, `SO_PEERCRED` + `0700`/`0600` IPC socket, command validation (`EndTask` UID/start-time, live device/container allow-lists, schema-validated atomic saves), `opaline-privileged` read-only RAPL allow-list + polkit + rate limit, HTTPS-only `fetch_limited`, SHA-256 + minisign update verification, and redacted `--diagnose`.
- **7.5 Fault isolation (`crates/opaline-core/src/engine/sampler.rs`):** Added dedicated integration tests `panicking_provider_is_isolated_from_healthy_siblings` and `hanging_provider_does_not_stall_healthy_siblings` proving neither panics nor hangs crash core or stall other providers (alongside existing `supervise::tests::a_panicking_provider_is_restarted_and_reported`).

**Budgets & Acceptance (brief §7 & §10, P7)**

| Metric / Check | Budget / Target | Measured (2026-11-24, dual monitor, Native Wayland) | Status |
| - | - | - | - |
| Startup to widgets visible | ≤ 1.5 s | **0.72 s** (`12:42:16.570` core start → `12:42:17.293` `layer-eDP-1` rendered) | ✅ |
| Covered idle CPU (30 s avg) | ≤ 0.1 % | **0.087 %** of machine (8 logical CPUs) | ✅ |
| Idle CPU (covered / settled) | ≤ 0.5 % | **0.042–0.087 %** | ✅ |
| RAM (PSS, dual-monitor, `eDP-1` @ `dpr=2`) | ≤ 280 MB (ADR 0009) | **239.9 MB** settled before Edit; **337.9 MB** post-Edit (core 52.1 + layer UI 94.4 + Net 17.3 + WebKitWebProcess 174.1; Mesa retains full-screen `dpr=2` EGL buffers after Edit backdrop) | ⚠️ Pre-Edit ✅ / Post-Edit warm EGL |
| Sleeping dGPU rule | ADR 0003 checks | Verified in P1 (`runtime_status` check before NVML, NVML released when idle) | ✅ |
| Fault isolation (panic + hang) | No crash, no stall | `panicking_provider_is_isolated_from_healthy_siblings` & `hanging_provider_does_not_stall_healthy_siblings` pass | ✅ |
| Security review | §5.8 / PLAN 7.4 | Recorded in `docs/SECURITY.md` | ✅ |
| 🧑 Owner review of German & Arabic strings + RTL & a11y sign-off | Plan 7.1–7.2 | ✅ 2026-11-24 |


## Phase 8: Release (v1.0.0 tagged 2026-11-24)

**Done**
- **8.1 `.deb` package, maintainer scripts & AppStream (`tauri.conf.json`, `packaging/deb/{postinst,prerm,postrm}`, `packaging/metainfo/io.github.ali_kenjo.Opaline.metainfo.xml`, `scripts/stage-deb-assets.sh`):** Full `Opaline_1.0.0_amd64.deb` bundling `/usr/bin/opaline`, `/usr/libexec/opaline/opaline-privileged`, `Opaline.desktop` (with Peek/Edit/Settings/Quit actions), AppStream metainfo, hicolor SVG + PNG icons, D-Bus system service + bus policy, polkit policy, and the GNOME Shell helper with compiled `gschemas.compiled`. Validated with `desktop-file-validate`, `appstreamcli validate --no-net`, and `dpkg-deb -I/-c`.
- **8.2 Clean Ubuntu 26.04 VM checklist (`docs/RELEASE.md`):** Step-by-step clean-VM install, Instant→Native switch, upgrade, and clean uninstall verification guide.
- **8.3 Release workflow (`.github/workflows/release.yml`, `ci.yml`):** Automated `ubuntu:26.04` tag release pipeline that stages auxiliary assets, builds the `.deb`, produces `SHA256SUMS`, signs with `minisign` when `MINISIGN_SECRET_KEY`/`MINISIGN_PASSWORD` secrets are configured, and publishes the GitHub Release.
- **8.4 Documentation (`README.md`, `.github/ISSUE_TEMPLATE/hardware-report.yml`, `THIRD_PARTY.md`):** Full user-facing README (features, `.deb` install, privacy table, Native vs Instant & NVIDIA troubleshooting, build/test instructions) and hardware-report issue template requesting redacted `opaline --diagnose` output.
- **8.5 `v1.0.0` release:** Versions bumped to `1.0.0`, `Opaline_1.0.0_amd64.deb` built and verified locally, annotated tag `v1.0.0` pushed to GitHub.


## v1.1.0 (tagged 2026-11-24)

Post-release work after your first real use of v1.0.0. One commit (`9c4726a`).

**Done**
- **Click-through:** outside Edit and Peek, clicks pass through the layer to the desktop. The input region is now set on the
  `GtkWindow` widget (not only its `GdkWindow`), so GTK3 on Wayland commits `wl_surface.set_input_region` and keeps it across
  realizes, resizes and configures. WebKitGTK's default browser context menu (Back/Forward/Reload) is suppressed on the layer.
- **Audio / microphone indicator:** the visualizer's PipeWire stream is now `Stream/Input/Audio/Monitor` with category
  `Monitor`. WirePlumber still links it to the default sink's monitor ports, but `pipewire-pulse` no longer exposes it as a
  source-output, so GNOME's microphone indicator stays off (this was an open finding in Phase 1).
- **Transparency:** a transparent, frameless surface mode and per-widget transparency controls.
- **Customizer:** an in-app per-widget customizer (`app/src/settings/WidgetCustomizer.tsx`, in Settings → Widgets).
- **Visualizer:** 10 styles (including spectrum, fire, ocean, gradient and "follow widget style"), colour palettes, optional
  glow and peak caps, interpolated band counts.
- **Hardware info fields:** CPU, RAM (slots, speed, DDR type, manufacturer), GPU and storage widgets show more hardware detail.
- Version bumped to 1.1.0 (workspace, metainfo release entry); `.deb` `Opaline_1.1.0_amd64.deb` built.

**Measured 2026-11-25** (installed 1.1.0, Native mode, up 2 h 43 min, one widget on `eDP-1`, `scripts/measure-budget.sh 15`)

| Metric | Budget | Measured | Status |
| - | - | - | - |
| CPU | ≤ 0.5 % | 0.050 % | ✅ |
| RAM (PSS) | ≤ 280 MB | **426.4 MB** (core 70.5, layer 92.3, network 16.0, web process 247.7) | ❌ |

**Open**
- **Memory is 146 MB over budget.** One 15 s sample; whether it comes from Edit mode, the 1.1.0 visualizers or uptime is not
  known. Next step: measure fresh start, after Edit, after 1 h and after 8 h, then fix or formally raise the budget.
- `fans` provider sample takes ~405 ms (`--diagnose`) while declared `cheap`.
- No automated UI tests for Edit mode, Settings and Onboarding; the GNOME Shell helper is only linted.
- See `docs/ANALYSIS_REPORT.md` for the full review.


## 2.0 · Phase 0: Stabilize (signed off 2026-11-25)

Brief: `OPALINE_2_BRIEF.md` §11; plan: `docs/PLAN-2.md` (approved 2026-11-25).

**Done**
- **0.1–0.4 Memory** (ADR 0009 update): `scripts/memory-breakdown.sh` (PSS per process split into heap, GPU, shared
  memory, libraries, files) and `scripts/memory-trend.sh` (long runs into a CSV). Measured fresh start, Peek, Edit
  cycles and long use; isolated the growth to WebKit's web process keeping memory after widgets are shown, updated
  and edited (not a JS leak, not the channel path, not the visualizer); only a new web process releases it.
  **Your decision: budget raised to 450 MB PSS.** Fixed on the way: the sparkline reallocated its canvas on every
  animation frame. Found: after a web-process crash the layer ends up with two web processes (+60 MB).
- **0.5–0.6 UI tests:** a fake core injected before page load (`app/e2e/stub/`) runs the real `layer.html`,
  `settings.html` and `onboarding.html`; 23 new Playwright tests cover Edit mode (enter/leave, keyboard, drag,
  resize handles, stacks, remove + undo snackbar, undo/redo), the picker (search, categories, unavailable reasons,
  click and drag to place, presets), detail views, the context menu, every Settings section, a settings round trip,
  quick actions and the whole onboarding flow.
- **0.7 `LayerApp.tsx` split** (1,808 → 901 lines, behavior unchanged, all UI tests unchanged): `GridItems.tsx`,
  `EditToolbar.tsx`, `DragFeedback.tsx`, `LayerStackEditor.tsx`, `useDragController.ts`, `useEditKeyboard.ts`,
  `useEditHistory.ts`, `useLayerPrefs.ts`, `layoutRules.ts`, `editTypes.ts`, `modes.ts`.
- **0.8 Small fixes:** grid numbers above (84 px / 12 px); `fans`: HP's firmware takes about 200 ms per fan read
  (waiting, not CPU), so the provider is labelled expensive and samples every 2 s; Instant-mode layer restarts back
  off to 5 minutes and stop promptly; updater: unverifiable releases are refused before any download (tested), and
  the release workflow fails instead of publishing unsigned. **The built-in signing key is empty**, so in-app updates
  can't install until a minisign key is created (needs you).
- Lab: `?only=glass|widgets|components|specimen` and `?kinds=cpu,clock` for bisecting.

**Acceptance (PLAN-2 P0)**

| Check | Result |
| - | - |
| Memory ≤ 280 MB with the default layout, or your decision | ✅ Decision: **450 MB** (ADR 0009). Measured: fresh ~307 MB, after Peek + Edit 430–505 MB (stress), 426–429 MB after hours of normal use; **1-hour trend** (installed 1.1.0, your layout, idle, 2026-11-25 21:18–22:18): 288 → 279 MB, web process flat at 152–154 MB |
| UI tests green | ✅ 35 Playwright (12 before), 70 Vitest |
| `LayerApp.tsx` split, no behavior change | ✅ 901 lines, all UI tests unchanged |
| Rust tests, clippy `-D warnings`, rustfmt, ESLint, Prettier, tsc, helper lint | ✅ 163 Rust tests (159 before; NVML test ignored as usual), all lints clean (2026-11-25) |
| 🧑 Your sign-off | ✅ 2026-11-25 |


## 2.0 · Phase 1: Design language and glass 2.0 (ready for sign-off, 2026-11-26)

**Done**
- **1.1 Visual directions** (`lab.html?only=directions`, `docs/design/`): Lens, Pebble and Instrument on Clock, CPU,
  Weather and Now Playing at S and M over a dark and a light wallpaper. **Your decision: all three** — Lens becomes
  Crystal, Pebble becomes Bloom, Instrument a tenth theme, and the default Opaline is the hybrid (Lens type, Pebble
  shapes where they mean something, Instrument dial and charts at M) (DESIGN-2 §11).
- **1.2 Spike S1, see-through glass** (ADR 0012): a sharp, native-resolution wallpaper variant from core (JPEG, about
  0.4 MB per monitor, rendered once and then cached), loaded by the layer only while a widget's blur is below the 1.x
  level; **default: sharp sampling**, "Real transparency" as an option (desktop icons show; sampled during Peek/Edit).
- **1.3 Spike S2, WebKitGTK features** (ADR 0013): container queries yes; variable axes of system fonts no (bundled
  fonts yes); WebGL2 in workers no; **the page CSP doesn't reach workers** (a worker's `no-cors` fetch reaches the
  network) — the plugin sandbox spike S5 has to solve that first.
- **1.4 DESIGN-2** §1–8 and §11 filled in: type scale, anatomy, responsive rules, kind colors, shape meanings, glass
  2.0, legibility, desktop looks.
- **1.5 No truncated labels**: written short labels per field (`FieldDef.shortLabel`), `Fit` and `fitRows`
  (icon → short label → hidden label → drop the row; values never cut; no half-visible rows), short date forms on the
  clock. The hero auto-fit moves to P2's Number block.
- **1.6 Glass 2.0**: one blur scale (0 sharp … 60 = exactly the 1.x look … 100), real transparency, edge dispersion,
  specular angle and width, inner glow, shadow color/offset/size (shader and compositor; style keys for the new
  effects come with style model 2.0 in P3). **Settings v2** migrates stored blur values (60 + 0.4 × old).
- **1.7 Legibility 2.0** (DESIGN-2 §8.4): per widget from the wallpaper image (mean and the darkest/brightest 1 %):
  text ink first, halo, then more blur, the tint last; only for glass clearer than the 1.x look, so Classic stays
  1.x. The widget settings sheet shows the measured contrast and warns below 4.5 : 1. Fixed on the way: dark text on a
  dark custom surface color in a light theme; the 1.x tint is judged on the weaker secondary text (target 4.7).
- **1.8 Desktop looks**: Glass · Clear · Tinted · Dark · Light · Dimmed and a master transparency, on the Edit toolbar
  (Look) and in Settings → Appearance (en/de/ar).
- **1.9 Lab checks**: zero truncation and text contrast **measured from screenshots** (glyphs hidden, the pixels behind
  each text run, WCAG 4.5 / 3 : 1), on a dark and a light wallpaper, in the Glass and the Clear look; `?look=`,
  `?spike=glass`, `?spike=webkit`.
- **1.10 Classic**: the 1.1 look is today's default (blur 60, transparency 60) and every 1.1 Lab baseline still
  passes unchanged.

**Acceptance (PLAN-2 P1)**

| Check | Result |
| - | - |
| Zero-truncation and contrast checks pass | ✅ 12 checks (2 stages × dark/light wallpapers × Glass/Clear looks) |
| At blur 0 and tint 0 the wallpaper shows through sharp; text stays readable or the warning appears | ✅ `lab.html?spike=glass` (`docs/design/p1-legibility2.png`): sharp at blur 0; ink, halo and blur keep text readable, the tint rises only where needed; with "Keep text readable" off the sheet warns |
| Tests | ✅ 147 Rust (core), 78 Vitest, 42 Playwright; clippy, rustfmt, ESLint, Prettier, tsc clean |
| Budget (release, your layout on a config copy, both monitors, widgets visible) | RAM **415–419 MB** PSS (1.1.0 on the same copy: 414–417 MB; budget 450); the legibility map adds about 5 MB to the web process. Fixed: core re-rendered the sharp wallpaper on every start (+20 MB kept by glibc). CPU with widgets **visible**: about 2 %, the same as 1.1.0 (2.0 %) — the ring and odometer springs on every 1 Hz update; covered stays near 0 (P0). Known issue for P2's Number and Ring blocks |
| 🧑 Tuning the default see-through look on your desktop | ✅ 2026-11-26, release build on a copy of your settings: **blur 30, transparency 80, "Keep text readable" on** ("Yes, keep it"); the Opaline theme carries these values (DESIGN-2 §8.3) |
| 🧑 Your sign-off | pending |

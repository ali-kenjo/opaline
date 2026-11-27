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


## 2.0 · Phase 1: Design language and glass 2.0 (signed off 2026-11-26)

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
| 🧑 Your sign-off | ✅ 2026-11-26 |

## 2.0 · Phase 2: Composition engine (signed off 2026-11-27)

**Built** (all local, not pushed):
- **Expression language** (`docs/EXPRESSIONS.md`): `crates/opaline-expr` (Rust) and `app/src/expr` (TS), one grammar,
  pipes, null propagation, locale formatting (fixed, percent, unit, bytes, duration), colors, `has`, history
  (`avg/min/max/delta`), `now/until`, layer-only `date` (ICU skeletons via Intl, `'w'` = ISO week) and `ramp`.
  Shared corpus `spec/expressions/` (~160 cases) passes on both; a differential test agreed on 200,000 random
  programs; fuzz/property tests; nesting limit 64 (operators count). No `eval`/`new Function` (lint rule).
- **Composition model** (`docs/COMPOSITION.md`): `crates/opaline-compose` (Rust types are the source) →
  `spec/composition.schema.json` → `app/src/compose/model.gen.ts` (`pnpm gen:types`); staleness tests both ways.
  Validation with JSON pointers, limits (1 MiB, 1024 nodes, depth 24, raw JSON depth checked before serde), command
  allowlist for controls (also in TS, parity test).
- **Runtime** (`app/src/compose/runtime.ts`): compile once, lazy evaluation remembering inputs, re-evaluate only on
  change; `now()` wakes at the coarsest step its formats need (a HH:mm clock once a minute). Idle = 0 evaluations
  (Lab e2e test reads `__labEvaluations`).
- **Renderer and all blocks** (`app/src/compose/render/`): containers (stack/row/column/grid/overlay/spacer), text
  with shorter forms, number (odometer), icon, image (core assets/data only), shape (morph), ring/gauge (sweep,
  caps, segments, wavy, ticks, needle, ramp colors), bar, progress, chart (values or core history + live points),
  heatmap, list (`$item/$index`, fit rows), divider, canvas (analog clock), button/toggle/slider/input (allowlisted
  commands, two-click confirm), plugin placeholder. Lab stage "Composition blocks" with screenshot/truncation/contrast.
- **Clock runs on the engine** (`widgets/clock.composition.ts`, equal to `spec/compositions/clock.json`, which core
  validates); same options and behavior as before.
- **Spikes:** S5 plugin sandbox (ADR 0014: worker under an `opaline-plugin://` host page with its own CSP header;
  iframe `sandbox="allow-scripts allow-same-origin"`), S3 keyboard focus (ADR 0015), S4 Quick Settings APIs
  (ADR 0016: all controls work from core with the shell's interfaces; volume via `wpctl` + PipeWire).
- **Fixes from S3:** the layer no longer steals focus at start (focus-on-map off; helper focus guard in Native,
  verified after re-login); widget buttons/controls take clicks on the desktop (`[data-interactive]` input region,
  e2e test); buttons hand focus back (`release-focus` → helper `ReleaseFocus`, additive `ApiRevision` 1).
- **Animation CPU:** fitting no longer re-measures every render (variant toggles 3,050 → 36 per 15 s); springs settle
  below half a pixel; data-driven animations capped at 30 fps. Lab (headless WebKit): CPU+Clock 22 → 10 frames/s,
  23 % → 18 % of a core (`app/scripts/measure-lab-cpu.mjs`).

**Checks:** cargo workspace tests, clippy `-D warnings`, fmt; 272 Vitest, 55 Playwright e2e; differential expression
test; helper lint.

**Not done / deferred:** a real-layer budget run (owner skipped it on 2026-11-27; the animation work is measured only
headless); the `ensure_enabled` side finding; P7 control widgets.

## 2.0 · Phase 3: Style model 2.0, themes and files (signed off 2026-11-27)

**Built** (pushed):
- **Mechanical style-key parity (3.1, S7, ADR 0017):** `crates/opaline-core/src/style.rs` is the single source of
  truth (`schemars::JsonSchema`) → `spec/style.schema.json` → `app/src/design-system/style/style.gen.ts` +
  `STYLE_KEYS` via `app/scripts/schema-to-ts.mjs`. Staleness checks fail both `cargo test -p opaline-core --test
  schemas` and Vitest (`model.test.ts`), and `tsc` / `style.test.ts` enforce `BUILTIN_STYLE` and `STYLE_FIELDS`
  completeness.
- **6-layer cascade & Style Model 2.0 (3.2, 3.3):** cascade `default → theme → global → kind → widget → element`
  with exact origins (`resolveCascade`), per-role typography merging, `kindStyles` in `settings.json`, and per-element
  `elements` overrides on placed widgets. Added all §5.1 controls (89 total keys): 35 Material card shapes wired into
  the WebGL2 glass compositor, corner smoothing & per-corner radii, 2–4 stop gradients, local/album-art backgrounds,
  glass 2.0 parameters (`dispersion`, `specularAngle`, `specularWidth`, `innerGlow`, `refractionWidth`, `shadow*`,
  `innerShadow`, `borderGlow`), overall opacity, per-role typography & OpenType features (`slashedZero`,
  `stylisticSet`), all three Material Symbols sets (**Rounded, Outlined, Sharp**, subset to ~101–145 KB each),
  hero visual options, layout/header style, hover/press/entrance/value/ambient effects, behavior actions,
  `autoHideEmpty`, and ordered **conditional styles** validated by `opaline-expr` in core and evaluated live in
  `WidgetFrame`.
- **Theme packages & first-party themes (3.4, 3.9):** `crates/opaline-core/src/themes.rs` and `zip_pkg.rs` (safe
  pure-Rust ZIP reader/writer on `flate2`/`crc32fast` with zip-slip, entry-count, size, compression-ratio, and CRC-32
  checks). Supports folders and `.opaline-theme` archives across `/usr/share/opaline/themes/`,
  `~/.local/share/opaline/themes/`, and `~/.config/opaline/themes/`, with embedded fallbacks, mandatory font license
  checks, and key-by-key fallback reporting file + JSON pointer problems without blanking the desktop. Shipped
  **Opaline** (DESIGN-2 §8.3 tuned blur 30 / transparency 80, Roboto Flex hero scale, kind accents) and **Classic**
  (exact 1.1 baseline) packages in `spec/themes/` and packaged in `tauri.conf.json`.
- **Config as files & live reload (3.5, S9):** `crates/opaline-core/src/watcher.rs` watches `~/.config/opaline/` and
  theme directories with Linux `inotify` (`rustix::fs::inotify`, zero `unsafe`). `WriteLedger` suppresses self-writes
  by SHA-256 hash so Opaline never loops; broken external edits preserve the last good state and surface a
  non-blocking toast (`config.problems`) naming file and JSON path. Generated JSON Schemas for `settings`, `layouts`,
  `style`, `theme`, `composition`, and `rice` in `spec/`, packaged to `/usr/share/opaline/schemas/`, with `$schema`
  written into saved files. Documented in `docs/CONFIG.md`.
- **User CSS & safe mode (3.6):** `crates/opaline-core/src/css.rs` validates `theme.css` and
  `~/.config/opaline/user.css` (rejecting remote `url()`, `file://`, `@import`, `javascript:`, `expression()`) and
  publishes them live on `style.css`; `LayerApp` injects `<style id="opaline-theme-css">` / `<style
  id="opaline-user-css">` and exposes the `data-theme`/`data-kind`/`data-size`/`data-state`/`data-role`/`data-block`
  contract (`docs/THEMING.md`). Added `opaline --safe-mode`, the `Start in safe mode` desktop action, and automatic
  safe-mode activation after two consecutive startup crashes.
- **Save this look, rices & 1.1 migrations (3.7, 3.8):** `crates/opaline-core/src/rice.rs` exports `.opaline-theme`
  and `.opaline-rice` archives with work-area-anchored positions and stripped secrets, forcing imported sources to
  `approved = false`. Added redacted 1.1 fixtures (`fixtures/v1.1/`) and `crates/opaline-core/tests/migrations.rs`
  verifying zero-loss migration (`blur` rescaled, `theme` set to `"classic"` so 1.1 upgraders keep their look).

**Checks:** 198 Rust workspace tests (159 core unit + 6 schema/theme + 2 migration + 8 compose + 7 binary + 11 IPC +
7 expr + 3 privileged; 1 NVML ignored), `clippy -D warnings`, `rustfmt`; 275 Vitest, 56 Playwright WebKit e2e (all 55
existing baselines/checks + new `themes.spec.ts`), `eslint`, `prettier`, `tsc`, helper lint, `desktop-file-validate`.

**Sign-off:** ✅ 2026-11-27. Next: Phase 4 (redesign the 14 widgets and build the ten looks, in rounds).

## 2.0 · Phase 4 · Round 1: Clock, CPU, Memory, GPU (2026-11-27)

**Done**
- **Core provider upgrades (4.2–4.4):**
  - Added `crates/opaline-core/src/icons.rs` (`IconResolver`) resolving FreeDesktop `.desktop` icon names across
    user/system XDG icon themes (`Yaru`, `Adwaita`, `hicolor`, `Papirus`, `breeze`, `pixmaps`) into content-hashed
    files under `$XDG_CACHE_HOME/opaline/icons/` (rejecting unsafe SVGs and files > 512 KiB). Exposed `iconUrl` on
    `processes.apps` and enabled `opaline-asset://icons/<file>` (including `image/svg+xml`) in
    `app/src-tauri/src/layer/assets.rs`.
  - Added `memory.zram` (`/sys/block/zram*/mm_stat`) to `crates/opaline-core/src/providers/memory.rs` alongside
    `memory.zswap` (`origDataB`, `comprDataB`, `memUsedB`, `ratio`, `devices`).
  - Added `gpu.<index>.engines` (`render3d`, `video`, `copy`, `compute`) to `crates/opaline-core/src/providers/gpu.rs`
    from DRM fdinfo per-engine buckets and NVML, keeping the ADR 0003 sleep guard intact (sleeping dGPUs report
    `Availability::Asleep` and are never touched).
- **4.1 Clock redesign (`clock.ts`, `clock.composition.ts`, `clockVisuals.tsx`, `spec/compositions/clock.json`):**
  - All 11 faces: Digital (inline or stacked), Expressive (digits on Material shapes), Analog ×6 dial styles
    (`minimal`, `classic`, `numerals`, `roman`, `chronograph`, `railway`), Flip, Word clock, Typographic, Segment/LCD,
    Binary BCD, Terminal (`$ date`), Day ring, and Big date.
  - Per-element colors (`handColor`, `tickColor`, `numeralColor`), second-hand modes (`tick` / `sweep` via shared
    scheduler / `hide`), custom ICU skeleton date option, second time zone, and optional next-event subline
    (`calendar.events`). Preserved exact minute-clock wakeups and existing Classic Lab baselines.
- **4.2–4.4 CPU, Memory, GPU redesign (`{cpu,memory,gpu}.composition.ts`, `monitorVisuals.tsx`, `spec/compositions/{cpu,memory,gpu}.json`):**
  - Added `useClassicStat` + `compositionTopics` in `WidgetFrame.tsx` / `compose/widget.tsx` so the **Classic** theme
    (and unthemed Classic Lab) preserves `StatLayout` pixel-for-pixel while **Opaline** and 2.0 themes render the
    redesigned compositions.
  - **CPU**: hero visual switcher (thermal shape badge shifting `circle → cookie7Sided → softBurst → burst` by °C,
    load gauge, per-core bars, heatmap, 15m load area chart), temperature source (`package` / `core-max`), frequency
    mode (`avg` / `max`), power, throttling badge, per-core grid and top CPU apps with icons at L/XL.
  - **Memory**: liquid-fill canvas whose wave choppiness follows `memory.pressure` (0 frames when still/reduced-motion),
    stacked composition bar (apps, shared, cache, buffers, zram/zswap, swap, free), `zram` field, GB/GiB, top memory
    apps with icons at L/XL.
  - **GPU**: side-by-side iGPU + dGPU at M/L/XL when multiple GPUs exist, engine busyness bars (`3D`, `Video`, `Copy`,
    `Compute`), VRAM bar, power-vs-limit gauge, clocks, fan, top GPU apps, and moon + `"Asleep · 0 W"` state for
    sleeping dGPUs without waking them.
- **Lab & E2E:** Added `lab.html?only=round1&still` (`Round1Demo.tsx`) and `app/e2e/round1.spec.ts` verifying all
  Clock faces, CPU/Memory/GPU Opaline cards, sleeping dGPU side-by-side behavior, and 0 idle frames.

**Checks:** 202 Rust workspace tests (all 4 `spec/compositions/*.json` validated by `opaline-compose`), `clippy -D warnings`,
`rustfmt`; 280 Vitest, 58 Playwright WebKit e2e (all 56 existing baselines/contrast/truncation/edit/themes + 2 new
`round1.spec.ts`), `eslint`, `prettier`, `tsc`.

**Sign-off:** ✅ 2026-11-27. Next: Round 2 (4.5 Storage, 4.6 Network, 4.7 Battery & Power, 4.8 Fans).

## 2.0 · Phase 4 · Round 2: Storage, Network, Battery & Power, Fans (2026-11-27)

**Done**
- **Core provider upgrades (4.6–4.7):**
  - Added `JitterTracker` (`jitterMs`) to `crates/opaline-core/src/providers/latency.rs` (RFC 3550-style EWMA of
    consecutive RTT deltas, reset on unreachable) with unit tests.
  - Exposed UPower battery charge-limit properties (`chargeThresholdEnabled`, `chargeStartThreshold`,
    `chargeEndThreshold`) in `crates/opaline-core/src/providers/upower.rs`.
- **4.5 Storage (`storage.ts`, `storage.composition.ts`, `spec/compositions/storage.json`):**
  - Multi-drive bars or rings (`displayMode: "bars" | "rings"`), health badges, drive temperatures, sorting
    (`default` / `percent` / `free` / `name`), include/exclude mount filters, live read/write rates, and
    confirmed Eject / Power off buttons for removable drives (`drive-eject`, `drive-power-off`).
- **4.6 Network (`network.ts`, `network.composition.ts`, `spec/compositions/network.json`):**
  - Dual-wave hero (`net-wave`) whose speed and amplitude follow download/upload throughput (0 frames when still /
    reduced motion), optional monthly data cap ring (`monthlyCapGb`), Wi-Fi signal shape (`wifi-shape`), VPN badge,
    latency with `± jitter`, per-interface selection, and privacy toggles for SSID and public IP (`showSsid`,
    `showIp`).
- **4.7 Battery & Power (`battery.ts`, `battery.composition.ts`, `spec/compositions/battery.json`):**
  - Liquid-filled battery pill (`battery-pill`) with animated charging bubbles (0 frames when still/reduced motion),
    time to full or empty, power draw, health %, charge-limit badge when supported, live power-profile buttons
    (`set-power-profile`), and wireless peripherals with device icons (`peripheral-list`).
- **4.8 Fans (`fans.ts`, `fans.composition.ts`, `spec/compositions/fans.json`):**
  - Spinning fan blade glyph (`fan-spinner`) rotating proportionally to RPM (static under reduced motion / still /
    0 RPM), per-fan semicircular RPM gauges (`fan-gauges`), and related CPU/GPU thermal badges.
- **Classic 1.1 preservation & Lab:** All four widgets keep `StatLayout` under `classic` (1.1 Lab baselines
  unchanged); added `lab.html?only=round2&still` (`Round2Demo.tsx`) and `app/e2e/round2.spec.ts`.

**Checks:** 203 Rust workspace tests (all 8 `spec/compositions/*.json` validated by `opaline-compose`),
`clippy -D warnings`, `rustfmt`; 285 Vitest, 59 Playwright WebKit e2e (all existing baselines/checks +
`round2.spec.ts` verifying 0 idle frames), `eslint`, `prettier`, `tsc`.

**Sign-off:** ✅ 2026-11-27. Next: Round 3 (4.9 Processes, 4.10 Now Playing, 4.11 Visualizer).

## 2.0 · Phase 4 · Round 3: Processes, Now Playing, Visualizer (2026-11-27)

**Done**
- **Core provider & IPC upgrades (4.9–4.11):**
  - Added binary `FrameKind::Waveform` (128 downsampled PCM bytes centered at 128) and `FrameKind::Stereo`
    (`left_rms`, `right_rms`, 32 L bands, 32 R bands) in `opaline-ipc`, `opaline-core/providers/audio.rs`
    (`waveform_bytes`, `StereoAnalyzer`, stereo capture ring), `opaline-core/ipc_server.rs`, Tauri `bridge.rs` /
    `client.rs`, and frontend `protocol.ts` / `spectrum.ts` / `layerHost.ts` / `host.tsx`.
  - Extended `opaline-core/providers/media.rs` to expose MPRIS `shuffle`, `loopStatus`, `volume`, and local sibling
    `.lrc` synced lyrics (`parse_lrc`, capped at 128 KiB), and wired `Command::{MediaShuffle, MediaLoop, MediaVolume}`
    through IPC, core command handler, and `opaline-compose` allowed commands.
  - Extended `opaline-core/providers/processes.rs` to read `/proc/<pid>/io` (`parse_proc_io`) for user-owned
    processes, compute delta `ioBps` per process and summed per app, and emit `iconUrl` on `processes.list` too.
- **4.9 Processes (`processes.tsx`, `processes.composition.ts`, `spec/compositions/processes.json`, `round3Visuals.tsx`):**
  - Real cached app icons (`iconUrl`, with crisp initial badge fallback — replacing the generic glyph), CPU / RAM /
    Disk I/O columns, optional non-waking GPU load pill when available, inline search/filter bar, Apps / Processes
    toggle, sortable column headers, and 2-step confirmed End task (`end-task`).
- **4.10 Now Playing (`media.tsx`, `media.composition.ts`, `spec/compositions/media.json`, `round3Visuals.tsx`):**
  - Three looks: **Glass card** (optional blurred album-art backdrop + Material shape mask `cookie`/`clover`/`pill`/
    `softBurst`/`circle`/`rounded` gently breathing with bass via `scheduler`), **Spinning vinyl** (grooved disc with
    center cover label), and **Retro cassette** (translucent shell with turning dual reels) — 0 frames when paused or
    still.
  - Local synced `.lrc` lyric line, seekable wavy progress bar (`WavyProgress`), shuffle / repeat / volume controls,
    and inline multi-player switcher pills.
- **4.11 Visualizer (`visualizer.tsx`, `visualizerGl.ts`):**
  - Preserved all 10 Classic styles and added 7 new styles: **Circular around album art** (`album-ring`, reading
    `media.player.art`), **Spectrogram waterfall** (`spectrogram`), **Analog VU needles** (`vu`), **LED segments**
    (`led`), **Bass particles** (`particles`), **Oscilloscope** (`oscilloscope`), and **Stereo L/R split**
    (`stereo-split`).
  - Added lightweight WebGL2 renderer (`visualizerGl.ts`) for `spectrogram` and `particles` with seamless 2D canvas
    fallback and strict `scheduler` gating (0 idle frames).
- **Classic 1.1 preservation & Lab:** `processes` and `media` retain their Classic 1.1 renderers under `classic`
  (`useClassicStat: true`), and `visualizer` keeps default `bars` identical; added `lab.html?only=round3&still`
  (`Round3Demo.tsx`), `app/src/widgets/round3.test.ts`, and `app/e2e/round3.spec.ts`.

**Checks:** 213 Rust workspace tests (all 10 `spec/compositions/*.json` validated by `opaline-compose`),
`clippy -D warnings`, `rustfmt`; 289 Vitest, 60 Playwright WebKit e2e (all existing baselines/checks +
`round3.spec.ts` verifying 0 idle frames), `eslint`, `prettier`, `tsc`.

**Sign-off:** ✅ 2026-11-27. Next: Round 4 (4.12 Weather, 4.13 Calendar, 4.14 Docker) and Round 5
(4.15 The ten looks + 4.16 Lab baselines).

## 2.0 · Phase 4 · Round 4: Weather, Calendar, Docker (2026-11-27)

**Done**
- **Core provider upgrades (4.13–4.14):**
  - Expanded `calendar.rs` look-ahead window (`DAYS_AHEAD = 35`) so mini-month grids display accurate event dots
    across the full visible month while keeping the existing `MAX_EVENTS = 200` / `MAX_OCCURRENCES = 100` bounds.
  - Added sorted, deduplicated published port mappings (`ports`: `["8080:80", …]`) to `docker.rs`'s
    `container_value`, with unit test coverage.
- **4.12 Weather (`weather.tsx`, `weather.composition.ts`, `spec/compositions/weather.json`, `round4Visuals.tsx`):**
  - Illustrated sky atmosphere scene (`skyScene`: sun halo, night moon + stars, clouds, rain streaks, snow, storm
    bolt, fog — gently animated via `scheduler`, 0 frames when still / reduced motion), current hero + feels-like +
    H/L, hourly strip with precipitation bars, 5–7 day low-to-high temperature range bars, wind compass arrow +
    speed, UV index, humidity, European AQI badge, sunrise/sunset daylight arc, and Open-Meteo attribution.
- **4.13 Calendar (`calendar.tsx`, `calendar.composition.ts`, `spec/compositions/calendar.json`, `round4Visuals.tsx`):**
  - Mini month grid (`view: "auto" | "month" | "agenda"`, `weekStart: "mon" | "sun"`) with colored event indicator
    dots and interactive day selection, agenda with live countdown pill (`"In 35 min"` / `"Happening now"`),
    current-time rule, all-day event chips, and click-to-expand event details.
- **4.14 Docker / Podman (`docker.tsx`, `docker.composition.ts`, `spec/compositions/docker.json`, `round4Visuals.tsx`):**
  - Compose-project grouping (`groupByProject`, with standalone fallback), engine + running/total header pill,
    inline status filter pills (`All` / `Run` / `Stop`), glowing status dots, published port chips, live CPU & RAM
    mini bars, Start / Restart / Stop actions (2-step confirm on Stop & Restart), and honest `"Docker Desktop is
    stopped"` card with `"Start Docker Desktop"` button.
- **Classic 1.1 preservation & Lab:** All three widgets keep their Classic 1.1 renderers under `classic`
  (`useClassicStat: true`, 1.1 Lab baselines pixel-identical); added `lab.html?only=round4&still`
  (`Round4Demo.tsx`), `app/src/widgets/round4.test.ts`, and `app/e2e/round4.spec.ts`.

**Checks:** 213 Rust workspace tests (all 13 `spec/compositions/*.json` validated by `opaline-compose`),
`clippy -D warnings`, `rustfmt`; 293 Vitest, 61 Playwright WebKit e2e (all existing baselines/checks +
`round4.spec.ts` verifying 0 idle frames), `eslint`, `prettier`, `tsc`.

**Sign-off:** ✅ 2026-11-27. Next: Round 5 (4.15 The ten built-in looks + starter layouts +
lazy fonts, and 4.16 Lab baselines per theme with zero-truncation & contrast checks).

## 2.0 · Phase 4 · Round 5: The ten built-in looks & per-theme Lab verification (2026-11-27)

**Done**
- **4.15 The ten built-in first-party looks (`spec/themes/<id>/theme.json`, `crates/opaline-core/src/themes.rs`, `tests/schemas.rs`):**
  - Authored all eight new first-party theme packages alongside `opaline` (enriched with all §6.2 per-kind accent
    colors) and `classic`: **Crystal** (ultra-clear glass lenses, squircles, heavy condensed numerals), **Bloom**
    (tactile per-kind tinted glass, expressive shapes, playful motion), **Instrument** (smoked cockpit glass with
    hairlines, extended numerals, calm motion), **Air** (frameless haloed typography directly on the wallpaper),
    **Terminal** (opaque monospace TUI frames, slashed zeroes, instant updates, boxed `theme.css`), **Neon** (deep
    twilight cards, glowing magenta/cyan borders, `theme.css`), **Paper** (warm light editorial matte cards, serif
    display numerals, zero glass), and **Mono** (crisp high-contrast monochrome).
  - Embedded all 10 built-in looks in `opaline-core` (`BUILTIN_THEME_IDS`, `EMBEDDED_THEMES`, safe-mode CSS
    suppression) and validated all 10 manifests against `spec/schemas/theme.schema.json`.
  - Added curated starter layouts for all 10 looks (`app/src/layer/starterLayouts.ts`, `buildStarterLayout` in
    `presets.ts`) and lazy font loading with offline fallback stacks (`app/src/design-system/type/lazyFonts.ts`,
    wired into `apply.ts` and `layerHost.ts`).
- **4.16 Per-theme Lab showcase, zero-truncation & contrast checks (`LooksDemo.tsx`, `e2e/looks.spec.ts`, `themes.test.ts`):**
  - Built `lab.html?only=looks&lookTheme=<id>&still` rendering all 10 real theme manifests with their starter layouts.
  - Fixed multi-size layout selection (`sizes: [...]`) on Round 3–4 compositions (`processes`, `media`, `weather`,
    `calendar`, `docker` + regenerated `spec/compositions/*.json`) and hardened text/wave/backdrop readability across
    `liquid-fill`, `net-wave`, `battery-pill`, `now-playing`, `weather-scene`, and `calendar-view` so every single
    built-in look passes WCAG 4.5:1+ pixel contrast, zero label/value truncation, and zero idle frames.

**Checks:** 213 Rust workspace tests (all 13 `spec/compositions/*.json` and all 10 `spec/themes/*/theme.json`
validated), `clippy -D warnings`, `rustfmt`; 296 Vitest, 71 Playwright WebKit e2e (all Classic 1.1 baselines
pixel-identical + all 10 looks verified in `looks.spec.ts` for rendering, zero truncation, WCAG contrast, and 0 idle
frames), `eslint`, `prettier`, `tsc`.

**Sign-off:** ✅ 2026-11-27. Phase 4 complete. Next: Phase 5 (Editing experience & placement).

## 2.0 · Phase 5: Editing experience and placement (2026-11-27)

**Done**
- **5.1 Live floating & dockable Inspector (`app/src/inspector/Inspector.tsx`, `ContentTab.tsx`, `styleChips.ts`):**
  - Replaced both the 1.1 `WidgetSettings` slide-over and `Settings → WidgetCustomizer` with a single live
    Inspector, code-split via `React.lazy` (`dist/assets/Inspector-*.js` 33 KB + `.css` 11 KB) so it loads zero
    code outside Edit mode.
  - Positions beside the inspected widget without covering it (`computeInspectorPos`) and toggles between
    floating, docked left, and docked right.
  - Five tabs (**Look**, **Content**, **Data**, **Behavior**, **Advanced**): 8 one-click style chips (`Glass`,
    `Clear`, `Tinted`, `Solid`, `Gradient`, `Shaped`, `Bold`, `Minimal`), scope switcher (`This widget` /
    `All <Kind>` / `All widgets`), copy/paste style (`Ctrl+Shift+C`/`V`), wallpaper & widget color eyedropper,
    live glass contrast readout, Reset to theme, numeric position & size (px in Free mode, cells in Grid mode),
    live topic values & bindings, conditional style rule editor, pointer actions, schema-validated Style JSON
    editor, and copyable `[data-kind="…"]` CSS selector.
- **5.2 Edit mode upgrades (`app/src/layer/LayerApp.tsx`, `EditToolbar.tsx`, `useEditHistory.ts`, `clipboard.ts`):**
  - Multi-select (`Shift+click` and rubber-band marquee), contextual multi-select bar (Align left/center/right/top/middle/bottom,
    Distribute H/V, Group/Ungroup), **Tidy up**, Duplicate (`Ctrl+D`), Copy/Paste across monitors (`Ctrl+C`/`V` via
    `localStorage`), Lock/Unlock, **Theme** switcher alongside **Look**, and **Grid ⇄ Free** mode toggle.
  - Unified Edit-session Undo/Redo (`useEditHistory.ts` with RFC 7396 `settingsDiffPatch`) covering layout,
    style, content, theme, and desktop look edits together.
- **5.3 Free mode & z-order (`crates/opaline-core/src/layouts.rs`, `app/src/layer/free.ts`, `DragFeedback.tsx`):**
  - Per-monitor `mode: "grid" | "free"` and `cellSize` (`72 | 84 | 96 | 112` px), plus per-item work-area
    anchored `free` geometry (`top-left`..`bottom-right` + `center`), `z`, `locked`, and `groupId`.
  - Overlaps permitted in `Free` mode (strict non-overlap kept in `Grid` mode), smart alignment & spacing guides
    with snapping (`Alt` temporarily disables), pixel resizing, 1 px / 10 px keyboard nudging, and z-order
    actions (Bring to front / Send to back / Forward / Backward). 1.1 layouts load unchanged.
- **5.4 Extended sizes & Smart Stack rules (`crates/opaline-compose/src/model.rs`, `StackWidget.tsx`, `LayerStackEditor.tsx`):**
  - Added `"1x2"`, `"2x3"`, and `"6x4"` size classes across Rust schemas, `model.gen.ts`, and design-system
    tokens, plus custom expression-based Smart Stack promotion rules (`smartRules` evaluated via `Program.compile`).
- **5.5 Widget Gallery (`app/src/layer/WidgetGallery.tsx`):**
  - Replaced `WidgetPicker` with the 2.0 Widget Gallery: 2.0 categories (`All`, `System`, `Controls`,
    `Time & Personal`, `Media & Photos`, `Weather & Ambient`, `Developer & Online`, `Custom`, `Community`),
    source switcher (`Built-in` / `Your widgets` / `From themes & plugins`), live widget previews with size
    swipe arrows & size pills, and click or drag-to-place.
- **5.6 Settings consolidation & search (`app/src/settings/SettingsApp.tsx`, `LooksSection.tsx`, `settingsIndex.ts`):**
  - Removed obsolete `WidgetSettings.tsx`, `WidgetCustomizer.tsx`, and `WidgetPicker.tsx`.
  - Added sidebar live search with deep-link section jumps, new **Looks** (all 10 built-in looks with one-click
    apply & starter layout) and **Widget defaults** sections, Grid cell-size (`72/84/96/112 px`) selector in
    **Layout**, and live shortcut conflict detection in **Shortcuts**.
- **5.7 Onboarding 7-step flow (`app/src/onboarding/OnboardingApp.tsx`):**
  - Added Step 1 **"Pick a look"** over live desktop preview; Step 2 now defaults to the chosen look's starter
    layout; updated Finish step with Inspector & Widget Gallery pointers.
- **5.8 Tests (`free.test.ts`, `useEditHistory.test.ts`, `inspector.test.ts`, `e2e/edit-free.spec.ts`, `e2e/inspector.spec.ts`, updated `e2e/shell.spec.ts` & `e2e/lab.spec.ts`):**
  - Added unit and Playwright WebKit E2E coverage for Grid ⇄ Free, multi-select, align/distribute, Tidy up,
    Smart Stack rules, unified undo/redo, floating non-overlapping Inspector, style chips, Widget Gallery,
    Settings search & Looks, and 7-step Onboarding.

**Checks:** 214 Rust workspace tests, `clippy -D warnings`, `rustfmt`; 305 Vitest (1 skipped), 79 Playwright
WebKit e2e (all Classic 1.1 Lab baselines + all 10 looks + all Phase 5 specs passing), `eslint`, `prettier`,
`tsc`, `lint:helper`, production `vite build` confirming `Inspector` code-split chunk.

**Sign-off:** ✅ 2026-11-27. Phase 5 complete. Next: Phase 6 (Custom sources & Widget Builder).

## 2.0 · Phase 6: Custom sources and the builder (2026-11-27)

**Done**
- **6.1 Source format, runtime & diagnostics (`crates/opaline-core/src/sources/`, `spec/source.schema.json`, `spec/custom-widget.schema.json`):**
  - Versioned schemas for custom sources (`~/.config/opaline/sources/<id>.json`) and custom widgets
    (`~/.config/opaline/widgets/<id>.json`), live-watched via `watcher.rs` with self-write suppression.
  - Per-source runtime status (`ok`, `error`, `waiting`, `needs-approval`, `disabled`), last run time & duration,
    run count, rolling 20-entry log, **Run now**, `--safe-mode` suppression, and redacted per-source cost &
    health entries in `opaline --diagnose` and `Settings → Diagnostics`.
- **6.2 Command, File, D-Bus & Variables (`sources/runners.rs`, `sources/parsers.rs`):**
  - **Command**: direct `argv` execution (no shell unless `shell: true` opted in), cleared environment + explicit
    `envAllowlist`, strict timeout & byte caps, parsers for `text`, `lines`, `json`, `csv`, and linear-time
    `regex` captures.
  - **File**: Linux `inotify` watched via `rustix` (`text`, `json`, `csv`, `markdown` frontmatter/headings/tasks,
    and `todotxt`).
  - **D-Bus**: session bus properties, plus read-only system bus strictly behind `SYSTEM_BUS_ALLOWLIST`.
  - **Variables**: persisted (`~/.config/opaline/variables.json`) or in-memory `var.<name>` values settable via
    IPC/shell commands.
- **6.3 SSRF-hardened HTTP/JSON & RFC 9535 JSONPath (`http.rs`, `jsonpath.rs`):**
  - Extended `http.rs` (`fetch_custom`): HTTPS by default; plain `http://` only for loopback and private LAN
    after per-source `allowLocalHttp` opt-in; link-local, cloud-metadata (`169.254.169.254`, `100.100.100.200`,
    `fd00:ec2::254`, `fe80::/10`, IPv4-mapped IPv6), multicast & unspecified always blocked **after DNS
    resolution**; validated `SocketAddr` pinned for the connection with manual redirect re-validation (no
    DNS-rebinding bypass); `ETag`/`If-Modified-Since` caching; custom headers with `{{secret:name}}` resolution;
    built-in RFC 9535 JSONPath evaluator.
- **6.4 MQTT (`sources/mqtt.rs`):**
  - Lightweight async MQTT 3.1.1 subscriber over `tokio` + TLS 1.3 (`tokio-rustls` + `rustls-native-certs`),
    SSRF-validated broker host, keyring credentials, keepalive, reconnect backoff, and loopback broker test.
- **6.5 Secrets — Spike S11 (`secrets.rs`, [ADR 0019](adr/0019-secrets-and-custom-sources.md)):**
  - Direct GNOME Keyring (`org.freedesktop.secrets`) integration over workspace `zbus 6` (zero extra D-Bus
    versions). Secrets never appear in JSON, backups, logs, UI state, or `--diagnose`; verified with planted-secret
    tests in both Rust and Playwright.
- **6.6 Trust for imported sources (`sources/model.rs`, `sources/manager.rs`):**
  - Imported sources start in `needs-approval` and stay off until approved; approval dialog shows exact command
    line, file path, host/URL, D-Bus target, or MQTT broker; approval is keyed by `(id, packageVersion,
    SHA-256 trustFingerprint)` so any change re-prompts.
- **6.7 Code-split Visual Widget Builder (`app/src/builder/WidgetBuilder.tsx`, `builderModel.ts`, `customWidgets.ts`):**
  - Lazy-loaded studio (`WidgetBuilder-*.js` 22.2 kB + `.css` 5.4 kB; 0 KB outside Edit mode): per-size layout
    tabs, expandable block tree, 16-block palette, live `CompositionView` canvas, shared bindings & property
    editors with live evaluated previews and inline syntax/runtime errors, auto-generated accessible names,
    **Save & place** into Widget Gallery `"Your widgets"`, and **"Customize layout…"** in Inspector to fork any
    first-party widget.
- **6.8 Settings → Data sources & Accounts & integrations (`DataSourcesSection.tsx`, `AccountsSection.tsx`):**
  - Full CRUD for all 6 source types, Trust approval review card, **Run now** preview & logs, GNOME Keyring
    secret manager (masked input, values never echoed), and integration overview — all indexed in Settings search.

**Checks:** 233 Rust workspace tests (all 8 schema tests incl. `source.schema.json` & `custom-widget.schema.json`,
SSRF/DNS-pinning, JSONPath, Command/File/CSV/Markdown/todo.txt/Regex, MQTT loopback broker, Trust fingerprint
invalidation, planted-secret audit), `clippy -D warnings`, `rustfmt`; 308 Vitest (1 skipped), 83 Playwright WebKit
e2e (incl. `builder.spec.ts` + all 14 Settings sections + Gallery/Inspector), `eslint`, `prettier`, `tsc`,
`lint:helper`, production `vite build` confirming `WidgetBuilder` (22 KB) & `Inspector` (33 KB) code-split chunks.

**Note (6.9):** Real-machine live check against local Docker Desktop / n8n / Mosquitto is optional and awaits
owner availability; all core HTTP local-loopback, ETag, JSONPath, keyring, and MQTT broker paths are covered by
automated integration tests.

**Sign-off:** ✅ 2026-11-27. Phase 6 complete. Next: Phase 7 (New widgets: Quick controls, Notes, To-do, Timers,
Countdowns, World clock, Photo frame, Sun & moon, Quote, Aura, Decorations, GitHub, HA, MQTT, Feeds, n8n).

## 2.0 · Phase 7: New widgets (2026-11-27)

**Done**
- **7.1 Quick Controls (`providers/controls.rs`, `app/src/widgets/controls.tsx`):**
  - Implements every GNOME 50 Quick Settings interface verified in ADR 0016 (Spike S4): Wi-Fi (NetworkManager
    `WirelessEnabled`), Bluetooth (`Rfkill` + `org.bluez.Adapter1`), Airplane mode (`Rfkill`), Do Not Disturb /
    Night Light / Dark style (`gsettings`), Keep awake (`org.gnome.SessionManager.Inhibit`/`Uninhibit`),
    Output/Input volume & mute (`wpctl`), per-monitor Display brightness (`Mutter.DisplayConfig.SetBacklight`),
    Keyboard backlight (`gsd.Power.Keyboard`, hidden when unsupported), plus validated launchers (`gtk-launch` /
    `xdg-open` for `.desktop` apps, `http(s)` URLs, and existing paths).
  - Optimistic UI with automatic rollback on core command error, throttled sliders (≤ 150 ms), and ADR 0015
    `[data-interactive="true"]` input regions with `release-focus`.
- **7.2 Typing in widgets (ADR 0015) & 7.3 Personal & Time (`providers/{notes,todos,timers}.rs`, `widgets/{notes,todo,timers,countdown,worldClock}.tsx`):**
  - **Notes**: Markdown files in `~/.local/share/opaline/notes/`, interactive checkboxes toggled in place,
    inline Markdown editor with `Escape` → `release-focus`, and SHA-256 external-edit conflict detection.
  - **To-do**: `todo.txt` list (`~/.local/share/opaline/todos.txt`) with priorities, due dates, project chips,
    completion toggle, delete, and inline quick-add input.
  - **Timers & Pomodoro**: Core-owned state persisted in `~/.local/share/opaline/timers.json` surviving layer
    restarts; countdown timers, stopwatch with laps, Pomodoro work/break cycles & daily count; desktop
    notification + lightweight freedesktop event sound (`canberra-gtk-play`) on completion.
  - **Countdowns**: Event countdowns (`YYYY-MM-DD`) and Year/Month/Day live progress bars.
  - **World Clock**: Up to 6 IANA time zones with local time and day/night indicators.
- **7.4 Photos & Ambient (`providers/photos.rs`, `widgets/{photoFrame,sunMoon,quote,aura,decoration}.tsx`):**
  - **Photo Frame**: Core scans user photo folders, decodes & downscales thumbnails (≤ 640 px) into
    `~/.cache/opaline/photos/` served via `opaline-asset://photos/<name>` (full-res photos never reach the
    webview), extracts JPEG EXIF dates, flags `"On this day"`, supports fit/fill & favorites, 0 idle frames.
  - **Sun & Moon**: Pure offline solar/lunar astronomy (horizon sun path arc, sunrise/sunset, golden hour,
    moon phase & illumination %).
  - **Quote of the Day**: Curated public-domain daily rotation or custom source topic.
  - **Aura**: Data-driven ambient gradient reacting to time of day, weather condition, and wallpaper seed (0
    idle frames).
  - **Decoration**: Lightweight text banners, expressive Material shapes, and desktop separator lines.
- **7.5 Developer & Online (`providers/integrations.rs`, `widgets/devWidgets.tsx`):**
  - **GitHub** (opt-in summary with keyring PAT), **Home Assistant** (entity states + validated `ha-toggle-entity`
    command with keyring token), **MQTT Topic** (live `source.*` hero display), **Feeds** (pure-Rust RSS 2.0,
    Atom 1.0 & JSON Feed 1.1 parser strictly stripped to plain text — zero feed HTML in webviews), and **n8n
    Workflows** (workflow list + validated `n8n-set-workflow-active` with local loopback HTTP opt-in & keyring
    API key).
- **Widget Gallery & Registry (`registry.ts`, `WidgetGallery.tsx`):**
  - Registered all 16 new Phase 7 widgets (30 built-in widgets total) across their exact 2.0 categories
    (`Controls`, `Time & Personal`, `Media & Photos`, `Weather & Ambient`, `Developer & Online`).

**Checks:** 240 Rust workspace tests (incl. `controls`, `notes` conflict detection, `todos`, `timers` Pomodoro
cycle, `photos` downscale + EXIF, `integrations` RSS/Atom/JSON Feed HTML stripping), `clippy -D warnings`,
`rustfmt`; 311 Vitest (1 skipped), 85 Playwright WebKit e2e (incl. `p7-widgets.spec.ts`), `eslint`, `prettier`,
`tsc`, `lint:helper`, production `vite build`.

**Note (7.6):** Real-desktop checks against live Wi-Fi/Bluetooth/volume/brightness, notes/photos folders, and
local n8n/GitHub/HA can be exercised whenever the owner wants.

**Sign-off:** ✅ 2026-11-27. Phase 7 complete. Next: Phase 8 (Profiles, automation, CLI `opaline ctl`, D-Bus v2, helper v2).

## 2.0 · Phase 8: Profiles, automation, CLI `opaline ctl`, D-Bus v2, helper v2 (2026-11-27)

**Done**
- **8.1 Named Desktop Profiles (`crates/opaline-core/src/profiles.rs`):**
  - Persisted atomically in `~/.config/opaline/profiles.json` and published live on `"profiles.state"`.
  - Snapshots per-monitor layouts, theme, Desktop look, appearance state, performance mode, and per-profile
    `hiddenWidgets`. Switching profiles applies settings and layouts atomically so widgets spring-animate to their
    new places, emits `ProfileChanged` / `ThemeChanged` D-Bus signals, and engages manual override in automation.
- **8.2 Automation Rules Engine (`crates/opaline-core/src/automation.rs`):**
  - Compiled once and evaluated on `opaline-expr` against all live Hub topics plus synthesized `desktop.*`
    (`workspace`, `focusedApp`, `fullscreen`, `monitorCount`, `docked`, `locked`, `idle`, `dnd`) and `time.*`
    (`hour`, `minute`, `weekday`, `isNight`) context.
  - Enforces per-rule `minDurationS`, `hysteresisS`, and descending `priority` so rules never flap; tracks manual
    override with one-click/CLI `"Resume automation"`.
- **8.3 GNOME Shell Helper API v2 + N−1 Compatibility + Instant EWMH (`desktop-integration/`, `crates/opaline-core/src/desktop.rs`):**
  - Bumped `Shell1` `ApiVersion = 2`, `ApiRevision = 2`, adding `ActiveWorkspace`, `FocusedApp`, `Fullscreen`
    properties & `ActiveWorkspaceChanged`, `FocusedAppChanged`, `FullscreenChanged` signals, `SetRaisedMonitor`,
    and extended GSettings keybindings (`next-profile-shortcut`, `cycle-look-shortcut`, `peek-primary-shortcut`).
  - Core supports `ApiVersion` N (`2`) and N−1 (`1`) cleanly without breaking existing v1 helpers (one GNOME Shell
    re-login activates v2 signals); Instant mode polls `_NET_CURRENT_DESKTOP` via `xprop` only when rules are active.
  - Fixed Open Item #4: `desktop::ensure_enabled` now runs once after install via `~/.local/state/opaline/helper-auto-enabled`.
- **8.4 CLI `opaline ctl` & Completions (`crates/opaline-core/src/ctl.rs`, `app/src-tauri/src/ctl.rs`, `packaging/completions/`):**
  - Full `opaline ctl` over session D-Bus with `--json` output: `status`, `get`/`set`, `widgets list|add|remove|move|toggle`,
    `profile list|use|save|delete`, `theme`, `look`, `var set`, `action`, `peek [--monitor]`, `edit`, `export`/`import`,
    `automation status|resume`, and `completions <bash|zsh|fish>` (bundled into `.deb` via `tauri.conf.json`).
- **8.5 D-Bus API v2 (`crates/opaline-core/src/app_service.rs`, `docs/DBUS.md`):**
  - Extended `io.github.ali_kenjo.Opaline1` (`ApiVersion = 2`) with all validated v2 methods and live signals
    (`ProfileChanged`, `ThemeChanged`, `VariableChanged`, `WidgetAction`), keeping all v1 methods intact.
- **8.6 Extended Shortcuts & Settings → Profiles & automation (`app/src/settings/ProfilesSection.tsx`, `SettingsApp.tsx`, `shortcuts.rs`):**
  - Added **Profiles & automation** Settings section (profile snapshot/switch/delete, `opaline-expr` rule builder
    with condition presets, hysteresis/min-duration/priority controls, live context readout, manual override banner
    with **Resume automation**) and extended Native shortcuts in Settings → Shortcuts, all indexed in Settings search.

**Checks:** 249 Rust workspace tests (incl. `profiles`, `automation` hysteresis/min-duration/priority/manual-override,
`desktop` N & N−1 compat + `xprop` parser, `app_service` JSON path, `ctl` completions), `clippy -D warnings`, `rustfmt`,
`glib-compile-schemas --strict`, `lint:helper`; 311 Vitest, 87 Playwright WebKit e2e (incl. `p8-automation.spec.ts` +
all 15 Settings sections), `eslint`, `prettier`, `tsc`, production `vite build`.

**Sign-off:** ✅ 2026-11-27. Phase 8 complete. Next: Phase 9 (Plugins & gallery: ADR 0014 sandbox, hostile-plugin suite, gallery verifier, author tools `opaline pack` / `opaline validate`, `docs/SDK.md`).

## 2.0 · Phase 9: Plugins & the community gallery (2026-11-27)

**Done**
- **9.1 Production Sandbox, Manifest & Permission Trust (`crates/opaline-core/src/plugins.rs`, `app/src-tauri/src/layer/plugin_scheme.rs`, `windows.rs`):**
  - Implemented the production `opaline-plugin://<plugin-id>/` URI scheme (ADR 0014) in both debug and release builds
    (preserving debug `opaline-plugin://spike/` for Spike S5 re-verification), serving every response with
    `Content-Security-Policy: default-src 'none'; script-src 'self'; worker-src 'self' blob:; connect-src 'self'; frame-ancestors tauri://localhost`
    and `X-Content-Type-Options: nosniff`.
  - Added defense-in-depth main-frame navigation guard on layer windows (`is_allowed_layer_navigation`, ADR 0014 item 6).
  - Manifest validation (`plugin.json`), safe ZIP extraction (`zip_pkg`), strict action allowlisting, and SHA-256
    fingerprinting over `(id, pluginVersion, permissions, entry script)` so any permission or code change automatically
    revokes trust until re-approved; `--safe-mode` disables all code widgets.
- **9.2 Frontend Plugin Host, Watchdog & Hostile-Plugin Suite (`app/src/plugins/{pluginSandbox.ts,PluginWidget.tsx,hostile.test.ts}`):**
  - Enforces `<iframe sandbox="allow-scripts allow-same-origin">` (strictly excluding `allow-top-navigation`, popups,
    forms, modals), strict `event.source` + `opaline-plugin://<id>` origin check, declared-topic filtering, command
    allow-list enforcement, prototype-pollution & 256 KiB payload-cap sanitization, and a 2 s heartbeat watchdog with
    exponential backoff that terminates hung/busy-loop workers without affecting healthy siblings.
- **9.3 Community Gallery Client, Signature Verifier & Settings UI (`crates/opaline-core/src/gallery.rs`, `app/src/settings/GallerySection.tsx`, `docs/GALLERY_CONTRIBUTING.md`, `scripts/validate-gallery-pr.sh`):**
  - Reuses `updates::verify_minisign` (Ed25519 + BLAKE2b-512) + SHA-256 verification fail-closed on every gallery
    install; fetches `index.json` **only when explicitly clicked in Settings → Plugins & Gallery** (zero background
    network traffic, zero accounts, zero telemetry), plus **Install from package file**.
- **9.4 Author Tools & SDK (`app/src-tauri/src/main.rs`, `docs/SDK.md`, `examples/template-plugin/`):**
  - Added `opaline validate <dir>` and `opaline pack <dir> [-o out.opaline-plugin]` CLI commands, complete `docs/SDK.md`,
    and working reference `examples/template-plugin/` validated automatically in Rust unit tests.

**Checks:** 255 Rust workspace tests (incl. `plugins` pack/validate/trust-invalidation/template-plugin, `gallery`
Ed25519 minisign + SHA-256 acceptance & tamper rejection, `plugin_scheme` CSP/unapproved-block/path-traversal/nav-guard),
`clippy -D warnings`, `rustfmt`; 317 Vitest (incl. 6 hostile-plugin security tests in `hostile.test.ts`), 88 Playwright
WebKit e2e (incl. `p9-plugins.spec.ts` + all 16 Settings sections), `eslint`, `prettier`, `tsc`, `lint:helper`,
production `vite build`.

**Note (9.3):** Creating the public `ali-kenjo/opaline-gallery` repository and minting the gallery minisign key awaits
the owner; until configured, `GALLERY_MINISIGN_PUBKEY` fails closed by design.

**Sign-off:** ✅ 2026-11-27. Phase 9 complete. Next: Phase 10 (Quality & release: en/de/ar i18n parity, a11y, `docs/SECURITY.md` threat model & security tests, budgets, release readiness).

## 2.0 · Phase 10: Quality & release readiness (2026-11-27)

**Done**
- **i18n 2.0 (`app/src/i18n/{messages.ts,index.ts,i18n.test.ts}`, `Inspector.tsx`, `WidgetBuilder.tsx`):**
  - Expanded English (`en`), German (`de`), and Arabic (`ar`) catalogs with full key & ICU placeholder parity for
    every 2.0 Settings section, Gallery 2.0 category, all 16 new built-in widgets, Inspector, Widget Builder,
    Profiles/Automation, and Plugins/Gallery.
  - Added `resolvePackageString(locale, translations, key, fallback)` for package-bundled translations.
  - Wired explicit RTL `dir="rtl"` mirroring on both the Inspector and Widget Builder dialogs while preserving
    strictly LTR widget grid placement on `.surface`.
- **Accessibility & RTL E2E (`app/e2e/p10-quality.spec.ts`):**
  - Verified Arabic RTL mirroring on Settings, Inspector, and Widget Builder dialogs with LTR grid invariance,
    ARIA landmarks, and full keyboard accessibility across all 16 Settings sections.
- **Security Threat Model & Automated Security Suite (`docs/SECURITY.md`, `crates/opaline-core/tests/security.rs`):**
  - Updated `docs/SECURITY.md` with the complete Opaline 2.0 threat model across all 9 trust boundaries
    (layer webviews, ADR 0014 code plugins, imported packages, custom sources, GNOME Keyring, feeds, quick controls,
    IPC/D-Bus v2, and signed updates/gallery).
  - Added integrated security test suite `crates/opaline-core/tests/security.rs` verifying remote-CSS rejection,
    command-injection resistance (`shell: false`), SSRF blocking (link-local, cloud metadata, CGNAT, IPv6 metadata),
    zip-slip & oversized archive rejection, planted-secret redaction, and D-Bus v2 path validation.
- **Release Docs (`README.md`, `docs/RELEASE.md`):**
  - Updated `README.md` and `docs/RELEASE.md` for Opaline 2.0 (30 built-in widgets, 10 themes/looks, Glass 2.0,
    Inspector, Free mode, Visual Builder, Custom sources, Profiles & Automation, `opaline ctl` + shell completions,
    D-Bus v2, Sandboxed plugins & Gallery, 1.1 → 2.0 migration checklist, and minisign key setup).

**Checks:** 261 Rust workspace tests (incl. 6 new integrated security tests in `tests/security.rs`, 2 migration tests
on real 1.1 fixtures, 8 schema tests, 206 core tests, 9 binary tests), `clippy -D warnings`, `rustfmt`,
`glib-compile-schemas --strict`, `lint:helper`; 318 Vitest (1 skipped), **90/90 Playwright WebKit E2E** (incl.
`p10-quality.spec.ts` and all classic 1.1 Lab baselines), `eslint`, `prettier`, `tsc`, production `vite build`.

**Owner release gates (remaining before tagging `v2.0.0`):**
1. Mint minisign release key (`RELEASE_MINISIGN_PUBKEY` + GitHub Actions secrets) and gallery key (`ali-kenjo/opaline-gallery`).
2. Bump versions to `2.0.0`, test `.deb` 1.1 → 2.0 upgrade & clean Ubuntu 26.04 VM checklist (`docs/RELEASE.md`), and tag `v2.0.0`.

**Sign-off:** ✅ 2026-11-27. Phase 10 complete; all 2.0 phases signed off. Next: owner-gated release steps (`docs/RELEASE.md`): minisign keys, version bump to 2.0.0, `.deb`, VM test, tag `v2.0.0`.

## Fixes after v2.0.1 (2026-11-27)

The Clock froze after a tick or two (its view computed the next wake before its children had read the clock), and
timers, stopwatch and Pomodoro lost time over suspend and core restarts (fixed 1 s steps on the monotonic clock).
Both now follow the system clock; an audit of every timer found and fixed the same class of bug in the plugin
watchdog (restarted plugins after a covered window), weather, custom sources and the update check (stale after
suspend), plus the renderer's English number formatting and the memory pill's dangling "/". Details, evidence and
the not-a-bug list: `docs/HANDOFF.md` §4c. Gate: 279 Rust tests, 331 Vitest, 101/101 Playwright, clippy/fmt/lint.

**Released as v2.0.2** (2026-11-27): commit `c6b4b77` (`release: v2.0.2`, CI green), tag `v2.0.2`, signed by the
release workflow. Installed on the owner's laptop over 2.0.1 (`apt install`, Native mode, theme Air, 5 widgets).

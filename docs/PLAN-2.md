# Opaline 2.0 plan

Status: **draft, waiting for your approval** (2026-11-25). The brief is `OPALINE_2_BRIEF.md`; the design outline is
`docs/DESIGN-2.md`. Each phase ends with its acceptance checks, a `docs/PROGRESS.md` entry ("2.0 · Phase N"), small
conventional commits, an updated `docs/HANDOFF.md`, and your sign-off. Tasks marked 🧑 need you; I give exact steps
when we get there.

## 1. Decisions to confirm before Phase 0

1. **Phase order: the theme engine moves before the widget redesign.** The brief's P3 builds nine themes "on the
   theme engine (§5.2)", but that engine is in P4. I propose swapping them: **P3 = style model 2.0, themes and
   files**, **P4 = redesign the 14 widgets and build the nine looks**. Everything else keeps the brief's order. P0
   still comes first and the composition engine (P2) still comes before any widget redesign.
2. **Both expression implementations in P2.** The TypeScript evaluator (widgets) and the Rust evaluator (automation,
   conditional rules in core) are built together against one conformance suite, so the grammar can't drift. Rust
   only needs it from P6 on, but building it later is how two dialects happen.
3. **Size classes.** Today: 1×1, 2×1, 4×1, S (2×2), M (4×2), L (4×4), XL (8×4). I propose adding **2×4 "Tall"** and
   **6×4 "Wide"** as grid classes, plus **1×2** for quick controls only (a vertical slider or toggle). Widgets opt in
   per size. Free mode covers every size in between through composition breakpoints, so no widget needs a hand layout
   for every pixel size. Cell sizes: **72, 84 (default, as today), 96, 112 px**; the gap stays 12 px.
4. **Fonts to bundle** (all OFL, loaded only while a theme uses them): JetBrains Mono (Terminal), Fraunces (Paper;
   variable, with optical size), Space Grotesk (Neon). Roboto Flex, Inter and Noto Sans Arabic stay. None of the new
   ones are installed on this machine, so they come from `@fontsource` like today. Licenses get checked file by file
   in P4 and listed in `THIRD_PARTY.md`.
5. **Baseline strategy for the theme matrix.** 9 themes × 14+ widgets × ~6 sizes × states is thousands of
   screenshots. Full baselines for **Opaline** and **Classic**; for the other seven, one sheet per theme per wallpaper
   (every widget at its default size plus its smallest size). The zero-truncation and contrast checks run on **every**
   combination, without stored screenshots.
6. **Memory.** 2.0 adds fonts, blur levels, the inspector, workers, photos. The budget (280 MB PSS, default layout)
   is already missed by 146 MB. P0 fixes what it can; if it can't get under 280 MB, I bring you numbers and options
   and you decide before P1. Every later feature states its cost, and each phase records the budget.

## 2. Brief corrections found while planning (checked on this machine)

These change what the brief assumes. Each gets an ADR when its phase starts.

| Brief says | Found here (2026-11-25) | Proposal |
| - | - | - |
| Brightness: "Mutter or gsd-power; find out" | **Mutter** `org.gnome.Mutter.DisplayConfig`: property `Backlight` (per connector, min/max/value; covers `eDP-1` **and** `HDMI-2` over DDC/CI) and methods `SetBacklight`/`ChangeBacklight`. Keyboard backlight is still `org.gnome.SettingsDaemon.Power.Keyboard.Brightness` | Use those. Spike: whether Mutter accepts `SetBacklight` from a non-Shell client; if not, go through the helper in Native mode and hide the slider in Instant mode |
| Battery charge limit "if UPower exposes it here" | UPower 1.91.1 exposes `ChargeThreshold*` and `EnableChargeThreshold`, but `ChargeThresholdSupported = false` on this laptop | Show the status only where it's supported; on this laptop the row stays hidden. Tested with a fixture |
| Volume through "PipeWire/pipewire-pulse" | `pactl` isn't installed; `wpctl` is. GNOME Shell talks the PulseAudio protocol (libgvc) to pipewire-pulse | Spike: the `pipewire` crate we already link (default sink node `Props`, metadata `default.audio.sink`) vs. `libpulse-binding` (one more C library). Prefer no new C library |
| Bluetooth through Rfkill | `org.gnome.SettingsDaemon.Rfkill` has `BluetoothAirplaneMode` (rw), `AirplaneMode` (rw) and the hardware flags. That's what Shell's toggles use | As the brief says |
| Do Not Disturb, Night Light, Dark style keys | All three GSettings keys exist and read correctly | As the brief says |
| Keep awake via `org.gnome.SessionManager` | `Inhibit` and `IsInhibited` present | As the brief says; the inhibitor lives in core, so it ends when core quits |
| Secrets via `oo7` | Secret Service (`org.freedesktop.secrets`) is running; `oo7` 0.7.3 is current | Use `oo7` (pure Rust, zbus-based like core). Verify it works with zbus 6 in the P6 spike |
| Photo formats "AVIF, HEIC, JPEG XL (verify)" | JPEG XL: `jxl-oxide` is already in core. AVIF in `image` 0.25 needs the C library dav1d. HEIC isn't supported by `image` at all (needs libheif) | Ship JPEG, PNG, WebP, GIF, TIFF, BMP, JXL. AVIF only if dav1d's cost is acceptable (spike). HEIC: skip, shown as "unsupported format" |
| `opaline --safe-mode` "and a key held at startup" | On Wayland a background process can't read the keyboard state without focus | Safe mode through the flag, a `.desktop` action ("Start in safe mode") and automatically after two crashes in a row. Check in P3 whether the helper can read modifiers at start in Native mode |
| Expressions conformance in "both implementations" | (no conflict) | One JSON test corpus in `spec/expressions/`, run by Vitest and `cargo test` |
| Fuzz the parser | `cargo fuzz` needs nightly; the workspace is stable | `proptest` (Rust) and `fast-check` (TS, dev only) property tests on stable, plus a nightly CI job with `cargo fuzz` if you want it |

## 3. Phases

### P0: Stabilize (§11)

Goal: memory back under budget (or your decision), UI tests in place, `LayerApp.tsx` split. No visible change.

| # | Task |
| - | - |
| 0.1 | **Memory trend script**: extend `scripts/measure-budget.sh` with `--trend` (samples PSS per process every N minutes into a CSV) and a per-mapping breakdown from `smaps` (anon heap, libraries, `/dev/dri` and dmabuf mappings, JS heap reported by the layer). Add `scripts/memory-longrun.sh` (fresh start → Edit → Peek → detail views → 1 h → 8 h) |
| 0.2 | **Measure**: fresh start, after Edit, after 1 h, after 8 h, with the default layout on both monitors (the 8 h run overnight). Separate core (70 MB, grew from 29 MB in P1) from the web process (248 MB) |
| 0.3 | **Find and fix growth.** Suspects in order: full-work-area `dpr=2` EGL buffers kept after the Edit/Peek backdrop (try destroying and recreating the GL canvas and resizing the window surfaces back to widget bounds); GL textures and canvases not released (visualizers, wallpaper variants); state kept across Edit sessions (undo stacks, picker previews); history rings and caches in core; whatever core keeps after the Settings window closes |
| 0.4 | **Levers if growth fixes aren't enough** (from ADR 0009): layer windows sized to widget bounds outside Edit/Peek (≈ −29 MB measured in P0), JIT tiers off (−6 to −10 MB, costs CPU), dropping the network process if Tauri allows it. Each measured three times, kept only if it pays. **Decision gate 🧑** if we stay above 280 MB |
| 0.5 | **Stub host for UI tests**: the layer page with an in-page fake core (deterministic topics, settings and layouts, records commands), reusing `labHost`/`labMocks`. Also stubs for the Settings and Onboarding pages |
| 0.6 | **Playwright UI tests** (WebKit): Edit mode (enter, add from picker, drag, resize, stack, unstack, remove + undo snackbar, undo/redo keys, keyboard model, Esc), picker (search, categories, availability reasons, click and drag to place), detail views (open, history, actions, close), Settings (every section renders, a change round-trips through the stub), Onboarding (all steps, starter layout applied) |
| 0.7 | **Split `LayerApp.tsx`** behind those tests: drag/resize controller, selection model, toolbar, grid items, overlays (backdrop, remove zone, snackbar, menus). Same behavior, tests unchanged |
| 0.8 | **Small fixes**: `PROGRESS.md` grid numbers (84 px / 12 px); `fans` provider: find the 405 ms read and fix it or label it `expensive`; Instant-mode layer restart with exponential backoff (1 s → 5 min, reset after 60 s healthy); updater: a test that a release without a valid `.minisig` is refused, and the release workflow fails instead of publishing unsigned |
| 0.9 | PROGRESS, HANDOFF, commits; your sign-off |

Acceptance: ≤ 280 MB PSS with the default layout after Edit and after 1 h (or your decision on new numbers); UI tests
green; `LayerApp.tsx` split with all tests unchanged.

### P1: Design language and glass 2.0 (§3)

| # | Task |
| - | - |
| 1.1 | **Three visual directions** for the Opaline theme, each on Clock, CPU, Weather and Now Playing at S and M, over a light and a dark wallpaper, in the Lab (mock data). 🧑 You pick one (or mix) |
| 1.2 | **Spike S1** (transparency and blur pyramid), see §4; ADR 0012 |
| 1.3 | **Spike S2** (WebKitGTK features), see §4; ADR 0013 |
| 1.4 | `docs/DESIGN-2.md` filled in: type scale, anatomy, responsive rules, color identity per kind, shape meanings, glass parameters, motion personalities |
| 1.5 | **Responsive rules in today's framework**: every field gets an explicit `shortLabel` (en/de/ar), elements get priorities, and the layout degrades icon → short label → no label (tooltip + accessible name keep it) → drop lowest priority → denser variant. Hero text auto-fits by size and `wdth`. This fixes the truncations of §2 before P2 and carries over into compositions |
| 1.6 | **Glass 2.0 in the compositor**: blur pyramid (per S1), blur 0–100 with 0 = sharp, tint 0–100 independent of blur, tint color and gradient tints, refraction strength and band width, edge dispersion, specular angle/intensity/width, rim width/color/gradient, inner glow, depth (shadow color, blur, offset, spread), grain. Still one pass, one draw call |
| 1.7 | **Legibility 2.0**: finer luminance data from core (per-widget region statistics instead of the 8×8 grid), text color from the local backdrop, halo/shadow, optional vibrancy text; tint raised only as the last step and only with "Keep text readable" on; each widget's measured contrast exposed for the inspector |
| 1.8 | **Desktop look modes**: Glass · Clear · Tinted · Dark · Light · Dimmed, plus a master transparency slider; on the Edit toolbar and in Settings → Appearance |
| 1.9 | **Lab 2.0**: theme switcher (Opaline and Classic for now), light and dark wallpapers, a widget × size × state matrix; automatic **zero-truncation** check (any element whose text is clipped or ellipsized fails, except user data marked as such) and **contrast** check from the screenshot (text pixels vs. backdrop pixels per role) |
| 1.10 | **Classic** frozen as a style preset that reproduces the 1.1 baselines pixel for pixel |
| 1.11 | ScreenCast captures on both monitors; 🧑 we tune the default transparency together |

Acceptance: zero-truncation and contrast checks pass; at blur 0 and tint 0 the wallpaper shows through sharp, and
text stays readable or the contrast warning appears; your visual sign-off.

### P2: Composition engine (§4.1–4.3)

| # | Task |
| - | - |
| 2.1 | **Composition model**: containers (stack, row, column, grid, overlay, spacer), blocks, roles, bindings, priority, visibility, accessible name, per-size layouts and breakpoints, stable block ids. Rust types (serde + schemars) are the source; JSON Schema and TypeScript types are generated from them |
| 2.2 | **Expression language**: `docs/EXPRESSIONS.md` (grammar, types, functions); a hand-written Pratt parser with a type checker and evaluator in TypeScript and in Rust (new crate `opaline-expr`); the shared conformance corpus; property tests on both sides. No `eval`, no `new Function` (a lint rule checks it) |
| 2.3 | **Functions**: arithmetic, comparison, `if`, `clamp`, `map`, rounding, strings; Intl formatting of numbers, dates, durations, bytes and units; `ramp`; colors (`mix`, `alpha`, `lighten`); history over core's rings (`avg`, `min`, `max`, `delta` with a window); time (`now`, `format`, `until`, `sunrise`) |
| 2.4 | **Evaluation cost (S10)**: compile once; each expression knows its inputs; re-evaluate only when one changes; `now` schedules itself at the coarsest granularity the template needs (a `HH:mm` clock wakes once a minute). Counters in the Lab prove it |
| 2.5 | **Renderer**: one React component per block, layout through container queries (per S2) or measured breakpoints, data attributes (`data-kind`, `data-size`, `data-role`, `data-block`, `data-state`, `data-theme`), roles styled by the active theme, layout morphs between sizes by block id through the motion scheduler |
| 2.6 | **Blocks**: Text, Number (odometer/fade), Icon, Image, Shape (morphing), Ring/Gauge, Bar, Chart (extends the in-house Sparkline), Heatmap, List, Progress (linear and wavy), Divider, Canvas (registry of built-in visuals), Button/Toggle/Slider/Text input (send commands that core validates), Plugin (placeholder until P9) |
| 2.7 | **Bindings to topics**: subscriptions follow the topics an expression reads, through the existing `layerHost` path (subscribed only while visible) |
| 2.8 | **Clock rebuilt on the engine** with today's features; `StatLayout` stays only for Classic |
| 2.9 | **Spike S5** (plugin sandbox) early, because the composition format must work across a worker boundary; ADR 0014 |

Acceptance: evaluator (unit, conformance, property) and renderer tests pass; the Clock runs on the engine with no
regression in behavior or budgets.

### P3: Style model 2.0, themes and files (§5) — brief's P4, moved up

| # | Task |
| - | - |
| 3.1 | **Mechanical parity (S7)**: the style types live once in Rust; `schemars` produces the JSON Schema; a small generator writes `style/types.ts` and the key list for `fields.ts`; a test fails if they differ from the committed files. The three places in `CLAUDE.md` become one |
| 3.2 | **Cascade**: built-in tokens → theme → global → widget kind → instance → element (role or block id), with origins and resets |
| 3.3 | **New controls** (§5.1): surface (squircle corners with smoothing, per-corner radii, any library shape, glass/tinted/clear/solid/gradients with 2–4 stops/local image/album art, border with gradient and glow, shadow incl. inner, opacity), typography per role (family, weight, width, size, tracking, case, line height, color, opacity, OpenType features), icons (Rounded/Outlined/Sharp subsets, fill, weight, grade, size, color), hero visuals and their options, layout, effects, behavior actions, auto-hide with reflow, **conditional styles** (ordered "when ⟨expression⟩ → set keys" rules, animated) |
| 3.4 | **Theme packages**: `theme.json` schema, tokens, style layers, layouts per kind, fonts with license files, images, `theme.css`; folders and `.opaline-theme` zips (zip-slip and size limits); the three locations, watched; key-by-key fallback with a non-blocking error naming file and JSON path; animated switching (palette and shape springs, type crossfade) |
| 3.5 | **Config as files (S9)**: watch `settings.json`, `layouts.json`, themes, widgets, sources, profiles (inotify through `notify`); apply outside edits live; ignore Opaline's own writes by content hash; validate, toast problems, keep the last good state; generated JSON Schemas installed to `/usr/share/opaline/schemas/` and `$schema` written into every file; `docs/CONFIG.md` |
| 3.6 | **User CSS**: `~/.config/opaline/user.css` and each `theme.css`, read by core and injected after the design system, live; remote `url()` and `@import` rejected by core and blocked by the CSP anyway; `docs/THEMING.md` (data attributes, custom properties, why CSS can't style the WebGL glass); `--safe-mode` (see §2) |
| 3.7 | **"Save this look"** (theme export, secrets stripped) and **rices** (theme + layout + custom widgets + sources + profiles, positions as work-area anchors) |
| 3.8 | **Migrations**: every 1.1 file (settings, layouts, styles, named styles) migrates automatically; tests use your real 1.1 files, redacted, as fixtures |
| 3.9 | Opaline and Classic as the first two theme packages |

Acceptance: editing a theme in VS Code updates the desktop live, with autocomplete; a broken file never blanks the
desktop; 1.1 fixtures migrate with nothing lost.

### P4: Redesign the 14 widgets and the nine looks (§3.1, §8.1) — brief's P3

Each widget gets compositions for every supported size, a detail view built as a composition, its §8.1 content
additions and the new style controls. Reviewed in rounds of three or four widgets (🧑 sign-off per round).

| # | Widget | Core work this needs |
| - | - | - |
| 4.1 | **Clock**: all faces of §8.1 (Digital, Expressive, Analog ×6, Flip, Word, Typographic, Segment, Binary, Terminal, Day ring, Big date), per-element colors, second hand modes, ICU skeleton date, second zone, subline | none |
| 4.2 | **CPU**: hero choice, per-core grid, temperature source, frequency mode, top processes with icons, power, throttling badge | app icon lookup (process → `.desktop` → icon file, served through the asset protocol) |
| 4.3 | **Memory**: liquid fill with pressure, stacked composition bar incl. zram/zswap, top apps, GB/GiB | zram/zswap stats |
| 4.4 | **GPU**: iGPU + dGPU side by side, engines, VRAM bar, power vs. limit, clocks, fan, top apps, asleep state | engine busyness (i915/xe fdinfo, NVML) without waking a sleeping dGPU |
| 4.5 | **Storage**: several drives, health badge, temperatures, I/O chart, include/exclude, sorting, eject/power off | per-drive I/O rates |
| 4.6 | **Network**: dual-wave hero, daily/monthly usage vs. cap, Wi-Fi signal shape, VPN badge, latency + jitter, per interface, privacy toggles | jitter, VPN state from NetworkManager |
| 4.7 | **Battery & Power**: liquid pill with bubbles, time to full/empty, health, charge limit (where supported), peripherals with icons, power-profile switch | peripherals list from UPower |
| 4.8 | **Fans**: spinning glyph by RPM (static when reduced motion or dimmed), per-fan gauges, related temperatures | none |
| 4.9 | **Processes**: real app icons (fixes ⠿), CPU/RAM/GPU/disk I/O columns, group by app, filters, End task with confirmation | per-process GPU (fdinfo) and I/O; app grouping from systemd `app-*.scope` cgroups (verify) |
| 4.10 | **Now Playing**: album-art glass background, breathing shape masks, vinyl and cassette looks, shuffle/repeat/volume, player switcher, local `.lrc` lyrics, wavy progress | MPRIS shuffle/loop/volume; `.lrc` read next to `file://` tracks |
| 4.11 | **Visualizer**: WebGL styles, circular spectrum, spectrogram, VU needles, LED segments, particles, oscilloscope, stereo split; ≤ 3 % CPU at 60 fps | new IPC frame kinds for waveform and per-channel frames (designed here) |
| 4.12 | **Weather**: condition/time-of-day skies, hourly curve with precipitation, 10-day ranges, AQI/UV/pollen, sun arc, moon phase, tiles, several locations; warnings only if the S-weather check finds a free, keyless, licensed source | Open-Meteo air quality; moon and sun math offline |
| 4.13 | **Calendar**: date tile, month grid with dots, agenda with color bars, countdown, Join button (Meet/Zoom/Teams/Jitsi), tasks, week view | EDS task lists (VTODO) through `Calendar8` |
| 4.14 | **Docker**: Compose groups with health, published ports (open in browser), log tail in the detail view, resource charts, Podman parity | logs tail and stats while the detail view is open; Compose labels |
| 4.15 | **The nine looks** (§3.1): Opaline, Crystal, Bloom, Air, Terminal, Neon, Paper, Mono, Classic, each with tokens, type, shapes, surface, motion, hero visuals, clock faces and its own starter layouts (replacing the five presets). Fonts lazy-loaded |
| 4.16 | Lab baselines per theme (per decision 5); zero-truncation and contrast everywhere |

Acceptance: your sign-off per widget and per theme; Classic matches the 1.1 baselines.

### P5: Editing experience and placement (§6–§7)

| # | Task |
| - | - |
| 5.1 | **Inspector**: floating glass panel that never covers the widget, dockable; tabs Look / Content / Data / Behavior / Advanced; live preview with springs; scope (this widget, this kind, all, the theme → forks a user theme); copy/paste style; eyedropper (wallpaper or another widget); contrast meter; "Reset to theme"; loaded only in Edit mode (code-split chunk) |
| 5.2 | **Undo/redo for everything** (style, content, layout) in one history per Edit session |
| 5.3 | **Edit mode upgrades**: multi-select (Shift/Ctrl-click, rubber band), group move/align/distribute, duplicate, copy/paste across monitors, lock, z-order, numeric position/size, arrow nudge, "Tidy up", look modes and theme switcher on the toolbar, editable Smart Stack rules |
| 5.4 | **Free mode**: anchors + offsets relative to the work area, alignment guides, snapping (Alt disables), overlap with z-order, lock, groups; Grid ⇄ Free switching; input regions and glass follow shape bounds; top-most hit-testing; stacks in both modes; grid cell-size option and the new size classes |
| 5.5 | **Widget Gallery** replacing the picker: live previews at every size, swipe/size row, search, categories, "Your widgets", "From themes and plugins", availability reasons, click or drag to place |
| 5.6 | **Settings**: search across every setting with deep links; new sections Looks, Widget defaults, Keyboard shortcuts (with conflict detection), Backup (incl. themes, widgets, sources; secrets excluded). Data sources, Accounts, Profiles and Plugins sections arrive with their phases (P6–P9) and plug into the same search. Widget-level controls leave Settings; `WidgetCustomizer.tsx` and `WidgetSettings.tsx` are removed |
| 5.7 | **Onboarding**: "Pick a look" with live previews over the real wallpaper, pointers to the inspector and gallery; seven steps at most |
| 5.8 | Playwright tests for the inspector, gallery and free mode; keyboard-only and touchpad checks |

Acceptance: everything works with mouse, touchpad and keyboard; style changes undo and redo; your sign-off.

### P6: Custom sources and the builder (§4.4–4.5, §6.1 Data)

| # | Task |
| - | - |
| 6.1 | Source file format and schema; status (ok / error / waiting / needs approval), last run, Run now, log; per-source cost in `--diagnose` and Diagnostics |
| 6.2 | **Command** (argv; shell only by explicit choice; interval, timeout, output limit, environment allowlist; text/lines/JSON/CSV/regex), **File** (inotify; text, JSON, CSV, Markdown, todo.txt), **D-Bus** (session property/signal; system bus read-only behind an allowlist), **Variables** |
| 6.3 | **HTTP/JSON**: extend `http.rs` deliberately: HTTPS by default; `http://` only for loopback and private LAN after a per-source opt-in; link-local and cloud-metadata addresses always blocked, checked **after DNS resolution** and pinned for the connection (no DNS-rebinding bypass); JSONPath (RFC 9535 crate, to verify); ETag/If-Modified-Since; headers |
| 6.4 | **MQTT** (`rumqttc` 0.25, TLS, keyring credentials) |
| 6.5 | **Secrets (S11)** in the GNOME keyring through `oo7`; never in JSON, exports, logs or `--diagnose`; a test greps every output path for a planted secret |
| 6.6 | **Trust**: imported sources off until approved; the dialog shows exact commands, paths, hosts, D-Bus names; approval remembered per package version and asked again on any change |
| 6.7 | **Builder**: block tree, canvas, block palette, properties, binding editor with live values and inline errors, per-size layouts, accessible names; "Customize layout…" forks any first-party widget |
| 6.8 | Settings → Data sources; Settings → Accounts & integrations shell |
| 6.9 | 🧑 Acceptance data: start Docker Desktop and your n8n container, create an n8n API key; I run Mosquitto in Docker for MQTT |

Acceptance: a widget built from a shell command, a file, your local n8n, a D-Bus property and an MQTT topic; imported
sources stay off until approved.

### P7: New widgets (§8.2–§8.6)

| # | Task |
| - | - |
| 7.1 | **Quick controls** (per spike S4): toggles (Wi-Fi, Bluetooth, Airplane, DND, Night Light, Dark style, Keep awake, mic mute, power profile, VPN, any boolean GSettings key), sliders (output/input volume with device switch, display brightness, keyboard backlight), launchers (apps with real icons, folders, files, URLs, commands); optimistic UI with rollback; core validates every write |
| 7.2 | **Typing in widgets (S3)** per ADR 0015: inline editing if the layer can take focus without rising, otherwise in the raised detail view |
| 7.3 | **Notes** (Markdown files, inline editing, checkboxes written back, safe writes on outside changes), **To-do** (Markdown, todo.txt, EDS task lists), **Timers** (state in core, notification and a light bundled sound, per spike), **Countdowns**, **World clock** |
| 7.4 | **Photo frame** (core decodes and downscales to device pixels, thumbnail cache in `~/.cache/opaline/`, EXIF dates and captions, transitions, shape masks), **Sun & moon**, **Quote/word of the day** (bundled public-domain set or your file/feed), **Aura**, **Decorations** |
| 7.5 | **GitHub** (fine-grained PAT; OAuth device flow if you register an app 🧑; rate limits, conditional requests), **Home Assistant** (REST + WebSocket, long-lived token; writes through core), **MQTT** widgets, **Feeds** (RSS/Atom/JSON Feed, text only, site icons fetched by core), **n8n** (workflows, executions, activate, webhook triggers) |
| 7.6 | 🧑 Real-data checks: Wi-Fi/Bluetooth, volume, brightness, a notes folder, EDS tasks, a photo folder, your GitHub token, n8n, a feed; Home Assistant and MQTT in Docker if you have none |

### P8: Profiles, automation, CLI, D-Bus v2, helper v2 (§10)

| # | Task |
| - | - |
| 8.1 | Profiles (layout per monitor, theme, look, appearance, performance, visibility) with animated switching |
| 8.2 | Rules engine in core on `opaline-expr`: all conditions of §10, hysteresis, minimum durations, manual override + "Resume automation" |
| 8.3 | **Helper API v2**: `ActiveWorkspaceChanged`, `FocusedAppChanged`; core keeps N−1 (v1) working. 🧑 one re-login. Instant mode: `_NET_CURRENT_DESKTOP` through Xwayland (verify) |
| 8.4 | **`opaline ctl`** over D-Bus with `--json`; bash/zsh/fish completions in the `.deb` |
| 8.5 | **D-Bus API v2** on `io.github.ali_kenjo.Opaline1` (same operations + `ProfileChanged`, `ThemeChanged`, `VariableChanged`, `WidgetAction`), versioned, validated, `docs/DBUS.md` |
| 8.6 | Shortcuts for profiles, looks, Peek per monitor, "toggle widget X"; Settings → Profiles & automation |

Acceptance: rules switch profiles without flapping; `opaline ctl` covers everything; per-workspace layouts work after
a re-login.

### P9: Plugins and the gallery (§9)

| # | Task |
| - | - |
| 9.1 | Sandbox as decided in ADR 0014 (S5); manifest and permissions; approval on install and on every change |
| 9.2 | **Hostile-plugin suite**: no `__TAURI_INTERNALS__`/IPC, network, other widgets, storage or navigation; busy loop and memory blow-up detected and stopped without affecting other widgets |
| 9.3 | Gallery: 🧑 create `ali-kenjo/opaline-gallery` and a gallery minisign key; `index.json` + packages with SHA-256 and signature (reusing the updater's verifier); fetch only while the gallery is open; install/update/remove; install from file; contribution guide and a CI check in the gallery repo |
| 9.4 | Author tools: `opaline pack`, `opaline validate`, builder developer mode with hot reload, `docs/SDK.md` + template plugin |

### P10: Quality and release

i18n (every new string in en/de/ar, package translations, RTL inspector/builder), accessibility (keyboard,
screen-reader labels, generated accessible names, contrast meter), all budgets recorded, `docs/SECURITY.md` threat
model and the security tests (§12), 1.1 → 2.0 migration on this laptop and on a clean VM 🧑, README media,
`v2.0.0` signed release 🧑.

## 4. Spikes (§15)

| Spike | When | Question | How | Output |
| - | - | - | - | - |
| **S1 Transparency + blur pyramid** | P1 | True alpha vs. full-resolution sampling at blur 0; memory of the pyramid | Both prototypes on `eDP-1` at `dpr=2` and `HDMI-2`; PSS and GPU memory, frame time, look over DING icons; pyramid built in core (CPU, cached WebP levels) vs. on the GPU (dual Kawase into mip-like levels) | ADR 0012 |
| **S2 WebKitGTK features** | P1 | Container queries, variable-font axes on system fonts, OffscreenCanvas in workers, CSP in workers | Test page loaded inside the real layer windows (`OPALINE_LAYER_PAGE`), results reported to the layer log like `lab-glass` | ADR 0013 |
| **S3 Keyboard focus** | P2 | Can the layer take focus on click without rising above normal windows, and give it back on Esc/click elsewhere, in Native and Instant mode? | Helper experiment (`Meta.Window.focus` without `raise`, stacking guard) and Xwayland `_NET_ACTIVE_WINDOW` with keep-below | ADR 0015 |
| **S4 GNOME 50 Quick Settings APIs** | P2 | Brightness (`DisplayConfig.SetBacklight` from a normal client), volume path, Bluetooth, VPN, DND | Small Rust test binary calling each interface; compare with Shell's own code | ADR 0016 |
| **S5 Plugin sandbox** | P2 | Worker vs. opaque-origin iframe; does `connect-src 'none'` apply to workers; can a worker reach Tauri IPC; watchdog design | Hostile test plugin in both designs inside the real layer | ADR 0014 |
| **S6 Memory per feature** | every phase | Cost of blur levels, photo frame, fonts, workers, inspector chunk | `measure-budget.sh` before/after, recorded in PROGRESS | budget table |
| **S7 Style-key parity** | P3 start | Generate TS from Rust or test both | schemars → JSON Schema → generator; CI diff check | ADR 0017 |
| **S8 Helper API v2** | P8 | New signals, N−1 compatibility | v1 core against v2 helper and the reverse | in ADR 0006/0018 |
| **S9 Live-reload loops** | P3 | Own writes echoed by inotify | content-hash ledger; test that a self-write produces no reload | in P3 tests |
| **S10 Expression cost** | P2 | Evaluations per second with the default layout | counters in the Lab, budget: zero evaluations while idle | in P2 tests |
| **S11 Secrets** | P6 | `oo7` with zbus 6; nothing leaks | planted-secret grep over files, exports, logs, `--diagnose` | ADR 0019 |
| **S-weather** | P4 | Free, keyless, licensed weather warnings for your location | check DWD open data and other national services for license and coverage | skip or a provider |
| **S-sound** | P7 | Lightest way to play a bundled end-of-timer sound | event sound via the existing PipeWire link vs. canberra | in ADR or PROGRESS |

ADR numbers are provisional; they're assigned in the order the decisions are made.

## 5. Risks

| Risk | Impact | Mitigation |
| - | - | - |
| **Memory** keeps rising with every 2.0 feature | Budget missed again | P0 first; S6 per phase; lazy chunks for inspector/builder/gallery; fonts and workers only while used; your decision gate at P0 |
| **Scope**: this is several times the size of 1.0 | Long time before 2.0 ships | Phase sign-offs keep each step shippable; I'll suggest cutting or deferring items to you rather than shipping them half done |
| WebKitGTK compositing quirks (the 1.0 grey veil) with more layered content (skies, masks, gradients) | Visual bugs only on the real desktop | Keep stage content in one layer; ScreenCast pixel checks every visual phase |
| Compositions slower than hand-written widgets | Dropped frames, CPU | Expressions evaluate on change only; blocks memoized; the Clock in P2 is the benchmark |
| Mutter refuses `SetBacklight` or other writes from a normal client | Brightness slider missing in a mode | Route through the helper in Native mode; hide with a reason in Instant mode |
| Keyboard focus impossible without raising | No inline typing | Edit in the raised detail view (the brief's fallback) |
| Plugin sandbox weaker in WebKitGTK than in browsers | Security | S5 before any plugin code; hostile suite in CI; declarative packages first |
| GNOME 51 (spring 2027) changes Shell internals | Helper breaks | N−1 API, devkit test before each GNOME release |
| One reference machine | Hardware gaps | Fixtures for other GPUs; hardware-report template |

## 6. Cost statements (to be measured, §12)

Each new feature records its RAM and CPU cost in PROGRESS when it lands: blur pyramid, extra fonts, icon sets,
inspector/builder/gallery chunks, workers per plugin, photo frame cache, custom sources (per source), skies and
auras (frames only while visible), visualizer WebGL styles (≤ 3 % at 60 fps).

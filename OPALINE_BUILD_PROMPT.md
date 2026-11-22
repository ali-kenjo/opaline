**Opaline: Build Brief for Claude Code**  
   
 *"Read OPALINE_BUILD_PROMPT.md completely, then start."*  
  
---  
**0. How to work on this project**  
You are the lead engineer and the motion/UI designer for **Opaline**, a desktop-widgets app for Ubuntu. Build a production-grade **1.0**: complete and polished, not an MVP. Everything in this brief is in scope unless it is listed under Non-goals (§11).  
Ground rules:  
1. **Plan first.** Read this whole file. Then inspect this machine (it is the reference hardware, §1.4) and write `docs/SENSORS.md`: what actually exists here (hwmon names and labels, DRM cards, PCI runtime-PM status, NVML availability, PipeWire version, UDisks2 NVMe attributes, UPower devices, GNOME Shell/Mutter versions, whether DING is active, Docker context). Then write `docs/ARCHITECTURE.md` and `docs/PLAN.md` (the phases of §10 broken into tasks). **Stop and wait for my approval** before writing app code. Use plan mode for this.  
2. **Verify, don't assume.** Every sysfs/procfs path, D-Bus interface, GNOME Shell API and crate API in this brief must be checked on this machine or in current docs before you depend on it. If something here is wrong for Ubuntu 26.04 / GNOME 50, say so, propose the fix, and record the decision in `docs/adr/`.  
3. **Real data only.** Mocks are allowed only in tests and in the Widget Lab (§4.6). In the product, a missing sensor shows a clear state ("Unavailable", "Asleep", "Needs permission") and never invented numbers.  
4. **Work in phases** (§10). Each phase ends with its acceptance checks, a short note in `docs/PROGRESS.md`, and a commit. Keep commits small and reviewable, using conventional commit messages.  
5. **Tell me when you need me:** sudo installs, logging out and back in, polkit prompts, Docker Desktop actions, and visual sign-offs. Give me exact steps.  
6. Keep `CLAUDE.md` current: commands, architecture summary, conventions, and gotchas you discover.  
7. **Code quality.** Rust: no `unwrap()`/`expect()` in runtime paths, `clippy -D warnings`, `rustfmt`, and a provider must never be able to crash the process (isolate and report). TypeScript: `strict`, ESLint, Prettier. No dead code, and no TODOs without an issue reference.  
8. Use boring, proven solutions for the plumbing, and spend the creativity on the experience.  
9. For the GNOME Shell helper, develop in a nested session where possible (Mutter Devkit, `gnome-shell --devkit` on GNOME 49+; verify). On the real Wayland session, new helper code only loads after a re-login, so tell me when one is needed.  
  
---  
**1. Product**  
**1.1 Identity**  
  
|  |  |  
| - | - |  
|   |    |  
| Name |  **Opaline** |  
| Tagline |  Glass widgets for your Ubuntu desktop |  
| App ID |  `io.github.ali_kenjo.Opaline` |  
| Binary |  `opaline` |  
| Repository |  `github.com/ali-kenjo/opaline` |  
| Desktop-integration helper (GNOME Shell) UUID |  `opaline-desktop@ali-kenjo.github.io` |  
| Session D-Bus name |  `io.github.ali_kenjo.Opaline` |  
| Privileged helper (system bus) |  `io.github.ali_kenjo.Opaline.Privileged` |  
| License |  GPL-3.0-or-later |  
| Config / data / cache |  `~/.config/opaline/` · `~/.local/share/opaline/` · `~/.cache/opaline/` |  
  
   
**1.2 Vision**  
Android-style home-screen widgets on the Ubuntu desktop: add, move, resize, stack and remove them right on the wallpaper. They look like macOS 27 Liquid Glass and move like Android 17's Material 3 Expressive, and they cost almost nothing to run.  
Principles:  
- **Beautiful by default.** The first launch must already look finished.  
- **Honest data.** Precise, labeled, never faked.  
- **Invisible cost.** Strict performance budget (§7). A system monitor that eats your CPU defeats its own purpose.  
- **Native citizen.** Follows GNOME light/dark, accent color, animation, contrast and text-size settings.  
- **Private by default.** No telemetry. Network access only where a feature needs it.  
**1.3 Platform and audience**  
- Target: **Ubuntu 26.04 LTS**: GNOME 50, Wayland-only session (X11 apps run through Xwayland). Keep forward compatibility with GNOME 51 (Ubuntu 26.10) in mind.  
- **Public and open source, for any x86_64 hardware**: Intel/AMD CPUs; NVIDIA, AMD and Intel GPUs, including hybrid laptops; NVMe/SATA/USB storage; laptops and desktops; 1–4 monitors; 100–300% scale, including fractional.  
- Distribution: **one standalone `.deb`** from GitHub Releases. No extensions website, no app store required.  
**1.4 Reference machine (this laptop)**  
Intel Core i5-10300H (4 cores / 8 threads, Intel UHD 630 iGPU) · NVIDIA GTX 1660 Ti Max-Q 6 GB (hybrid graphics, proprietary driver) · 16 GB RAM · 512 GB NVMe SSD · Ubuntu 26.04.1 LTS · Docker Desktop installed (runs n8n).  
  
---  
**2. Experience**  
**2.1 Mental model**  
The desktop is the home screen. Widgets sit on the wallpaper, above Ubuntu's desktop icons and below app windows, on every workspace, per monitor.  
**2.2 Edit mode (Android parity)**  
Enter it by long-pressing a widget (450 ms without movement), right-clicking a widget → "Edit widgets", the tray menu, opening Opaline from the app grid, or the Edit shortcut. Use Pointer Events throughout so mouse, touchpad and touchscreen all work.  
In edit mode:  
- The widget layer rises above all windows, a blurred-wallpaper backdrop fades in, a subtle dot grid appears, and a floating toolbar shows **Add widget · Presets · Settings · Done**.  
- **Move.** Drag. The widget lifts (scale 1.04, deeper shadow) and follows the pointer 1:1. A ghost shows the landing cell, the other widgets slide out of the way on springs, and the widget snaps on release. A long-press that turns into a drag continues without a second press.  
- **Resize.** The selected widget shows an outline with four pill handles on its edges, Android style. Resizing snaps between the widget's allowed spans, and its content reflows live between its size layouts.  
- **Stack.** Drop a widget onto another of the same size to make a stack. Scroll or swipe to flip through it, with a dots indicator and a stack editor to reorder or remove. Optional Smart Rotate brings Now Playing to the front when music starts, Battery when it's low, and Storage when a drive is nearly full.  
- **Remove.** Drag to the "Remove" target at the top, or click the "–" badge, followed by a 5-second Undo snackbar.  
- **Configure.** Click a widget to open its settings sheet.  
- **Undo/redo.** Ctrl+Z / Ctrl+Shift+Z for every layout operation.  
- **Keyboard.** Tab/Shift+Tab selects, arrows move, Shift+arrows resize, Delete removes, Enter opens settings, Esc exits.  
- **Move to another display** from the context menu, or by holding a dragged widget at a monitor edge for 600 ms to hand it to the neighbouring display. All displays enter edit mode together.  
- Leave with Done, Esc, or a click on the empty backdrop.  
**2.3 Widget picker**  
A bottom sheet like Android 17's: search, categories (System, Media, Time, Info, Developer), and **live previews rendered with real data at each size**. Drag a preview onto the desktop, or click it to place it in the nearest free slot. Widgets that can't work on this hardware show the reason ("No battery on this device").  
**2.4 Grid**  
- Cell 84×84 logical px with a 12 px gap. That gives S = 2×2 (180×180), M = 4×2, L = 4×4 and XL = 8×4, plus 1×1, 2×1 and 4×1 where a widget supports them.  
- Each monitor has its own grid, computed from that monitor's **work area** (excluding top bar and dock) minus 24 px safe margins.  
- Layouts are saved per monitor, keyed by connector plus EDID vendor/product/serial. If a monitor disappears, its widgets wait and come back when it returns; optionally they show on the primary display in the meantime.  
- Resolution and scale changes refit the layout with minimal movement.  
**2.5 Peek**  
A shortcut (default **Super+Alt+W**, configurable) and a tray action raise the widget layer above all windows over a blurred-wallpaper backdrop, with widgets fully interactive. Dismiss with Esc, the shortcut again, or a click on the backdrop.  
**2.6 Appearance states**  
Setting: **Full color / Dimmed / Automatic** (default, like macOS).  
   
 Automatic means dimmed while an app window has focus, and full color when the desktop is focused, on hover, in Peek and in Edit. Dimmed is desaturated, slightly darker glass with monochrome content in the theme's on-surface tones, and it must stay legible (primary values ≥ 4.5:1 contrast). Transitions use effects springs (§4.4).  
**2.7 Detail views**  
Clicking a widget (outside edit mode) morphs it, as a shared element, into an expanded panel (up to 8×6 cells, limited by the monitor) with full charts, lists and actions. Esc or a click outside collapses it back. Right-click opens a custom glass context menu with keyboard support: Edit widgets, Widget settings, Remove, Move to display.  
**2.8 First run**  
1. **Welcome**: a short glass/shape animation.  
2. **Pick a starter layout**: Essentials, Performance, Creator, Developer, Minimal. The previews are rendered live over the user's real wallpaper.  
3. **Desktop integration**: one sentence of explanation ("Lets Opaline place widgets behind your windows. Takes effect the next time you log in."), with the toggle on by default. Meanwhile widgets already work in Instant mode (§5.2).  
4. **Privacy**: weather location (city search or automatic), public-IP lookup (off), update checks (on).  
5. **Optional**: "Show CPU power and full SSD health", which enables the privileged helper (§5.6).  
6. **Finish**: widgets fly to their places with staggered springs.  
**2.9 Settings window**  
A normal app window in Opaline's design language, with these sections: Appearance (theme source, light/dark/auto, glass slider, appearance state, density), Layout (presets, margins, per-monitor), Widgets (defaults), Alerts, Performance (Eco / Balanced / Realtime, pause on battery), Privacy, Desktop integration (mode and status), Shortcuts, Backup (export/import JSON), Diagnostics (§5.9), About & Updates.  
**2.10 Tray, notifications, accessibility, languages**  
- **Tray** (Ubuntu ships AppIndicator support): Peek · Edit widgets · Pause updates · Settings · Quit. Every tray action is also reachable from the app window, because vanilla GNOME has no tray.  
- **Alerts** become desktop notifications with actions (Open, Snooze 1 h), and the widget itself shows an alert state. Rules use hysteresis and cooldowns so they never spam.  
- **Accessibility**: full keyboard control and screen-reader labels. GNOME high contrast gives opaque surfaces and stronger outlines. `enable-animations = false` removes springs and morphs (≤150 ms crossfades instead). `text-scaling-factor` is respected, and status is never conveyed by color alone.  
- **Languages**: English (source), German and Arabic at 1.0. Arabic proves full RTL support: widget internals and UI chrome mirror, while the user's widget positions don't. Use ICU messages and locale-aware numbers, dates and units (°C/°F and bits/bytes can be overridden). I will review the German and Arabic strings.  
  
---  
**3. Widget catalog**  
Every widget has: layouts per size class, one "hero" visual that carries meaning, a detail view, a settings sheet, alerts where relevant, plus loading (M3 Expressive loading indicator), unavailable and asleep states with a one-line reason and a fix action where one exists. Every widget supports Full color + Dimmed, light + dark, hover lift, a focus ring and the context menu.  
**CPU.** 1×1 load ring · 2×2 load ring, temperature, clock · 4×2 60-second load sparkline, per-thread heat strip, temperature with trend, clock, package power (if available), top process · 4×4 per-thread heatmap, temperature graph, throttling badge, load average, uptime.  
   
 *Hero:* a temperature badge that morphs circle → cookie → soft burst → burst as heat rises.  
   
 *Detail:* per-core load/clock/temperature, 15-minute and 24-hour history, top 10 processes with End task.  
   
 *Alerts:* temperature ≥ 90 °C for 30 s (configurable); sustained 100% load for 5 min (off by default).  
**Memory.** 1×1 ring · 2×2 used/available plus a pressure dot · 4×2 stacked bar (apps/cache/free), swap, pressure sparkline, top 3 apps · 4×4 adds history.  
   
 *Hero:* a liquid fill whose surface gets choppier as memory pressure rises.  
   
 "Used" = MemTotal − MemAvailable. *Alerts:* available < 10% for 60 s; PSI "full" avg10 > 10%.  
**GPU.** Pick a GPU, or "Auto (active GPU)". 2×2 load ring and temperature · 4×2 load, VRAM, temperature, power, clocks, hybrid status ("Display on Intel · NVIDIA asleep") · 4×4 graphs plus the apps using the GPU.  
   
 *Asleep state:* moon shape, "Asleep · 0 W", no polling (see the GPU rule in §6).  
   
 *Detail:* all metrics, encoder/decoder, P-state, processes. *Alerts:* temperature ≥ 85 °C, VRAM ≥ 95%.  
**Network.** 2×1 ↓/↑ pill · 2×2 rates plus Wi-Fi name and signal · 4×2 dual live graph, SSID, signal, band, IP, latency · 4×4 adds today/this month data usage, VPN and interfaces.  
   
 *Hero:* two flowing waves (down/up) whose speed follows throughput.  
   
 *Detail:* interfaces, addresses, gateway/DNS, 30-day usage chart, latency chart. *Alerts:* disconnected; monthly data cap (optional).  
**Storage.** 2×2 main drive ring plus temperature · 4×2 all drives plus live read/write · 4×4 adds per-drive health.  
   
 *Detail:* partitions, SMART/health table, I/O history, Eject for removable drives.  
   
 *Alerts:* free space < 10%, SMART critical warning (immediately), NVMe ≥ 70 °C, available spare below threshold.  
**Now Playing.** 2×2 album art with a visualizer ring and play/pause · 4×2 art, title/artist, Android-style wavy progress bar (it flattens when paused), controls, bars · 4×4 large art masked by an expressive shape that breathes with the bass, full controls, player switcher.  
   
 The palette comes from the album art. When nothing is playing, show a calm empty state with quick-launch for the last player.  
**Visualizer** (standalone). 2×2 up to 8×4. Styles: Bars, Mirror, Wave, Radial, Blob (shape morph). Colors: theme, album art, or custom. Settings: bands (32/64/96), sensitivity, smoothing, frame rate.  
**Clock.** Styles: Expressive (big digits on shapes), Analog (optional smooth seconds), Minimal, World (up to 4 zones with a day/night indicator), Date. Sizes 1×1 to 4×4. Follows GNOME's 12/24-hour setting and the locale.  
**Calendar.** 2×2 today plus next event · 4×2 agenda · 4×4 month plus agenda. Read-only; clicking an event opens it in the default calendar app.  
**Battery & Power.** 2×2 ring, time left, watts · 4×2 adds battery health, a power-mode switch and peripheral batteries (mouse, keyboard, headset, controller) · 4×4 adds a 24-hour charge/discharge graph.  
   
 *Hero:* a pill-shaped liquid with rising bubbles while charging. Hidden on machines without a battery unless peripherals report one.  
   
 *Alerts:* low (20%, 10%); charged to a chosen level (optional).  
**Weather.** 2×2 temperature, condition shape, high/low · 4×2 adds a 6-hour strip · 4×4 adds 7-day forecast, air quality, sunrise/sunset. Show the data attribution.  
**Processes.** 4×2 top 5 by CPU or RAM · 4×4 top 10 with End task. Grouped by app, with real app names and icons.  
**Docker.** 2×2 running/total plus status · 4×2 container list (state, CPU, memory) · 4×4 adds Compose groups and Start/Stop/Restart. If Docker Desktop is stopped, show "Docker Desktop is stopped" with a Start action (Docker Desktop for Linux runs as the systemd user service `docker-desktop`; verify). Also supports Podman.  
**Fans.** 2×2 gauge · 4×2 all fans. Hidden from the picker when no fan sensors exist, with the reason shown.  
  
---  
**4. Design system: "Glass + Expressive"**  
Reference points: **macOS 27 Liquid Glass** (uniform refraction, strong readability, consistent corner radii, a clear↔tinted slider, full-color/dimmed desktop widgets) and **Android 17 Material 3 Expressive** (dynamic color, the expressive shape library, spring motion, translucency tinted by dynamic color). The design must be original: no Apple or Google assets, logos or trademarks.  
**4.1 Color**  
- A dynamic scheme via `@material/material-color-utilities`. The source color comes from the wallpaper (default), the GNOME accent color, or a custom color. A scheme-variant setting offers Tonal Spot (default), Vibrant, Expressive, Fidelity, Neutral and Monochrome. Light/dark follows the system, and there is a contrast-level option.  
- Map the M3 color roles to CSS custom properties and animate palette changes.  
- Semantic ramps are generated in HCT from the scheme so they harmonize: thermal (cool teal → amber → red), load, health. They are always paired with icons or labels.  
- Now Playing uses its own scheme derived from the album art.  
**4.2 Material (glass)**  
Layers per widget:  
1. a wallpaper sample, pre-blurred and aligned exactly to the widget's on-screen position;  
2. a tint (surface-container role, strength set by the glass slider);  
3. edge refraction (lens-like displacement near the border);  
4. a specular rim (a thin highlight lit from the top left that reacts faintly to the pointer while hovered);  
5. a soft drop shadow plus an inner shadow;  
6. 2–3% grain against banding.  
- **Glass slider** from Clear to Tinted (default 45). "Reduce transparency" or high contrast gives opaque surfaces.  
- **Adaptive legibility.** Measure the blurred wallpaper's luminance under each widget and raise the tint so primary text stays ≥ 4.5:1.  
- **Implementation.** One WebGL2 "glass compositor" canvas per layer window sits behind the DOM and draws all glass surfaces in a single pass (SDF rounded rects plus polygon shapes), sampling the pre-blurred wallpaper texture. It renders only when something is dirty (layout, theme, wallpaper, animation frames). Positions come from the same animation tick as the DOM, so glass and content never drift apart. If WebGL2 is unavailable, fall back to CSS (fixed-position blurred wallpaper plus tint).  
- The Edit/Peek backdrop is the same compositor drawing a full-screen blurred wallpaper at about 92% opacity.  
- Why the wallpaper is sampled: GNOME 50 offers no background blur to apps (§12), and the only thing behind desktop widgets is the wallpaper.  
**4.3 Shape**  
- Concentric radii: cards 28 px (S) / 32 px (M and larger); inner radius = outer radius − padding.  
- Expressive shapes: a TypeScript port of androidx `graphics-shapes` (RoundedPolygon, CornerRounding, Morph) and the Material 3 `MaterialShapes` set. Both are Apache-2.0, so keep attribution in `THIRD_PARTY.md`.  
- Shapes carry meaning (heat, sleep, weather, beat) and are never pure decoration. Loading states use the M3 Expressive loading indicator (a shape-morph sequence).  
**4.4 Motion**  
Spring tokens from the Material 3 Expressive motion scheme (confirm against the androidx `MotionScheme`/motion-token source):  
  
|  |  |  |  
| - | - | - |  
| **Token** |  **Stiffness** |  **Damping ratio** |  
| spatial.fast |  800 |  0.6 |  
| spatial.default |  380 |  0.8 |  
| spatial.slow |  verify (≈200) |  verify (≈0.8) |  
| effects.fast |  3800 |  1.0 |  
| effects.default |  1600 |  1.0 |  
| effects.slow |  800 |  1.0 |  
  
   
- Spatial springs drive position, size and shape. Effects springs drive color and opacity (no overshoot).  
- Convert to library parameters with damping = 2·ζ·√(k·m), m = 1.  
- Every animation can be interrupted and retargets mid-flight. Numbers roll like an odometer (per-digit springs, tabular figures). Graphs interpolate between samples, and live sparklines scroll smoothly while visible.  
- One in-house spring solver drives the layout (DOM and glass) in a single requestAnimationFrame loop. The `motion` library is fine for component micro-interactions.  
- Reduced motion: crossfades ≤ 150 ms and no morphs.  
**4.5 Typography and icons**  
- **Roboto Flex** (variable, OFL) for numerals and display text, with tabular figures and a subtle weight/width response to value changes. **Inter** (OFL) for UI text. Fall back to system fonts for scripts they don't cover (Arabic → Noto Sans Arabic). Bundle the fonts locally; never load fonts from the network.  
- **Material Symbols Rounded** (variable, Apache-2.0), with fill and weight animated by state.  
- A 4-pt spacing scale; widget padding 16 px (S) / 20 px (M and larger).  
**4.6 Widget Lab**  
A dev-only route that renders every widget × size × light/dark × state (full, dimmed, edit, peek, alert, loading, unavailable, asleep) over selectable wallpapers, with mock data. It is used for design review and for Playwright screenshot regression tests on the WebKit engine.  
  
---  
**5. Architecture**  
**5.1 Processes**  
1. **`opaline` (core).** A Tauri 2 app with no window by default. It holds the sensor engine, history, alerts, the settings and layout store (single source of truth), the IPC server, the session D-Bus service, the tray, autostart and portals. It opens the Settings and Onboarding windows on demand (Wayland-native). Single instance.  
2. **`opaline --layer` (renderer).** A Tauri 2 app with one transparent, undecorated webview window per monitor that renders the widget layer. It connects to core over IPC and must tolerate starting before core (wait and retry). It is spawned by the desktop-integration helper (Native mode) or by core (Instant mode).  
3. **Desktop-integration helper.** A small GNOME Shell component bundled with the app (GJS, ESM). It only handles window placement and shell signals: no rendering, no polling, and no heavy work on the compositor thread.  
4. **`opaline-privileged` (optional).** A D-Bus-activated, read-only system service protected by polkit. It exits when idle.  
**5.2 Desktop integration (the hard part)**  
On GNOME 50 a regular Wayland app cannot position itself, stay below other windows, appear on all workspaces, or hide from Alt-Tab, the overview and the dock. GNOME has no wlr-layer-shell. So there are two backends behind a `DesktopBackend` trait, and the app picks one automatically.  
**Native mode (preferred).** The helper:  
- spawns the layer process with `Meta.WaylandClient` (trusted client), identifies its windows with `owns_window()`, and hides them with `hide_from_window_list()`;  
- spawns the layer only while core's D-Bus name is owned, and stops it when core exits;  
- makes each layer window sticky and keeps it below normal windows but **above DING's desktop-icons window** (re-raise within the bottom of the stack on restack, and never fight DING's own lowering), sized and positioned to its monitor (the window title carries the monitor connector, e.g. `opaline-layer:eDP-1`);  
- re-applies placement on monitor and work-area changes, and undoes minimizing (for example from Show Desktop);  
- exports `io.github.ali_kenjo.Opaline.Shell1` on the session bus: property `ApiVersion`; methods `GetMonitors()`, `GetWorkAreas()`, `SetRaised(b)` (for Peek and Edit); signals `MonitorsChanged`, `WorkAreasChanged`, `DesktopFocusChanged(b)`, `OverviewChanged(b)`, `LayerCovered(s connector, b)`, `ShortcutActivated(s name)`;  
- registers the Peek and Edit shortcuts through the shell's keybinding API;  
- cleans up completely in `disable()` and stops the layer, so core falls back to Instant mode.  
Study DING (Ubuntu's desktop-icons helper) for the trusted-client pattern, and don't copy code without license compatibility.  
**Instant mode (fallback, zero setup).** The layer runs with `GDK_BACKEND=x11` through Xwayland and uses Tauri window options: `decorations(false)`, `transparent(true)`, `skip_taskbar(true)`, `always_on_bottom(true)`, `visible_on_all_workspaces(true)`, plus an explicit position and size per monitor. Verify on GNOME 50 that:  
- the "below" state keeps the layer above DING and below apps;  
- it's hidden from Alt-Tab, the overview and the dock;  
- Show Desktop doesn't hide it (re-show it if it does).  
In this mode, appearance "Automatic" uses hover and focus of the layer, Peek toggles always-on-top, and shortcuts use the GlobalShortcuts portal (GNOME 48+), held by core. Test at 100%, 125%, 150% and 200% scale (GNOME 50 turns fractional scaling on by default, and Ubuntu has a "scale legacy apps" toggle).  
**Selection and switching.** Core prefers Native mode when the helper answers on D-Bus with a compatible `ApiVersion`, and otherwise uses Instant mode. It switches live, without restarting, when the helper appears after a re-login or disappears. Settings → Desktop integration shows a calm status ("Native", or "Instant — native turns on after you log out and back in"). Turning native off in Settings calls `org.gnome.Shell.Extensions.DisableExtension`.  
**Helper install and updates.**  
- The `.deb` installs the helper to `/usr/share/gnome-shell/extensions/opaline-desktop@ali-kenjo.github.io/`.  
- On first run core enables it for the user with `org.gnome.Shell.Extensions.EnableExtension`. If the running shell doesn't know it yet, add the UUID to `org.gnome.shell enabled-extensions`.  
- GNOME Shell loads new or updated helper code only at login, so **version skew is normal**. Core supports helper API N and N−1, degrades gracefully, and asks for a re-login only when it's actually needed.  
- `metadata.json` declares `shell-version: ["50"]`; add `"51"` after testing on GNOME 51.  
- UI copy calls it "Desktop integration". It may appear in GNOME's Extensions app as "Opaline Desktop Integration", which is fine and honest.  
- Uninstalling must leave no broken state.  
**Input pass-through (both modes).** The layer window's input region is the union of the widget rectangles (GTK3 input shape through the Tauri window's GTK handle), so clicks anywhere else reach the desktop icons. In Edit and Peek the whole window takes input.  
**5.3 Data flow**  
```  
providers → sampler (tokio, per-provider cadence)  
          → ring buffers (1 s × 15 min, 10 s × 24 h) + SQLite rollups (1 min × 30 days; data-usage counters)  
          → topic bus → IPC (Unix socket in $XDG_RUNTIME_DIR/opaline/, mode 0600,  
                             length-prefixed MessagePack; raw binary frames for the audio spectrum)  
          → layer → Tauri Channels → React store (Zustand) → widgets  
   
```  
Commands flow the other way (End task, Docker actions, media controls, eject, power mode), and core validates every one.  
**5.4 Adaptive sampling**  
Subscriptions drive sampling: with no subscriber there is no sampling, except alert-critical metrics at a low rate.  
  
|  |  |  
| - | - |  
| **State** |  **Interval** |  
| Desktop focused / Peek / Edit / detail view open |  1 s (visualizer 60 Hz) |  
| Ambient (dimmed) |  2 s |  
| Layer covered (maximized or fullscreen app) |  5 s, history only, no rendering |  
| Screen locked / session idle |  alerts only, 10 s |  
| On battery with Eco |  intervals × 2 |  
  
   
Rendering uses one requestAnimationFrame scheduler. Widgets redraw only when their data changes or while they animate, and nothing renders while the layer is covered.  
**5.5 Persistence**  
`settings.json` and `layouts.json` with versioned schemas and migrations, atomic writes, export and import. Example layout:  
```  
{  
   "version": 1,  
   "monitors": {  
     "BOE-08DF-0:eDP-1": {  
       "items": [  
         { "id": "w_7f3a", "type": "cpu", "x": 0, "y": 0, "w": 4, "h": 2, "settings": {} },  
         { "id": "s_19c2", "type": "stack", "x": 4, "y": 0, "w": 2, "h": 2,  
           "children": ["w_aa01", "w_aa02"], "smartRotate": true }  
       ]  
     }  
   }  
 }  
   
```  
**5.6 Privileged helper**  
- System D-Bus service `io.github.ali_kenjo.Opaline.Privileged1`, D-Bus activated, exits after 60 s idle.  
- Methods: `GetCpuEnergy()` returns RAPL `energy_uj` and `max_energy_range_uj` per domain. `GetNvmeSmart(s device)` validates the name against `^nvme[0-9]+$`.  
- Polkit action `io.github.ali_kenjo.opaline.read-sensors`: allowed for active local sessions only.  
- No arbitrary file access, rate-limited, and only used when the user has enabled it.  
**5.7 Widget SDK (internal)**  
Each widget is a module defined with `defineWidget({ id, name, category, sizes: { min, max, presets }, subscriptions, settingsSchema, render, detail, alerts, availability })`. `render` receives `{ size, data, appearance, settings }` and provides a layout per size class. There is no third-party widget loading in 1.0.  
**5.8 Security and privacy**  
- Tauri capabilities follow least privilege, with a strict CSP.  
- Webviews never load remote content: core fetches and caches album art and weather data.  
- Network access is used only for weather, public IP (opt-in), update checks (opt-out) and album art. No telemetry.  
- Debug reports redact SSIDs, IP addresses, hostnames and usernames.  
**5.9 Diagnostics**  
- `opaline --diagnose` prints a redacted JSON inventory of sensors, for bug reports.  
- Settings → Diagnostics shows Opaline's own CPU and RAM over time, the backend mode, the helper version, each sensor's status, the logs, and "Copy debug report".  
- Logging uses `tracing`, written to journald and a rotating file.  
  
---  
**6. Sensor sources**  
Verify each source on this machine. Capture redacted fixtures (`fixtures/<machine>/…`) for parser tests, and add synthetic fixtures for an AMD CPU+GPU, Intel Arc, a desktop without a battery, and a VM without a GPU. Good references to study (respect their licenses): **Resources** (Ubuntu 26.04's default system monitor), **Mission Center**, **nvtop** (GPU fdinfo), **DING** (trusted-client windows).  
**CPU**  
- Usage: `/proc/stat` deltas, per CPU.  
- Clock: `/sys/devices/system/cpu/cpufreq/policy*/scaling_cur_freq`.  
- Temperature: hwmon devices by `name`: `coretemp` ("Package id 0", "Core N"), `k10temp` (Tctl/Tccd), `zenpower`; thermal zones as fallback.  
- Throttling: on Intel, deltas of `/sys/devices/system/cpu/cpu*/thermal_throttle/*_throttle_count`; elsewhere infer it and label it "likely".  
- Package power: RAPL `/sys/class/powercap/intel-rapl:*/energy_uj` is root-only on current kernels, so it goes through the privileged helper, and is hidden otherwise.  
- Also `/proc/loadavg`, `/proc/uptime`, `/proc/cpuinfo`.  
**Memory**  
- `/proc/meminfo` (MemAvailable, Cached, Buffers, Shmem, Swap\*, Zswap if present) and `/proc/pressure/memory` (PSI).  
- Top apps come from the process provider: RSS, plus PSS via `smaps_rollup` for the top N every 10 s.  
**GPU** — enumerate `/sys/class/drm/card*/device` (PCI vendor 0x10de / 0x1002 / 0x8086, `boot_vga`, connector status to see which GPU drives displays).  
- **Rule: for every discrete GPU, read `/sys/bus/pci/devices/<BDF>/power/runtime_status` first. If it says `suspended`, show Asleep and do not touch NVML or the amdgpu sysfs files, because reading them wakes the GPU. Release NVML whenever the GPU has no other clients so it can suspend again.** *Acceptance:* on this laptop, with the GPU widget visible, the NVIDIA GPU reaches `suspended` within 60 s after GPU apps close.  
- NVIDIA: NVML via `nvml-wrapper`, loaded at runtime (if it's absent, the feature is hidden): utilization, temperature, VRAM, power and limit, clocks, P-state, fan (if supported), encoder/decoder, processes.  
- AMD (amdgpu): `gpu_busy_percent`, `mem_info_vram_used/total`, hwmon temperatures (edge/junction/mem), power, clocks, fan.  
- Intel (i915/xe): current frequency from sysfs; utilization approximated from RC6 residency (labeled "approx."); per-app engine time from DRM fdinfo where readable.  
**Displays**  
- `org.gnome.Mutter.DisplayConfig` (`GetCurrentState`, `MonitorsChanged`) for monitor identity (connector, vendor, product, serial), geometry and scale. Verify it is callable as a normal session client. Native mode also gets work areas from the helper.  
**Storage**  
- From `/proc/self/mountinfo`, take real block-device filesystems only. **Exclude loop/squashfs (snaps), tmpfs and overlay.** Group partitions by physical drive.  
- Space: `statvfs` (use `f_bavail`). Throughput and busy %: `/proc/diskstats`.  
- NVMe temperature: hwmon `nvme` (no root needed).  
- Health: UDisks2 (`NVMe.Controller.SmartGetAttributes`; `Drive.Ata` SMART for SATA). Verify unprivileged access; otherwise use the privileged helper.  
- UDisks2 also handles eject and power-off.  
**Network**  
- Rates: deltas from `/sys/class/net/*/statistics` or `/proc/net/dev`. Classify physical vs. virtual interfaces (docker0, veth\*, br-*, virbr*, tun/wg) and show physical ones by default.  
- NetworkManager D-Bus: SSID, signal, band, bitrate, VPN/WireGuard, connectivity. Ethernet speed: `/sys/class/net/<if>/speed`.  
- Latency: an unprivileged ICMP datagram socket (fallback: TCP connect to :443), measured only while visible.  
- Public IP: opt-in, cached for 10 min.  
- Data usage: persisted across reboots (handle counter resets), as today and this month (billing day configurable).  
**Battery and power**  
- UPower D-Bus: percentage, state, energy rate, time to empty/full, capacity (health), charge cycles if present, and peripheral batteries.  
- Power mode: the PowerProfiles D-Bus API. AC adapter state.  
**Audio spectrum**  
- PipeWire (`pipewire` crate): passive capture of the **default sink's monitor**, following default-sink changes. Never capture the microphone.  
- FFT in Rust (`rustfft`, Hann window, 2048 samples), log-spaced bands, attack/decay smoothing, peak hold.  
- Capture only while a visualizer is visible and audio is active. Stop after 3 s of silence or when MPRIS reports paused.  
- Check whether GNOME's microphone privacy indicator appears while a monitor stream is captured. Document the result and keep capture time minimal.  
**Media**  
- MPRIS (`org.mpris.MediaPlayer2.*`): metadata, playback status, position (extrapolated, corrected by `Seeked`), capabilities, controls.  
- With several players, use the most recently active one and offer a switcher.  
- Album art: read `file://` URLs directly; core fetches `https://` URLs (with a size limit and a cache).  
**Processes**  
- `/proc/[pid]/{stat,statm,status,cmdline,cgroup}`.  
- Group by app using systemd scope names (`app-gnome-<app-id>-<pid>.scope` and similar) plus `.desktop` files for names and icons.  
- End task (SIGTERM) and Force quit (SIGKILL, with confirmation), for the user's own processes only.  
**Docker / Podman**  
- Endpoint resolution order: `DOCKER_HOST` → the Docker CLI's current context (Docker Desktop for Linux uses the `desktop-linux` context) → `/var/run/docker.sock` → the Podman user socket.  
- Use `bollard` for containers, Compose grouping (`com.docker.compose.project`), stats and start/stop/restart.  
- "Permission denied" and "not installed" get clear guidance states.  
**Fans**  
- hwmon `fan*_input` plus labels. Read-only.  
**Clock and calendar**  
- System time zone, plus IANA zones for world clocks; GNOME `clock-format`; week start from the locale.  
- Events: Evolution Data Server (what GNOME Online Accounts and GNOME Calendar use). Pick the most robust read-only access path and record it in an ADR. ICS/webcal subscriptions are a second source.  
**Weather**  
- Open-Meteo forecast and air quality (no API key; show the attribution) and Open-Meteo geocoding for city search.  
- Optional automatic location via GeoClue, after asking.  
- Cached; refresh every 15 min while visible, 60 min otherwise.  
**Wallpaper and system appearance**  
- `org.gnome.desktop.background`: `picture-uri` or `picture-uri-dark` (chosen by `color-scheme`), `picture-options`, and primary/secondary color with shading (solid and gradient backgrounds). Watch for changes.  
- Render each monitor's wallpaper exactly as GNOME places it, produce blurred variants at quarter resolution, serve them to the layer through a Tauri custom protocol, and extract the source color.  
- Also read `accent-color`, `color-scheme` (through the Settings portal), `enable-animations`, `high-contrast` and `text-scaling-factor`, and track screen lock through `org.gnome.ScreenSaver`.  
- For portals that need an app ID, register the host app ID first where required.  
  
---  
**7. Budgets (acceptance)**  
Measured on this laptop with the default layout:  
- Idle with widgets visible: Opaline's total CPU ≤ **0.5%** of the machine (60-second average); RAM ≤ **220 MB** for core plus layer.  
- Layer covered or screen locked: ≤ **0.1%** CPU.  
- Visualizer playing: ≤ **3%** CPU at a steady 60 fps.  
- No dropped frames while dragging, resizing, peeking or morphing.  
- Opaline never wakes a sleeping dGPU.  
- Widgets visible ≤ **1.5 s** after core starts.  
Diagnostics shows these numbers live.  
  
---  
**8. Stack and repository layout**  
- **Rust** stable (edition 2024), **Tauri 2** (links `libwebkit2gtk-4.1`, which Ubuntu 26.04 ships), tokio, zbus, serde + rmp-serde, rusqlite, nvml-wrapper, pipewire, rustfft, bollard, image (with JPEG XL support), a fast blur crate, gio (GSettings), ashpd (Settings, GlobalShortcuts and Location portals), tracing.  
- **Frontend:** React 19 + TypeScript (strict) + Vite + pnpm; Zustand; CSS Modules + CSS custom properties (no UI kit); `motion`; `@material/material-color-utilities`; uPlot for detail charts plus custom Canvas2D/WebGL2 renderers; FormatJS; Vitest; Playwright (WebKit).  
- **Helper:** GJS with ESM modules, ESLint.  
```  
opaline/  
   CLAUDE.md  README.md  LICENSE  THIRD_PARTY.md  
   docs/        ARCHITECTURE.md  SENSORS.md  PLAN.md  PROGRESS.md  DESIGN.md  adr/  
   crates/      opaline-core/  opaline-ipc/  opaline-privileged/  
   app/         src-tauri/  
                src/  design-system/  widgets/  layer/  settings/  onboarding/  lab/  i18n/  
   desktop-integration/   GNOME Shell helper (UUID opaline-desktop@ali-kenjo.github.io)  
   packaging/   deb assets, polkit, dbus, autostart, metainfo, icons  
   fixtures/  scripts/  .github/workflows/  
   
```  
  
---  
**9. Packaging, updates, CI**  
- **`.deb`** built with the Tauri bundler. It contains `/usr/bin/opaline`, the desktop file, AppStream metainfo, hicolor icons (an original SVG app icon), the helper (with compiled GSettings schemas), and the privileged helper with its D-Bus service file and polkit policy. It depends on the WebKitGTK 4.1, GTK 3, AppIndicator and PipeWire runtime libraries; NVML is optional at runtime.  
- **NVIDIA note:** WebKitGTK can show blank windows when the NVIDIA GPU is the primary renderer. Detect that case and set `WEBKIT_DISABLE_DMABUF_RENDERER=1`, and document it. On this laptop the desktop normally renders on the Intel iGPU.  
- **Autostart** through `~/.config/autostart/`, with a toggle in Settings.  
- **Updates:** a daily GitHub Releases check (opt-out) shows an in-app card. Opaline downloads the `.deb`, verifies the checksum and a minisign signature, and installs it with `pkexec apt install ./opaline_<version>_amd64.deb`.  
- **CI** on GitHub Actions (use an `ubuntu:26.04` container if no 26.04 runner exists): lint, tests, Playwright screenshots, `.deb` build, artifact upload. Tagged releases include checksums and signatures.  
- **README** with screenshots/GIFs, a privacy statement, troubleshooting, and a hardware-report issue template that asks for `opaline --diagnose` output.  
  
---  
**10. Build order (everything is in scope for 1.0)**  
  
|  |  |  |  
| - | - | - |  
| **Phase** |  **Scope** |  **Acceptance** |  
| **P0 Foundations** |  Repository, CLAUDE.md, ADRs, CI, Tauri core and layer modes, IPC crate, logging, `--diagnose` skeleton |  CI green; core shows its tray; a test layer window connects to core |  
| **P1 Sensor engine** |  All providers (§6), probe/sample/cost per provider, GPU runtime-PM rule, history, alerts engine, full `--diagnose` |  Values match reference tools on this laptop (`top`, `free`, `nvidia-smi`, `sensors`, `df`, `ip -s link`, `upower -d`, `docker ps`); parser tests pass on all fixtures; the dGPU stays asleep |  
| **P2 Design system & Widget Lab** |  Tokens, color pipeline, glass compositor, shapes and morph port, motion tokens, typography, icons |  WebGL2 works in the Tauri webview here; Lab screenshots baselined; my visual sign-off |  
| **P3 Widgets** |  Every widget at every size, detail views, settings sheets, live data |  My visual sign-off per widget; every unavailable/asleep state can be demonstrated |  
| **P4 Layer & desktop integration** |  Per-monitor layer windows, input regions, Instant backend, Native helper, automatic switching, Peek, appearance states, monitor hot-plug |  In both modes: above desktop icons, below apps, on all workspaces, hidden from Alt-Tab/overview/dock, survives Show Desktop, clicks outside widgets reach desktop icons; switching to Native after a re-login works without restarting Opaline |  
| **P5 Edit mode & layout engine** |  Grid, picker, move/resize/remove, stacks, undo, keyboard, presets, per-monitor layouts, cross-display moves |  Everything in §2.2–2.4 works with mouse, touchpad and keyboard |  
| **P6 Product shell** |  Onboarding, settings, tray, shortcuts (portal and helper), notifications, autostart, privacy controls, export/import, updates |  Full first-run flow works on a fresh user account |  
| **P7 Quality** |  German and Arabic (RTL) translations, accessibility pass, budgets met (§7, measured and recorded), security review (capabilities, CSP, privileged helper), fault isolation |  No crashing provider can take core down; all budgets recorded in `docs/PROGRESS.md` |  
| **P8 Release** |  Install, upgrade and uninstall tested on a clean Ubuntu 26.04 VM in Native and Instant modes; signed v1.0.0; README media |  I can install the release `.deb` on a clean system and everything works |  
  
   
**1.0 is done** when every phase's acceptance checks pass, the budgets are met, the translations are complete, the clean-VM install works, and I've signed off visually.  
  
---  
**11. Non-goals for 1.0**  
- Fan, RGB or clock control, and any other hardware writes (except power mode, Docker actions, End task and eject).  
- Desktops other than GNOME. Keep `DesktopBackend` open for a future layer-shell backend (KDE, Hyprland, COSMIC).  
- Flatpak and Snap: sandboxing blocks the sensors and the shell integration.  
- Third-party widget plugins and cloud sync.  
  
---  
**12. Known pitfalls (pre-researched; verify)**  
- GNOME 50 is Wayland-only; there is no X11 session anymore (X11 apps still run through Xwayland).  
- GNOME has no wlr-layer-shell. Wayland background blur (`ext-background-effect-v1`) only arrives with Mutter 51, which is why the glass samples the wallpaper.  
- New helper code only loads after a re-login, so design for version skew.  
- Querying a sleeping NVIDIA or AMD dGPU wakes it up.  
- RAPL energy counters are root-only.  
- Snap loop mounts flood storage lists.  
- WebKitGTK with NVIDIA as the primary renderer can show blank windows (§9).  
- GNOME 50 turns fractional scaling on by default, and Xwayland scaling behaves differently, so test Instant mode at fractional scales.  
- DING shares the bottom of the window stack: coexist with it, never fight it.  
- Don't use X11 key grabs for global shortcuts. Use the GlobalShortcuts portal (GNOME 48+) or the helper.  
- Keep the GNOME Shell helper tiny: no polling, nothing heavy on the compositor thread.  
  
---  
**13. Start now**  
1. Read this file completely.  
2. Inspect this machine and write `docs/SENSORS.md`.  
3. Write `docs/ARCHITECTURE.md` and `docs/PLAN.md`.  
4. Stop and ask me for approval before writing any Phase 0 code.  

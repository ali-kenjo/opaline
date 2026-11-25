# Opaline 2.0: Brief for Claude Code

*Open Claude Code in the repository and say: "Read OPALINE_2_BRIEF.md completely, then start."*

---

## 0. How to work on this release

You are the lead engineer and the product, motion and UI designer for **Opaline 2.0**. Opaline 1.1.0 is released and works (§1.1). 2.0 builds on it: a production-grade release, complete and polished, not an MVP. Everything in this brief is in scope unless §14 lists it as a non-goal. Where this brief says nothing, the 1.0 brief (`OPALINE_BUILD_PROMPT.md`) still applies.

Ground rules:

1. **Read first.** This file; then `docs/HANDOFF.md`, `CLAUDE.md`, `docs/ANALYSIS_REPORT.md`, `docs/DESIGN.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md` and ADRs 0001–0011; then the code in `app/src/widgets/`, `app/src/layer/`, `app/src/design-system/`, `app/src/settings/` and `crates/opaline-core/src/{store,style,layouts,commands,http}.rs`. Look at the Lab baselines in `app/e2e/lab.spec.ts-snapshots/`.
2. **Plan first, in plan mode.** Write `docs/PLAN-2.md` (the phases of §13 broken into tasks, with risks and the spikes of §15) and an outline of `docs/DESIGN-2.md`. Point `CLAUDE.md` at this brief and the new plan. **Stop and wait for my approval before writing code.**
3. **Verify, don't assume.** Every D-Bus interface, GSettings key, crate and web-platform feature named here must be checked on this machine (Ubuntu 26.04.1, GNOME 50.1, the WebKitGTK that Tauri 2.12 links) or in current docs before you depend on it. Where this brief is wrong, say so, propose the fix and record the decision in a new ADR (0012 onward).
4. **Phases with sign-off.** Each phase ends with its acceptance checks, a `docs/PROGRESS.md` entry ("2.0 · Phase N"), small conventional commits, an updated `docs/HANDOFF.md`, and my sign-off. Visual work needs Lab screenshots plus a ScreenCast capture of the real desktop (`scripts/capture-monitor.py`).
5. **Real data only** in the product; mocks only in tests and the Widget Lab. Missing data shows an honest state, never invented numbers.
6. **Keep 1.x users whole.** Every stored file (settings, layouts, styles, named styles) migrates automatically, and nothing a user configured is lost. 1.1's look ships as the **Classic** theme, so nobody is forced into the new design.
7. **The repo rules in `CLAUDE.md` apply**: lints (no `unwrap`/`expect`/`panic`, `clippy -D warnings`, strict TypeScript), every animation through the motion scheduler, commit author `ali-kenjo`, and **no `Co-Authored-By` or "Generated with" lines**.
8. **Tell me when you need me**: sudo, re-logins (helper changes), polkit prompts, accounts and tokens (GitHub, Home Assistant, n8n), and visual sign-offs. Give exact steps. I prefer plain, short explanations.
9. Boring, proven plumbing; spend the creativity on the experience.

---

## 1. Starting point and goal

### 1.1 Where 1.1.0 stands
- 14 widgets: Clock, CPU, Memory, GPU, Storage, Network, Battery & Power, Fans, Processes, Now Playing, Visualizer, Weather, Calendar, Docker. Seven render through one template (`StatLayout`: header, hero, label/value rows); the other seven have custom layouts that repeat its header and row style.
- Customization (ADR 0011): 42 style settings in six groups plus per-widget content settings, inherited built-in → global → widget, with named styles.
- A WebGL2 glass compositor: one pass, rounded-rect and polygon SDFs, sampling a quarter-resolution pre-blurred wallpaper.
- Android-style Edit mode, stacks, picker, presets, detail views, Settings (11 sections), onboarding, English/German/Arabic with RTL, excellent CPU numbers (0.05 % idle), tray, and a D-Bus `Opaline1` interface that only offers Peek, Edit, OpenSettings, OpenOnboarding and Quit.
- Open problems (`docs/ANALYSIS_REPORT.md`): **memory at 426 MB PSS against the 280 MB budget**; no UI tests for Edit mode, Settings or Onboarding; `LayerApp.tsx` is 1,808 lines; `PROGRESS.md` describes a 96 px / 16 px grid while the code and `DESIGN.md` use 84 px cells with 12 px gaps.
- The frontend is deliberately lean (React, Zustand, material-color-utilities, fontsource fonts, Material Symbols, in-house charts and motion). Keep it that way: add a library only when it is worth its memory.

### 1.2 The 2.0 vision
**Apple/Android-grade on the surface, Linux-grade underneath.** Opaline should feel as polished as macOS and Android home-screen widgets and be as customizable as Linux itself: every pixel, every data source and every behavior can be changed, scripted and shared.

Three depths of use:
1. **Beautiful by default.** The first launch looks like a premium home screen. One click switches between complete, designed looks.
2. **Direct and live.** Select a widget, change anything in a live inspector on the real desktop, and see it instantly.
3. **Limitless.** Themes and whole desktop setups as files, a widget builder fed by any data, user CSS, plugins, a community gallery, profiles, automation, a CLI and a D-Bus API.

Principles:
- **Progressive disclosure.** Essentials first, everything else one level deeper. Never a wall of 40 sliders.
- **One system.** First-party widgets, user-built widgets and plugin widgets all render through the same composition engine (§4), style cascade (§5) and inspector (§6). No widget is special or closed.
- **Everything is a file.** Settings, themes, widgets, data sources, layouts and profiles are readable files that reload live and validate against published JSON Schemas.
- **The wallpaper is part of the design.** Widgets can be as see-through as the user wants and still stay readable.
- **Safe by default.** Anything imported is untrusted until the user grants each permission.
- Unchanged from 1.0: honest data, invisible cost, private by default, a native GNOME citizen.

Design references to study (never copy assets, code or trademarks): macOS 26/27 desktop widgets and Liquid Glass; iOS 26 home-screen customization (clear and tinted widgets); Android 16/17 Material 3 Expressive widgets; KWGT/KLWP (composition plus formulas); Rainmeter, Conky, Übersicht, eww, AGS and KDE Plasma widgets (desktop customization culture).

---

## 2. Design audit of 1.1: what to fix

From the Lab baselines and the code:

1. **One template for almost everything.** Icon + title header, a ring or a number, then small label/value rows; even the custom layouts (Weather, Calendar, Docker, Processes) repeat that header and row pattern. The desktop reads as a monitoring dashboard, not a home screen. Premium widgets have one dominant element and a composition designed per widget and per size.
2. **Truncated labels.** "Videc" (GPU video memory), "Wi-F", "TEMPERATU", a lone "T" before the data usage, "Monday, November …". A label must never be cut mid-word.
3. **Dead space.** Weather 4×4 is half empty, Calendar 4×2 uses its top third, and the 4×4 clock and Docker leave large empty areas.
4. **Weak hierarchy.** Hero numbers at weight 400; everything else 12–14 px at similar weight and contrast.
5. **No shape or color identity.** The 35 expressive shapes and morphs only appear in loading states, and every widget is the same wallpaper hue on the same glass.
6. **The wallpaper disappears.** The tint and the always-on quarter-resolution blur hide it, and refraction and the specular rim are barely visible. Users must be able to see their wallpaper through the widgets: this is an explicit requirement from me.
7. **Two customizers.** The sheet on the desktop (`widgets/settings/WidgetSettings.tsx`, 873 lines) and Settings → Widgets (`settings/WidgetCustomizer.tsx`, 755 lines) overlap, and both are long lists of controls instead of direct, live editing.
8. **Processes rows** show a ⠿ glyph that looks like a drag handle where the app icon should be.
9. **Redundant headers**, such as "CPU" above a CPU ring.

---

## 3. Design language 2.0

### 3.1 Looks: ship many complete designs
I want as many looks as possible. Build them as first-party themes on the theme engine (§5.2). Each one is a complete identity, not a color swap: its own type scale, shape language, surface treatment, motion personality, hero visuals and clock faces. All original: no Apple or Google assets, fonts, icons, logos or trademarked names in the product.

| Theme | Character |
| - | - |
| **Opaline** (new default) | The refined hybrid: glass in the spirit of Liquid Glass, Expressive shapes and springs, bold Roboto Flex numerals, a signature layout per widget |
| **Crystal** | Calm and content-first (the macOS/iOS widget sensibility): clear glass, continuous-corner squircles, large heavy numerals, almost no labels, restrained color |
| **Bloom** | The Android 17 sensibility: cards in library shapes, tonal color containers, wavy progress, playful morphs |
| **Air** | Wallpaper-first: frameless or nearly invisible surfaces, text with a soft halo, widgets that float on the wallpaper |
| **Terminal** | A Linux rice: monospace, box-drawing frames, TUI-style bars and sparklines, an ANSI-like palette taken from the wallpaper |
| **Neon** | Dark surfaces, glowing gradient outlines, a synthwave palette |
| **Paper** | Light and matte: an editorial serif with a grotesk, hairlines, no glass |
| **Mono** | Monochrome, high contrast, e-ink calm; ideal for the Dimmed state |
| **Classic** | Exactly 1.1's look, for upgraders |

- Fonts: bundle only OFL or Apache-2.0 fonts (for example JetBrains Mono for Terminal and a serif such as Source Serif 4 or Fraunces for Paper; verify the licenses), list them in `THIRD_PARTY.md`, and load a font only while the active theme uses it.
- Each theme brings its own starter layouts (replacing today's five presets), shown in onboarding and in Settings → Looks.

### 3.2 Signature widget anatomy
These rules define the Opaline theme; the other themes vary within them.
- **One hero per widget and size**, big enough to dominate (around 40 % of the card at S and M). Units are smaller than the numerals and share their baseline.
- **Type with real weight contrast**: hero numerals at weight 600–800, with the Roboto Flex width axis tuned per size (narrower for long numbers) and tabular figures; secondary text at 500; captions at 400 with lower emphasis. Define the full scale in `DESIGN-2.md`.
- **No header by default** where the content explains itself (clock, weather, media, photos, the calendar date tile). Elsewhere use a compact glyph or a short title, never a big icon plus a title above an obvious visual.
- **Color identity per widget kind**: a semantic accent role per kind (thermal for CPU, a cyan family for network, a green family for battery, and so on), harmonized with the scheme in HCT and overridable.
- **Shapes carry meaning**: the CPU temperature badge morphs circle → cookie → burst as heat rises; a sleeping GPU becomes a moon/pill; battery is a liquid pill with rising bubbles while charging; weather conditions are shapes; album art and photos can be masked by any shape, and for media the mask breathes with the bass.
- **Responsive rules, never truncation.** Every layout gives its elements priorities. When space runs out it degrades in this order: hide the icon → switch to the field's explicit short label (written per field, never a cut) → hide the label (the value keeps it in its tooltip and accessible name) → drop the lowest-priority element → switch to a denser variant. Hero text auto-fits by font size and width axis within bounds. User data (song titles, event names, headlines) may end in an ellipsis at a word boundary; labels and values never do.
- **Fill every size.** Each supported size has a designed layout with no dead areas. 1×1 and 2×1 are glanceable complications; L and XL become small dashboards with charts and lists.
- **Motion**: staggered spring entrances; value changes as odometer or crossfade; on hover a lift or a 3-D tilt with the specular highlight following the pointer (the user's choice); press at 0.97; shared-element morphs between size layouts while resizing. Reduced motion and "idle means no frames" still hold.

### 3.3 Glass 2.0 and see-through widgets
My requirement: **the wallpaper must stay visible through the widgets**, as much as the user wants.

- **Blur from 0 to 100, where 0 means no blur at all.** Today every surface samples the quarter-resolution pre-blurred texture, so the wallpaper is never sharp. Replace it with a blur pyramid (several pre-blurred levels, built once per wallpaper change in core or on the GPU, for example dual Kawase) and interpolate per surface.
- **Two ways to be see-through; decide with a spike and an ADR.** (a) True alpha: the layer window is already transparent, so a partially transparent tint lets the real desktop show through. It is the cheapest, but desktop icons under a widget show through too. (b) Sampling a full-resolution wallpaper texture at blur 0: this hides desktop icons but costs texture memory. Measure both on `eDP-1` at `dpr=2` plus `HDMI-2`, pick the default, and offer the other if it is worth it.
- **Tint from 0 to 100, independent of blur**, with a tint color, gradient tints and a one-control "Frosted ↔ Clear" quick slider.
- **Material controls**: refraction strength and band width, subtle chromatic dispersion at the edge, the specular highlight's angle, intensity and width, rim width, color and gradient, inner glow, depth (shadow color, blur, offset, spread), and grain.
- **Readable without killing transparency.** Today legibility raises the tint until text reaches 4.5:1, which fights see-through widgets. In 2.0 adapt the text first: its color from the local wallpaper luminance (refine the 8×8 luminance grid around widgets), a soft halo or shadow, and optional vibrancy-style text that takes the backdrop's hue. Raise the tint only as the last step and only while "Keep text readable" is on. The inspector shows each widget's measured contrast and warns below 4.5:1 instead of silently changing the look.
- **Desktop look quick modes** on the Edit toolbar and in Settings (originally designed, inspired by iOS home-screen customization): Glass · Clear · Tinted (one color for every widget) · Dark · Light · Dimmed, plus one master transparency slider that scales every widget relative to its own setting.
- The default Opaline theme is noticeably more see-through than 1.1. We tune it together at the Phase 1 sign-off.
- System high contrast and reduce transparency still win (opaque surfaces).

### 3.4 Widget Lab
- A theme switcher; every widget × size × theme × state over at least one light and one dark wallpaper.
- Baselines for every first-party theme.
- Automatic checks on every baseline: **zero truncated labels** (the test fails on any clipped or ellipsized label or value) and **contrast** measured from the screenshot.

---

## 4. One composition engine for every widget

### 4.1 The model
A widget is a **composition**: a tree of containers and blocks.
- **Containers**: stack, row, column, grid, overlay, spacer; padding, gap, alignment; container queries for in-between sizes.
- **Blocks**: Text (templates); Number (odometer or fade, units); Icon (Material Symbols variants, app icons from the system icon theme); Image (local file, album art, app icon, asset); Shape (any of the 35 shapes or a custom path, can morph); Ring/Gauge (arc, thickness, caps, segments, wavy, gradient, ticks, needle); Bar (horizontal or vertical, segmented, stacked); Chart (line, area, bars, step, dots; smoothing, gradient fill, min/max markers; extend the in-house chart code); Heatmap; List (repeats a template for each item of an array: processes, containers, events, headlines); Progress (linear, wavy); Button, Toggle, Slider and Text input (interactive, sending validated commands); Divider; Canvas (built-in visuals: visualizer, analog dials, weather sky, photo frame); and Plugin (§9).
- Every block has **bindings** (expressions, §4.3), a **style** (§5.1), a **role** (`hero`, `title`, `label`, `value`, `caption`, `accent`, …) that themes target, visibility conditions, a priority (§3.2) and an accessible name.
- **Per-size layouts**: one layout per supported size class, plus breakpoints for free sizes (§7). Blocks keep stable ids across layouts so that resizing morphs them.
- Rendering stays inside the existing rules: one rAF scheduler, glass positions from the same tick, and no frames while idle or covered.

### 4.2 First-party widgets are compositions
Rebuild all 14 widgets, and every new one, as compositions plus built-in Canvas blocks, in their new designs (§8). The data side of `WidgetDef` stays: fields become named bindings; `status`, states and actions stay; `options` become content settings. Any widget can be opened in the builder ("Customize layout…") and forked into a custom widget. `StatLayout` survives only inside the Classic theme.

### 4.3 Expressions and templates
A small, safe language with its own parser and evaluator (no `eval`, no `new Function`). Expressions are compiled once and re-evaluated only when an input changes.
- Templates: `"{cpu.load | round}%"`, `"{weather.temp | unit('°C')} · {weather.condition}"`.
- Arithmetic, comparisons, `if(cond, a, b)`, `clamp`, `map(x, inMin, inMax, outMin, outMax)`, rounding and string functions; locale-aware number, date, duration, byte and unit formatting (Intl); `ramp(value, 'thermal')`; color functions (`mix`, `alpha`, `lighten`); history over core's rings (`avg(topic, '5m')`, `min`, `max`, `delta`); time (`now`, `format(now, 'HH:mm')`, `until(event)`, `sunrise`).
- Typed. Errors show in the builder at the right spot and as an "unavailable" state on the card, never as a crash. Fuzz the parser.
- Core needs the same language for automation rules (§10). Keep one grammar, documented in `docs/EXPRESSIONS.md`, with a conformance test suite that both implementations (TypeScript and Rust) must pass.

### 4.4 Data sources
All data still comes from core: webviews keep zero network access and cannot start processes. Besides the built-in topics, core gets **custom sources**. Each is defined in a file and sampled under the engine's existing rules (only while a widget uses it, cost classes, back-off, `catch_unwind`):
- **Command**: an argv array (a shell only if the user explicitly chooses "run in shell"), interval, timeout, output size limit and an environment allowlist; output parsed as text, lines, JSON, CSV or regex captures.
- **File**: watched with inotify; text, JSON, CSV, Markdown or todo.txt.
- **HTTP/JSON**: through core's client, with JSONPath selection, interval, ETag/If-Modified-Since and headers. Secret values (tokens, API keys) live in the GNOME keyring through the Secret Service (for example the `oo7` crate; verify), never in plain JSON, exports, logs or `--diagnose`. HTTPS by default; plain `http://` only for loopback and private-LAN addresses after an explicit per-source opt-in (needed for a local n8n, by default at `localhost:5678`, or a Home Assistant on the LAN). Always block link-local and cloud-metadata addresses. (`http.rs` is HTTPS-only today; extend it deliberately.)
- **D-Bus**: read a property or follow a signal on the session bus; the system bus read-only behind an allowlist.
- **MQTT**: topics, with optional TLS and credentials in the keyring (for example `rumqttc`).
- **Variables**: named values pushed from outside through the CLI or D-Bus (§10), like eww's `update`: `opaline ctl set var.build green`.
- **Integrations**: first-party sources with sign-in and pickers (GitHub, Home Assistant, n8n, feeds, EDS tasks; §8).

Every source has a status (ok, error with message, waiting, needs approval), a last-run time, "Run now" and a log, in the builder and in Settings → Data sources. Add per-source cost to `--diagnose` and Diagnostics.

### 4.5 Trust for custom sources
Sources the user creates on this machine are trusted as the user. Sources that arrive in an imported theme, widget, rice or plugin are **off until approved**: the dialog shows the exact command line, file paths, hosts and D-Bus names. Approval is remembered per package version and asked again whenever any of them changes.

---

## 5. Styling, themes and files

### 5.1 Style model 2.0
Extend ADR 0011 into a cascade: built-in tokens → theme → global user style → widget kind → widget instance → element (by role or block id). Every layer is optional ("inherit"), with origin labels and resets as today. Make TypeScript ↔ Rust parity mechanical (generate one side or test it), so the three places named in `CLAUDE.md` can't drift.

New controls on top of the existing 42:
- **Surface**: card shape (a rounded rect with corner smoothing for continuous squircle corners, per-corner radii, or any library shape); background (glass, tinted, clear/frameless, solid, linear/radial/conic gradient with 2–4 stops, a local image with fit, position, blur and dim, album art); the glass controls of §3.3; border (width, color, gradient, glow); shadow (color, blur, offset, spread, inner); overall opacity.
- **Typography per role** (hero, title, label, value, caption): family (bundled or any installed font), weight, width, size, tracking, case, line height, color, opacity, and OpenType features (tabular figures, slashed zero, stylistic sets).
- **Icons**: set (Material Symbols Rounded, Outlined or Sharp, all Apache-2.0, or none), fill, weight, grade, size, color.
- **Hero visuals**: ring, gauge, bar, chart, number, shape badge, liquid fill or dot matrix, each with its own options (thickness, caps, track, segments, wave, gradient, ticks, needle, smoothing, fill).
- **Layout**: padding, gap, alignment, header style (glyph + title, title, glyph, none), density.
- **Effects**: hover (lift, tilt with specular, glow, none), press, entrance, value animation (odometer, fade, none), ambient motion.
- **Behavior**: click, double-click, middle-click and scroll actions (detail view, open an app, open a URL, run a local command, toggle, change a value, nothing); tooltip; **auto-hide when empty** (Now Playing with nothing playing) with reflow; visibility per profile and workspace (§10).
- **Conditional styles**: ordered rules "when ⟨expression⟩ → set ⟨style keys⟩", optionally animated (for example `cpu.temp >= 85` → an error-colored border, the burst shape and a pulse), previewable in the inspector.

System settings (high contrast, reduce transparency, reduced motion, text scale) still override, and the legibility rules of §3.3 apply.

### 5.2 Themes and rices as files
- A theme is a folder or a `.opaline-theme` zip: `theme.json` (`$schema`, id, name, author, version, license, description, preview images, minimum Opaline version), tokens (color source and scheme or a fixed palette, type scale, shape language, motion personality, glass defaults), style layers (global, per kind, per role or element), optional layouts per widget kind, optional fonts (license files required), images, and an optional `theme.css`.
- Locations: first-party themes in `/usr/share/opaline/themes/`, installed ones in `~/.local/share/opaline/themes/`, the user's own in `~/.config/opaline/themes/`. All watched and live-reloaded.
- **"Save this look"** exports the current desktop as a theme, with secrets stripped. A **rice** is a theme plus layout, custom widgets, sources and profiles, shareable as one package. Layout positions in a rice are stored relative to work-area anchors so they fit other screens.
- Switching themes animates: palette and shape springs, a crossfade for type.
- Versioned schemas with migrations. A broken or partial theme falls back key by key, shows a non-blocking error with file and JSON path, and never blanks the desktop.

### 5.3 User CSS: the escape hatch
- `~/.config/opaline/user.css` and each theme's `theme.css` are injected after the design system and live-reloaded.
- A documented, stable contract in `docs/THEMING.md`: data attributes on every widget and block (`data-kind`, `data-size`, `data-role`, `data-block`, `data-state`, `data-theme`) and the CSS custom properties.
- The CSP still blocks remote URLs; local assets only. The glass is drawn by WebGL, so CSS styles the content, not the glass (document this).
- `opaline --safe-mode` (and a key held at startup) starts without user CSS, custom sources and plugins.

### 5.4 Config as files
- Watch `settings.json`, `layouts.json`, themes, custom widgets, sources and profiles. Apply outside edits live, and ignore Opaline's own writes (by content hash) so nothing loops. Validate, report problems in a toast with file and JSON path, and keep the last good state.
- Generate JSON Schemas from the Rust types (for example with `schemars`), install them to `/usr/share/opaline/schemas/`, and write `$schema` into every file so VS Code autocompletes and validates.
- Document every file in `docs/CONFIG.md`.

---

## 6. Editing experience

### 6.1 One live inspector
Replace both customizers with one **Inspector**: a floating glass panel next to the selected widget in Edit mode, placed so it never covers the widget, and dockable to a screen edge. Tabs:
- **Look**: one-click style chips from the theme (Glass, Clear, Tinted, Solid, Gradient, Shaped, Bold, Minimal), then the essentials (transparency, blur, tint, shape, accent, font, size), then "More" with everything in §5.1.
- **Content**: fields, order (drag), names, hero and hero style, units, decimals, source (which GPU, drive, interface, player…), thresholds, update rate, and the widget's own options.
- **Data** (custom widgets): bindings and sources, with live values.
- **Behavior**: actions, conditional styles, visibility, auto-hide.
- **Advanced**: every raw key with its origin and reset, a JSON view validated against the schema, and the widget's CSS selector with a copy button.

Every change previews live on the real desktop with springs and is part of undo/redo (in 1.1 undo covers layout only). Changes apply to this widget, all widgets of this kind, all widgets, or the current theme (which forks it into a user theme). Add copy and paste style (Ctrl+Shift+C / Ctrl+Shift+V), an eyedropper (from the wallpaper or another widget), the contrast meter and "Reset to theme". Load the inspector and builder code only in Edit mode.

### 6.2 Edit mode upgrades
Multi-select (Shift/Ctrl-click and rubber band); group move, align and distribute; duplicate (Ctrl+D); copy and paste widgets, also between monitors; lock; z-order in free mode; numeric position and size in the inspector; arrow nudge (one cell on the grid; 1 px, or 10 px with Shift, in free mode); "Tidy up"; the Desktop look modes and the theme switcher on the toolbar. Smart Stack rules become editable, using the rule engine of §10.

### 6.3 Widget Gallery (replaces the picker)
Large live previews with real data at every size (swipe between sizes like Android, a size row like macOS), search, categories (System, Controls, Time & Personal, Media & Photos, Weather & Ambient, Developer & Online, Custom, Community), "Your widgets", "From themes and plugins", availability reasons, and click or drag to place.

### 6.4 Settings window
Settings keeps the global things; widget-level controls move to the inspector. Add search across every setting (with deep links) and these sections: Looks (themes and rices), Widget defaults (global style), Data sources, Accounts & integrations, Profiles & automation, Plugins & gallery, Keyboard shortcuts (every action, with conflict detection), and Backup (now including themes, custom widgets and sources, secrets excluded). Keep the existing sections.

### 6.5 Onboarding
Add "Pick a look" with live previews over the real wallpaper, and point to the inspector and the gallery. Seven steps at most.

---

## 7. Placement: grid plus free mode

- Each monitor is either **Grid** (default) or **Free**.
- Grid: today's engine plus a cell-size option (for example 72, 84 as today, 96 or 112 px) and more size classes where widgets support them (for example 1×2, 2×3, 6×4; decide in the plan).
- Free: pixel positions and any size within each widget's minimum and maximum; smart alignment guides (edges, centers, equal spacing, monitor center, safe margins); snapping to guides, other widgets or a soft grid (hold Alt to disable); overlap with z-order; lock; groups.
- Free positions are stored as an anchor plus an offset relative to the work area (for example top-right + 24, 24), so resolution, scale and monitor changes keep the arrangement.
- Switching Grid → Free keeps positions; Free → Grid snaps with the existing minimal-movement resolver.
- Compositions handle in-between sizes with container queries and their size breakpoints.
- Input regions and glass follow each widget's shape bounds, and overlapping widgets hit-test top-most first. Stacks work in both modes.

---

## 8. Widgets

### 8.1 Redesign the 14 existing widgets
Each gets a signature layout for every supported size, every new style control, a detail view rebuilt as a composition (charts, lists, actions), and these content additions:
- **Clock**: faces: Digital (bold, inline or stacked), Expressive (digits on shapes), Analog (minimal, classic, numerals, Roman, a chronograph with sub-dials, an original railway-style dial), Flip, Word clock, Typographic (big hour, small minutes), Segment/LCD, Binary, Terminal (`date` style), Day ring (progress through the day), and a Big date tile. Per-element colors (hands, ticks, numerals), a second hand that sweeps, ticks or hides, a date format (ICU skeleton), a second time zone, and an optional subline (next event or a running timer).
- **CPU**: hero choice: thermal shape badge, load ring or gauge, per-core bars or heatmap, chart; a per-core grid at L/XL; temperature source (package, core, Tctl/Tccd); frequency as average, maximum or per core; top processes with app icons; power when available; a throttling badge.
- **Memory**: a liquid-fill hero whose surface gets choppier with memory pressure; a stacked composition bar (apps, cache, buffers, shared, free, swap, zram/zswap); top apps with icons; GB or GiB.
- **GPU**: iGPU and dGPU side by side at M and larger; engines (3D, video, copy); a VRAM bar; power against the limit as a gauge; clocks, fan, top apps; an elegant asleep state (moon, "Asleep · 0 W"). Never wake a sleeping dGPU.
- **Storage**: several drives as bars or rings, a health badge, temperatures, an I/O chart, include/exclude mounts, sorting, eject and power off.
- **Network**: a dual-wave hero whose speed follows throughput; today's and this month's usage against a cap as a ring; Wi-Fi signal as a shape; a VPN badge; latency with jitter; per interface; privacy toggles for SSID and IP.
- **Battery & Power**: a liquid pill with bubbles while charging; time to full or empty; health; charge-limit status if UPower exposes it here (verify); peripherals with device icons; a power-profile switch.
- **Fans**: a fan glyph spinning in proportion to RPM (static under reduced motion and while dimmed), per-fan gauges, and the related CPU/GPU temperature.
- **Processes**: real app icons from the system icon theme (fix the ⠿ fallback); CPU, RAM, GPU and disk I/O columns; grouping by app or process; filters; End task with confirmation.
- **Now Playing**: album art as a blurred glass background (optional), shape masks that breathe with the bass, original vinyl- and cassette-style looks, shuffle, repeat and volume (MPRIS), a player switcher, local `.lrc` lyrics when a file sits next to the track (optional), wavy progress.
- **Visualizer**: heavy styles rendered with WebGL; add a circular spectrum around album art, a spectrogram/waterfall, analog VU needles, LED segments and particles. An oscilloscope and stereo split need new waveform and per-channel frames from core (design the IPC frame format). Still ≤ 3 % CPU at 60 fps.
- **Weather**: sky backgrounds that follow the condition and time of day (subtle and reduced-motion safe); an hourly temperature curve with precipitation bars; a 10-day forecast with temperature range bars; AQI, UV and pollen (Open-Meteo air quality, Europe; verify); a sunrise/sunset arc; moon phase; tiles for feels-like, wind and humidity; several locations, stacked or rotating. Weather warnings only if a free, keyless, properly licensed source exists for the location (verify; otherwise skip).
- **Calendar**: a date tile, a month grid with event dots, an agenda with color bars, a countdown to the next event, a "Join" button for meeting links (Meet, Zoom, Teams and Jitsi URLs in the location or description), tasks (§8.3), and a week view at L/XL.
- **Docker**: Compose groups with health, published ports (open `localhost:<port>` in the browser), a log tail in the detail view, resource charts, and Podman parity.

### 8.2 Quick controls (new, category Controls)
- **Toggles**: Wi-Fi, Bluetooth, Airplane mode, Do Not Disturb, Night Light, Dark style, Keep awake, microphone mute, power profile, VPN connections, plus any boolean GSettings key the user picks (advanced).
- **Sliders**: output volume (with a device switch), input volume, display brightness, keyboard backlight.
- **Launchers**: apps (from `.desktop` files, with real icons), folders, files, URLs and local commands.
- Use the same interfaces as GNOME Shell's Quick Settings, verified on GNOME 50: NetworkManager (Wi-Fi, VPN); `org.gnome.SettingsDaemon.Rfkill` (airplane mode, Bluetooth); GSettings `org.gnome.desktop.notifications show-banners` (Do Not Disturb), `org.gnome.settings-daemon.plugins.color night-light-enabled` and `org.gnome.desktop.interface color-scheme`; `org.gnome.SessionManager` inhibit (keep awake); PipeWire/pipewire-pulse (volume, mute); and whatever GNOME 50 uses for the backlight (Mutter or gsd-power; find out).
- Optimistic UI with rollback on failure; core validates every command.
- Layouts: a Quick Settings–style grid of pill toggles, a single big toggle (1×1), slider bars, a dock-style launcher row.

### 8.3 Personal & time (new, category Time & Personal)
- **Notes**: Markdown files (by default in `~/.local/share/opaline/notes/`, or any file or folder the user picks, such as a note in an Obsidian vault). Inline editing with live rendering, checkboxes that toggle in the file, sticky-note looks, and safe writes when the file changes on disk.
- **To-do**: local Markdown checklists or todo.txt, and EDS task lists (VTODO through the same EDS D-Bus path as ADR 0010, which also covers GNOME Online Accounts). Add, complete, due dates, priorities.
- **Timers**: timer, stopwatch with laps, Pomodoro (work/break cycles, daily count), several named timers. The state lives in core so it survives layer restarts; a notification and an optional sound at the end (find a light way to play a bundled sound).
- **Countdowns**: to a date or a calendar event, plus year, month and day progress.
- **World clock**: its own widget, with up to six zones and day/night arcs.

### 8.4 Photos & ambient (new, categories Media & Photos and Weather & Ambient)
- **Photo frame**: a folder (optionally recursive) or a list; shuffle or order, interval, transitions (crossfade, Ken Burns, a shape-mask morph), fit or fill, any shape as a mask, "On this day" from EXIF dates, captions from EXIF, favorites. Core decodes and downscales each image to the widget's device-pixel size and caches thumbnails in `~/.cache/opaline/`; full-resolution images never reach the webview. Support the formats the `image` crate handles (verify AVIF, HEIC and JPEG XL).
- **Sun & moon**: today's sun path with the current position, golden and blue hour, moon phase, and rise and set times (computed offline from the weather location).
- **Quote or word of the day**: from a bundled public-domain set, or from the user's own file or feed.
- **Aura**: a decorative but data-driven gradient that follows the time of day, the weather and the wallpaper, and redraws only when its inputs change.
- **Decorations**: text labels, images, shapes and separators as tiny widgets, made straight from the builder blocks.

### 8.5 Developer & online (new, category Developer & Online)
All network traffic goes through core, every integration is opt-in, and tokens live in the keyring.
- **GitHub**: notifications, assigned PRs and issues, review requests, Actions status for chosen repos and branches, and the contribution graph. Sign-in with a fine-grained personal access token, plus the OAuth device flow if I register an OAuth app (give me the steps). Respect rate limits and use conditional requests.
- **Home Assistant**: entity states as sources and widgets; lights and switches as toggles. REST plus the WebSocket API with a long-lived token; writes go through core.
- **MQTT**: generic topic widgets.
- **Feeds**: RSS, Atom and JSON Feed headlines with site icons and unread state, opened in the browser. Render text only; no feed HTML in the webview.
- **n8n**: workflows and recent executions (success or failure), activate/deactivate, and triggering webhook workflows, through n8n's REST API with an API key. My instance runs locally in Docker Desktop (n8n's default address is `http://localhost:5678`; check the port mapping) and is reached through the loopback opt-in (§4.4).

### 8.6 Typing inside widgets
Notes, to-dos and text fields need keyboard focus in the layer window. Verify on GNOME 50, in Native and Instant mode, how the layer can take keyboard focus on click without rising above normal windows, and how it gives focus back on Escape or a click elsewhere. If that isn't possible, edit in the raised detail view instead. Record the result in an ADR.

---

## 9. Plugins and the community gallery

### 9.1 Two kinds of packages
- **Declarative packages**: themes, rices, custom widgets and source definitions. JSON, assets and expressions; no code.
- **Code widgets** (JavaScript/TypeScript): for visuals or logic the composition engine can't express.

### 9.2 Sandbox for code widgets (spike and ADR before building)
The preferred design is one Web Worker per plugin, created from the package's bundled script, with no DOM, no Tauri IPC and no network (CSP `connect-src 'none'`; verify that it applies to workers in WebKitGTK). It talks through a narrow message bridge: it receives only the topics and sources its manifest declares, and it returns a composition tree in the §4 format. For custom visuals it may draw into a transferred OffscreenCanvas (verify WebKitGTK support in workers). The alternative is a sandboxed iframe with an opaque origin.

Whichever you choose, prove it with a hostile test plugin. It must not reach `__TAURI_INTERNALS__` or any IPC, the network, other widgets, storage or navigation. A busy loop or a memory blow-up must be detected and the plugin stopped (watchdog, heartbeat, limits) without affecting other widgets.

### 9.3 Manifest and permissions
Id, name, version, author, license, minimum Opaline version, entry points, sizes, translations, and permissions: topics, custom sources (exact commands, hosts and paths) and the actions it may request. Network access only through core sources. The user approves the permissions on install and again on every change.

### 9.4 The gallery
- An in-app browser for themes, rices, widgets and plugins, backed by a GitHub index repository (for example `ali-kenjo/opaline-gallery`): an `index.json` plus packages, each with a SHA-256 checksum and a minisign signature from the gallery key (reuse the updater's verification code).
- Contributions arrive as pull requests that I review. Write the contribution guide and a CI check that validates submitted packages against the schemas.
- The app fetches the index only while the gallery is open: no background requests, no accounts, no telemetry. Install, update (checked on open), remove; packages can also be installed from a file.

### 9.5 Tools for authors
`opaline pack <dir>`, `opaline validate <dir>`, a developer mode in the builder that hot-reloads a local package folder, and `docs/SDK.md` with a template plugin.

---

## 10. Profiles, automation and scripting

- **Profiles**: a named set of layout (per monitor), theme, Desktop look, appearance state, performance mode and widget visibility. Switching animates: widgets fly and morph to their new places.
- **Rules**: "when ⟨conditions⟩ → activate a profile, run an action or send a notification", evaluated in core with the shared expression grammar. Conditions: time and weekdays, sunrise/sunset, battery level and AC, power profile, the connected monitor set (docked or not), the active workspace, the focused app, an app running or in fullscreen, network/SSID/VPN, Do Not Disturb, screen locked, idle, and any variable or source value. Hysteresis and minimum durations so rules never flap; a manual override with "Resume automation".
- **Per-workspace layouts and the focused app** need the helper's help: Shell1 API v2 with `ActiveWorkspaceChanged` and `FocusedAppChanged` signals, keeping N−1 compatibility as in 1.0 (tell me when a re-login is needed). In Instant mode use EWMH (`_NET_CURRENT_DESKTOP`) through Xwayland if it works (verify).
- **CLI**: `opaline ctl …` over D-Bus: get and set settings and styles by JSON path; list, add, remove and move widgets; switch profile, theme and look; set variables; run widget actions; Peek and Edit; export/import; pack and validate packages. `--json` output, and bash, zsh and fish completions in the `.deb`.
- **D-Bus API v2**: `io.github.ali_kenjo.Opaline1` gains the same operations plus signals (`ProfileChanged`, `ThemeChanged`, `VariableChanged`, `WidgetAction`). Versioned, every argument validated, documented in `docs/DBUS.md`.
- **Shortcuts** for profiles, looks, Peek per monitor and "toggle widget X".

---

## 11. Phase 0: stabilize before redesigning

1. **Memory.** Measure the trend (fresh start, after Edit, after 1 h, after 8 h) with `scripts/measure-budget.sh`, find what grows (web process 248 MB, core 70 MB) and fix it. Suspects: full-work-area `dpr=2` EGL buffers kept after the Edit/Peek backdrop, GL textures and canvases not released, state retained across Edit sessions, history buffers, caches, and the 1.1 visualizers. Get back to ≤ 280 MB with the default layout, or bring me numbers and options. Add a long-run memory check to the scripts.
2. **UI tests** with Playwright against the Lab or a stub host: Edit mode (add, drag, resize, stack, remove, undo, keyboard), the picker, detail views, Settings and Onboarding. These come before any refactor.
3. **Split `LayerApp.tsx`** into a drag/resize controller, a selection model, the toolbar, grid items and overlays, with no change in behavior.
4. **Small fixes**: the grid numbers in `PROGRESS.md` (it says 96/16; the code uses 84/12); the `fans` provider's cost label (405 ms per sample while declared cheap); a backoff ceiling for the Instant-mode layer restart loop; and confirm that the updater refuses a release without a valid signature.

---

## 12. Performance, privacy, security and quality

- **Budgets** (enforced, measured and recorded every phase): idle CPU ≤ 0.5 %, covered ≤ 0.1 %, visualizer ≤ 3 % at 60 fps, widgets visible ≤ 1.5 s after core starts, no dropped frames while dragging, resizing, morphing or switching themes, never wake a sleeping dGPU, and RAM ≤ 280 MB PSS with the default layout. Every new feature states its cost (photo frame, blur levels, extra fonts, plugins, sources); the inspector, builder and gallery load only while used. Diagnostics shows the cost per widget and per source.
- **Idle means zero frames**: animated skies, Ken Burns, auras and spinning fans animate only while visible and not covered (and while dimmed only if the user allows it).
- **Privacy**: every network feature is opt-in per integration (as in 1.x, weather starts after choosing a location and update checks are opt-out). README and Settings list them all. The gallery only connects while it is open.
- **Security**: update `docs/SECURITY.md` with a threat model covering imported packages, code plugins, command/HTTP/MQTT/D-Bus sources, user CSS, D-Bus API v2, quick-control writes and secret storage. Tests: a hostile plugin, a theme with remote CSS, command injection through templates or package fields, SSRF to link-local addresses, zip-slip in packages, oversized files. Redact the new data (URLs, hosts, paths, tokens) in `--diagnose` and the logs.
- **Accessibility**: the inspector and builder are fully keyboard-operable with screen-reader labels; custom widgets get an accessible name (generated from their bindings, editable); the contrast meter; reduced motion respected everywhere.
- **i18n**: every new string in English, German and Arabic, covered by the parity test; packages can bring their own translations; RTL for the inspector and builder; grid positions still never mirror.
- **Tests**: the expression evaluator (unit, conformance, fuzz), the composition renderer, style-cascade parity TypeScript ↔ Rust, package validation, migrations from real 1.1 files (as fixtures), Playwright for the inspector, builder, gallery and free mode, and Lab baselines per theme.

---

## 13. Build order (everything is in scope for 2.0)

| Phase | Scope | Acceptance |
| - | - | - |
| **P0 Stabilize** | §11 | ≤ 280 MB with the default layout (or my decision on new numbers); UI tests green; `LayerApp.tsx` split with no behavior change |
| **P1 Design language & glass 2.0** | Start with three visual directions for the Opaline theme, shown on the same four widgets in the Lab; I pick one. Then `DESIGN-2.md`, the type scale, the anatomy and responsive rules (§3.2), glass 2.0 and transparency (§3.3), Desktop look modes, the Lab theme switcher and checks | Zero-truncation and contrast checks pass; at blur 0 and tint 0 the wallpaper shows through sharp, and text stays readable or the contrast warning appears; my visual sign-off |
| **P2 Composition engine** | The model, blocks, per-size layouts, expressions with the conformance suite, bindings to topics | Evaluator and renderer tests pass; Clock rebuilt on the engine with no regression in behavior or budgets |
| **P3 Redesign the 14 widgets + looks** | §8.1 on the engine; the nine first-party themes (§3.1) | My sign-off per widget and per theme; Classic matches the 1.1 baselines |
| **P4 Styling, themes & files** | Style model 2.0 with conditional styles, theme and rice packages, "Save this look", user CSS, live-reloaded config, JSON Schemas | Editing a theme in VS Code updates the desktop live, with autocomplete; a broken file never blanks the desktop |
| **P5 Editing experience & placement** | The inspector, Edit mode upgrades, the Widget Gallery, Settings search and consolidation, the onboarding look step, free mode (§6–§7) | Everything works with mouse, touchpad and keyboard; style changes undo and redo; my sign-off |
| **P6 Custom sources & builder** | Command, file, HTTP, D-Bus, MQTT and variable sources; approvals; the keyring; the builder UI; forking any widget | A widget built from a shell command, a file, my local n8n, a D-Bus property and an MQTT topic; imported sources stay off until approved |
| **P7 New widgets** | §8.2–§8.5, built on the engine | Each works here with real data (Wi-Fi/Bluetooth, volume, brightness, notes in a real folder, EDS tasks, a photo folder, GitHub with my token, n8n, a feed); Home Assistant and MQTT tested against instances in Docker if I have none |
| **P8 Profiles, automation, CLI, D-Bus v2, helper v2** | §10 | Rules switch profiles without flapping; `opaline ctl` covers everything; per-workspace layouts work after a re-login |
| **P9 Plugins & gallery** | §9 | The hostile-plugin suite passes; installing from the gallery checks signatures; the author tools work |
| **P10 Quality & release** | i18n, accessibility, budgets, security review, 1.1 → 2.0 migration on this laptop and on a clean VM, README media, a signed `v2.0.0` | All checks pass; budgets recorded; clean-VM install, upgrade and uninstall work; my sign-off |

You may reorder or parallelize phases if the plan justifies it, but P0 comes first and P2 comes before any widget redesign.

---

## 14. Non-goals for 2.0
- Desktops other than GNOME (keep `DesktopBackend` open for a layer-shell backend later).
- Flatpak and Snap.
- Native-code plugins (shared libraries) and plugins with their own network access.
- Accounts, cloud sync, a ratings or comments server for the gallery, telemetry.
- Hardware writes beyond the quick controls (§8.2), power mode, Docker actions, End task, eject, and the Home Assistant entities the user wires up. Still no fan, RGB or clock control.
- Rotating whole widgets (rotation inside a composition is fine).

---

## 15. Spikes and pitfalls to settle early
- **Transparency**: true alpha vs. full-resolution sampling, and the memory cost of the blur pyramid (§3.3).
- **WebKitGTK features**: OffscreenCanvas in workers, CSP in workers, CSS container queries, variable-font axes on system fonts. Don't rely on `backdrop-filter` for the desktop glass.
- **Keyboard focus** in the layer window, in Native and Instant mode (§8.6).
- **GNOME 50 APIs** for brightness, volume and Bluetooth, the way Quick Settings does it.
- **The plugin sandbox** proof (§9.2).
- **Memory per feature**: blur textures, the photo frame, fonts, workers.
- **Style-key parity** between TypeScript and Rust, made mechanical.
- **Helper API v2**: needs a re-login and must keep N−1 working.
- **Live-reload loops** caused by Opaline's own writes.
- **Expression cost**: compile once, evaluate on change only.
- **Secrets** never in settings, exports, logs or `--diagnose`.

---

## 16. Start now
1. Read this file completely, then the files listed in §0 (rule 1).
2. In plan mode, write `docs/PLAN-2.md` (including the spikes of §15) and an outline of `docs/DESIGN-2.md`.
3. Stop and ask me for approval before writing Phase 0 code.

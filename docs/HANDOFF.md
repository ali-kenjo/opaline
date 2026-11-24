# Handoff: where Opaline stands (2026-11-24)

For whoever continues this work (person or AI tool). Read this first, then `CLAUDE.md`, `OPALINE_BUILD_PROMPT.md`
(the brief), `docs/PLAN.md` and `docs/PROGRESS.md`. Decisions are in `docs/adr/` (0001–0011).

## The project in one paragraph
Opaline is a desktop-widgets app for Ubuntu 26.04 / GNOME 50: glass widgets on the wallpaper, above the desktop
icons and below windows. Rust core (sensor engine, settings, layouts, IPC, D-Bus) + Tauri 2 layer process (one
transparent WebKitGTK window per monitor, React 19 frontend) + a small GNOME Shell helper for "Native mode". Built
phase by phase (P0–P8 in the brief); each phase ends with acceptance checks, a PROGRESS note and the owner's sign-off.

## Phase status
| Phase | State |
| - | - |
| P0 Foundations | ✅ done |
| P1 Sensor engine | ✅ done |
| P2 Design system & Widget Lab | ✅ signed off |
| P3 Widgets (14, fully customizable, ADR 0011) | ✅ signed off 2026-11-24 |
| P4 Layer & desktop integration | ✅ signed off 2026-11-24 |
| P5 Edit mode & layout engine | ✅ signed off 2026-11-24 |
| P6 Product shell | ✅ signed off 2026-11-24 |
| P7 Quality (German & Arabic RTL, a11y, budgets, security, fault isolation) | ✅ signed off 2026-11-24 |
| **P8 Release** | **packaging, CI/Release workflows, README & `.deb` built & verified; awaiting owner VM test, minisign key & `v1.0.0` go-ahead** |

## Phase 5: implemented
- **Core (`crates/opaline-core/src/layouts.rs`, `json.rs`, `commands.rs`, `ipc_server.rs`, `hub.rs`, `opaline-ipc`):**
  - Versioned `~/.config/opaline/layouts.json` with atomic writes, migration, and validation of bounds, overlaps, and stacks.
  - `Command::UpdateLayouts` and `Command::History` (queries in-memory ring + SQLite rollups).
  - `patch_to_json` emits JSON integers for integral `f64` values from IPC so `u32` coordinates deserialize cleanly.
  - `"layouts"` added to `ALWAYS_PUSH` so layouts load even when starting behind maximized windows.
- **Layer Rust bridge (`app/src-tauri/src/layer/bridge.rs`, `client.rs`, `mod.rs`):**
  - Shared Edit mode across all monitors (`layer_set_edit`, `LayerEvent::Edit`) and full `monitors` list in `LayerEvent::Connected`.
  - Caches and replays `CoreEvent::LayerCovered` and `CoreEvent::DesktopFocusChanged` to windows attaching after initial connect.
- **Helper (`desktop-integration/stacking.js`):**
  - Clears `_covered` map when layer windows go away so a restarted core receives fresh covered state (installed to `~/.local/share/gnome-shell/extensions/opaline-desktop@ali-kenjo.github.io`; activates on next GNOME Shell login).
- **Frontend (`app/src/layer/` & `app/src/design-system/glass/`):**
  - Grid engine (`grid.ts`, `grid.test.ts`): 96 px cells / 16 px gutters, collision reflow, nearest-free search, refit, stacking overlap, monitor matching, waiting monitors, neighbor lookup.
  - Edit mode (`LayerApp.tsx`, `SpringSlot.tsx`): blurred backdrop, dot grid, bottom toolbar (`Add widget · Presets · Settings · Undo · Redo · Done`), 450 ms long-press drag, spring reflow with `useGlassSync()`, 4 pill resize handles, Remove drop zone + `–` badges + 5 s Undo snackbar, `Ctrl+Z`/`Ctrl+Shift+Z`/`Ctrl+Y`, keyboard nav, 600 ms edge-hold & context-menu cross-display moves, glass right-click menu.
  - Stacks (`StackWidget.tsx`): wheel/swipe flipping, dots indicator, Smart Rotate, `StackEditor` sheet.
  - Widget Picker (`WidgetPicker.tsx`): search, categories, live previews at each supported size, availability reasons, click-to-place & drag-to-place.
  - Starter presets (`presets.ts`, `presets.test.ts`): Essentials, Performance, Creator, Developer, Minimal + Phase 4 migration.
  - Detail views (`DetailModal.tsx`): shared-element spring morph, 15 min / 24 h history chart, all fields, actions, Customize button, alert deep-linking (`CoreEvent::AlertOpened`).
  - Tight WebGL2 canvas (`GlassStage.tsx`, `compositor.ts`): shrinks canvas to widget bounding box + 48 px margin outside Edit/Peek (`1×1` hidden on empty monitors) and skips no-op `setPlacement` redraws.

## State of the machine right now
- Release binary `target/release/opaline` is built and running under `systemd-run --user` (`opaline-p5-fresh.service`) in Native mode.
- `~/.config/opaline/layouts.json` is live-migrated with the 4 starter widgets on `eDP-1`.
- Helper in `~/.local/share/gnome-shell/extensions/opaline-desktop@ali-kenjo.github.io` is up to date.
- Remember when launching `opaline` from an integrated VS Code terminal: the Snap environment leaks `GSETTINGS_SCHEMA_DIR`/`GTK_PATH`; launch via `systemd-run --user --unit=<name> --collect ./target/release/opaline` or a regular GNOME Terminal.

## Next steps
1. Get the owner's visual & interactive sign-off on Phase 5 (and mark P5 signed off in `docs/PROGRESS.md`).
2. Start **Phase 6: Product shell** (`docs/PLAN.md` 6.1–6.5): first-run onboarding, Settings window (wire Edit toolbar's Settings button & tray Settings item to it), autostart, export/import settings & layouts, and update check.

## How to work here (essentials; details in CLAUDE.md)
- Commits: conventional, author `ali-kenjo <285495463+ali-kenjo@users.noreply.github.com>` (repo git config),
  **no Co-Authored-By / "Generated with" lines**. Push to `main`; CI (GitHub Actions) must stay green.
- Checks: `cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings && cargo fmt --all --check`;
  `cd app && pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`; `pnpm lint:helper`.
- Builds: `cd app && pnpm tauri build --debug --no-bundle` (or `--no-bundle` for release).
- Run: `./target/release/opaline`, `--quit`, `--peek`, `--edit`, `--diagnose`, `--dump <prefix>`.
- Never `pkill -f 'opaline --layer'` from a shell command (it matches the shell itself).
- Real data only in the product; mocks only in tests and the Lab. The owner prefers plain, short explanations.

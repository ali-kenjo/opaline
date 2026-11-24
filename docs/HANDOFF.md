# Handoff: where Opaline stands (2026-11-24)

For whoever continues this work (person or AI tool). Read this first, then `CLAUDE.md`, `OPALINE_BUILD_PROMPT.md`
(the brief), `docs/PLAN.md` and `docs/PROGRESS.md`. Decisions are in `docs/adr/` (0001–0011).

## The project in one paragraph
Opaline is a desktop-widgets app for Ubuntu 26.04 / GNOME 50: glass widgets on the wallpaper, above the desktop
icons and below windows. Rust core (sensor engine, settings, IPC, D-Bus) + Tauri 2 layer process (one transparent
WebKitGTK window per monitor, React 19 frontend) + a small GNOME Shell helper for "Native mode". Built phase by
phase (P0–P8 in the brief); each phase ends with acceptance checks, a PROGRESS note and the owner's sign-off.

## Phase status
| Phase | State |
| - | - |
| P0 Foundations | ✅ done |
| P1 Sensor engine | ✅ done |
| P2 Design system & Widget Lab | ✅ signed off |
| P3 Widgets (14, fully customizable, ADR 0011) | ✅ signed off 2026-11-24 |
| **P4 Layer & desktop integration** | **in progress — see below** |
| P5 Edit mode & layout engine | not started (needs the owner's go-ahead) |
| P6–P8 | not started |

## Phase 4: done
All committed and pushed (`main`, last commit `251e78a` plus this note).
- **Shell helper** `desktop-integration/` (UUID `opaline-desktop@ali-kenjo.github.io`, GJS/ESM, `pnpm lint:helper`
  in `app/`): `layer.js` starts `opaline --layer --backend native` as a trusted Wayland client
  (`Meta.WaylandClient.new_subprocess`) while core owns `io.github.ali_kenjo.Opaline`, restarts with backoff, places
  windows by title `opaline-layer:<connector>`, hides them from the window list, sticks them, undoes minimizing;
  `stacking.js` keeps them at the bottom of the normal windows (ADR 0006), raises for Peek/Edit, reports covered
  monitors; `dbus.js` exports `io.github.ali_kenjo.Opaline.Shell1` (ApiVersion 1); `keys.js` binds Super+Alt+W/E.
  Core tells the helper which binary to start via D-Bus properties `LayerExecutable` / `LayerEnvironment`.
- **Core** `crates/opaline-core/src/desktop.rs`: Native when a helper with ApiVersion N or N−1 answers, else Instant;
  live switching; starts in the right mode (`initial_backend`); helper signals → `CoreEvent::DesktopFocusChanged`,
  covered monitors (`Hub::set_covered`, subscriptions become Covered when all monitors are covered), shortcuts →
  Peek/Edit; `Command::SetRaised`; `ensure_enabled` turns an installed helper on (Extensions API, else
  `enabled-extensions`). `app/src-tauri/src/instant.rs::control_layer` runs the Instant layer only in Instant mode.
- **Portal shortcuts** `shortcuts.rs`: GlobalShortcuts portal session only while Instant (XDG trigger format
  `LOGO+ALT+w`); registers the app ID via `org.freedesktop.host.portal.Registry`.
- **Layer page** `app/src/layer/LayerApp.tsx`: real widgets (default set `a-clock`, `b-cpu`, `c-memory`, `d-network`
  written to settings on first run) in a column at the top right of the primary monitor (temporary until the P5
  grid); glass over this monitor's wallpaper; **Peek** (raised, blurred backdrop at 0.92, hint, Esc/click to close);
  **Automatic appearance** (full on desktop focus/hover/Peek, else dimmed); input regions = widget rects (whole
  window in Peek or with the settings sheet open); page errors → layer log.
- **Verified live in Instant mode** with screen captures (`scripts/capture-monitor.py eDP-1 /tmp/x` during
  `opaline --peek`): widgets render on glass, Peek backdrop and hint, correct sizes.

## Phase 4: state of the machine right now
- The helper is **installed for the user** in `~/.local/share/gnome-shell/extensions/opaline-desktop@ali-kenjo.github.io`
  (`scripts/install-helper-dev.sh`; undo with `--remove`) and added to `org.gnome.shell enabled-extensions`.
- The owner was asked to **log out and back in**, then start Opaline by hand
  (`~/Dokumente/vs-code-projects/widgets-app/target/release/opaline`; no autostart until P6).
- GNOME may still show "Add Keyboard Shortcuts" dialogs from the Instant-mode portal tests; cancelling them is fine.
- The release binary in `target/release/opaline` is current (includes everything above).

## Phase 4: next steps
1. **Confirm Native mode after the re-login.** In `~/.local/state/opaline/logs/opaline-core.<UTC date>.log` look for
   `desktop integration backend=Native` / `helper found; Native mode`; in the shell journal
   (`journalctl --user -b -o cat /usr/bin/gnome-shell | grep -i opaline`) for `Opaline: layer started`. If the helper
   fails to load, `gnome-extensions info opaline-desktop@ali-kenjo.github.io` shows the error; fix in
   `desktop-integration/`, reinstall with the script, and it needs another re-login (or a nested session, below).
   Helper code is untested so far: expect small API fixes (it was written against Meta-18 introspection).
2. **Acceptance in both modes** (brief §10, P4): above desktop icons, below apps, on all workspaces, hidden from
   Alt-Tab / overview / dock, survives Show Desktop, clicks outside widgets reach desktop icons, switching to Native
   after a re-login without restarting Opaline. Several need the owner's eyes (they can't be captured while windows
   cover the desktop). Peek in Native goes through `SetRaised`.
3. **Plan items still open:** 4.2 tests at scale 1.0/1.25/1.5/2.0; 4.4 nested-session workflow
   (`gnome-shell --devkit` needs `mutter-dev-bin`, which was removed; needs `sudo apt install mutter-dev-bin`, ask
   first); 4.6 appearance in Native via `DesktopFocusChanged` (wired, untested); 4.7 monitor hot-plug and scale
   changes (Instant path existed since P0; recheck), covered → no rendering; 4.8 measure RAM in Native mode against
   280 MB (`scripts/measure-budget.sh 60`, ADR 0009).
4. Write the Phase 4 section in `docs/PROGRESS.md` with the acceptance table, then ask the owner for sign-off.

## Known limitations / decided moves
- Widgets sit in a temporary column; the grid, per-monitor layouts, edit mode, widget picker → P5.
- Detail views and in-card alerts → P5 (alert notifications from core already work).
- Native mode uses a 32 px top inset instead of the real work area (`NATIVE_TOP` in `LayerApp.tsx`); P5 should use
  the helper's `GetWorkAreas`.
- Instant mode can't detect "covered"; only Native reports it.
- The layer window being fully covered pauses WebKit timers (fine, saves power).

## How to work here (essentials; details in CLAUDE.md)
- Commits: conventional, author `ali-kenjo <285495463+ali-kenjo@users.noreply.github.com>` (repo git config),
  **no Co-Authored-By / "Generated with" lines**. Push to `main`; CI (GitHub Actions) must stay green.
- Checks: `cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings && cargo fmt --all --check`;
  `cd app && pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`; `pnpm lint:helper`.
- Builds: `cd app && pnpm tauri build --debug --no-bundle` (or `--no-bundle` for release). Lab:
  `LAB=1 pnpm exec vite build && pnpm exec vite preview` → `/lab.html`. Re-record baselines with
  `pnpm exec playwright test --update-snapshots=all` (the default skips small diffs).
- Run: `./target/release/opaline` (core starts the layer), `--quit`, `--peek`, `--diagnose`, `--dump <prefix>`.
- Never `pkill -f 'opaline --layer'` from a shell command (it matches the shell itself).
- Real data only in the product; mocks only in tests and the Lab. The owner prefers plain, short explanations.
- Read the WebKitGTK and zbus 6 gotchas in CLAUDE.md before touching the layer page or D-Bus code.

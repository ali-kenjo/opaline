# Handoff: where Opaline stands (2026-11-27)

For whoever continues this work (person or AI tool). Read this first, then `CLAUDE.md`, `OPALINE_2_BRIEF.md` (the
2.0 brief), `docs/PLAN-2.md`, `docs/DESIGN-2.md`, `docs/PROGRESS.md` and the ADRs in `docs/adr/` (0001–0016).

## The project in one paragraph
Opaline is a desktop-widgets app for Ubuntu 26.04 / GNOME 50: glass widgets on the wallpaper, above the desktop
icons and below windows. Rust core (sensor engine, settings, layouts, IPC, D-Bus) + Tauri 2 layer process (one
transparent WebKitGTK window per monitor, React 19 frontend) + a small GNOME Shell helper for "Native mode".
1.0 and 1.1 are released (`v1.0.0`, `v1.1.0`). **Opaline 2.0** is in progress: phases P0–P10 of `docs/PLAN-2.md`,
each ending with acceptance checks, a PROGRESS entry and the owner's sign-off.

## Status
- **P0 and P1** are signed off and pushed.
- **P2 (composition engine) is signed off (2026-11-27) and pushed.** Details: PROGRESS "2.0 · Phase 2".
- **Next steps, in order:**
  1. Start **P3 (style model 2.0, themes and files)** per PLAN-2 §3 P3 (P3/P4 were swapped on purpose).
  2. Optional, if the owner allows: a real-layer budget run (`scripts/measure-budget.sh 60` with a 2.0 build on a
     settings copy) to confirm the animation CPU work on the desktop; the owner skipped it on 2026-11-27.
- **Settings are version 2.** Run dev builds on a settings copy (`XDG_CONFIG_HOME=<copy>`), never on the owner's
  `~/.config/opaline` (the installed 1.1.0 then treats it as read-only).
- RAM budget **450 MB PSS** (ADR 0009 update). Idle CPU budget ≤ 0.5 %.

## Open items
1. **Updater can't install anything:** `RELEASE_MINISIGN_PUBKEY` (`crates/opaline-core/src/updates.rs`) is empty
   and v1.0/1.1 were published unsigned. Needs the owner: a minisign key pair and the GitHub secrets
   `MINISIGN_SECRET_KEY`, `MINISIGN_PASSWORD`, then the public key in the code.
2. Memory levers documented but not built (ADR 0009): recycle the web process while hidden, windows sized to
   widgets, glibc tunables for core.
3. GNOME 51 readiness: the helper declares `shell-version: ["50"]`.
4. Core enables the helper on **every** start (`desktop::ensure_enabled`), overriding a user who turned it off; it
   should only do so once after install (ADR 0015 side finding).
5. Volume read/live updates through PipeWire and the control widgets themselves are P7 work (ADR 0016).
6. ADR 0015's composed controls hand focus back only in Native mode (Instant can't refocus another app's window).

## State of the machine (2026-11-27)
- Installed `opaline 1.1.0` (`.deb`) runs as a transient unit (`systemd-run --user --collect /usr/bin/opaline`),
  in Native mode with the **dev helper** from `~/.local/share/gnome-shell/extensions/` (revision 1: `ReleaseFocus`,
  focus guard; ApiVersion still 1, so 1.1.0 works with it). The helper takes effect only after a re-login.
- GNOME switches workspaces only on the primary display (`eDP-1`); windows on `HDMI-2` stay on every workspace.
  The owner keeps maximized windows on both monitors, so the layer is usually covered: for any real-desktop check,
  ask them to switch the laptop screen to an empty workspace.
- `~/.config/opaline/layouts.json` holds the owner's layout. Docker Desktop is stopped (an exited `n8n` container).

## Checks on the real desktop (with the owner's OK only)
- Lab pages inside the real layer: `cd app && LAB=1 pnpm tauri build --debug --no-bundle`, then
  `systemd-run --user --collect -E XDG_CONFIG_HOME=<copy> -E OPALINE_LAYER_PAGE='lab.html?spike=focus' target/debug/opaline`;
  results go to `~/.local/state/opaline/logs/opaline-layer.<UTC date>.log` (`key="spike-…"`).
- `scripts/remote-input.py CONNECTOR click X Y | key NAME` drives the real pointer/keyboard (Mutter remote desktop).
  Coordinates are the monitor's **physical** pixels (logical × scale; `eDP-1` is 1.25 with a 32 px top bar).
  Always take a silent screenshot first (`scripts/capture-monitor.py`; for a still screen request only 1 frame)
  and click only where the probe is visible; never type before the probe reports focus.
- Spike probes stay in the Lab: `?spike=webkit` (S2), `?spike=glass` (S1), `?spike=sandbox` (S5),
  `?spike=focus` (S3); `cargo run -p opaline-core --example quick_settings_probe` (S4, changes nothing).

## How to work here (essentials; details in CLAUDE.md)
- Commits: conventional, author `ali-kenjo <285495463+ali-kenjo@users.noreply.github.com>` (repo git config),
  **no Co-Authored-By / "Generated with" lines**.
- Checks: `cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings && cargo fmt --all --check`;
  `cd app && pnpm lint && pnpm typecheck && pnpm test && pnpm lint:helper && pnpm test:e2e`.
- UI tests run the real pages on a fake core: `app/e2e/stub/` (`openLayer`, `openShellPage`).
- Memory: `scripts/memory-breakdown.sh` (now), `scripts/memory-trend.sh INTERVAL COUNT out.csv` (over time).
- Never `pkill -f <pattern>` with the pattern in the same shell command (it matches the shell itself); use PIDs.
- Expressions: change `spec/expressions/*.json` first, then Rust and TS; the differential test must agree.
- Compositions: change `crates/opaline-compose/src/model.rs`, then `OPALINE_UPDATE_SCHEMA=1 cargo test -p opaline-compose`
  and `cd app && pnpm gen:types`.
- Real data only in the product; mocks only in tests and the Lab. The owner prefers plain, short explanations.

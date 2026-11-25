# Handoff: where Opaline stands (2026-11-25)

For whoever continues this work (person or AI tool). Read this first, then `CLAUDE.md`, `OPALINE_BUILD_PROMPT.md`
(the brief), `docs/PLAN.md`, `docs/PROGRESS.md` and `docs/ANALYSIS_REPORT.md`. Decisions are in `docs/adr/` (0001–0011).

## The project in one paragraph
Opaline is a desktop-widgets app for Ubuntu 26.04 / GNOME 50: glass widgets on the wallpaper, above the desktop
icons and below windows. Rust core (sensor engine, settings, layouts, IPC, D-Bus) + Tauri 2 layer process (one
transparent WebKitGTK window per monitor, React 19 frontend) + a small GNOME Shell helper for "Native mode". Built
phase by phase (P0–P8 in the brief); each phase ended with acceptance checks, a PROGRESS note and the owner's sign-off.

## Status
All phases P0–P8 are done and signed off. **`v1.0.0`** (2026-11-24) and **`v1.1.0`** (2026-11-24, `9c4726a`) are tagged
and pushed. v1.1.0 is installed from the `.deb` (`/usr/bin/opaline`) and running in Native mode on the reference laptop.

Checks on 2026-11-25: 159 Rust tests, clippy `-D warnings`, rustfmt, tsc, ESLint + Prettier, 70 Vitest and 12 Playwright
tests all pass.

## Open items (in priority order)
1. **Memory: 426 MB PSS against the 280 MB budget** (web process 248 MB, core 70 MB). Measure over time (fresh start,
   after Edit, 1 h, 8 h) with `scripts/measure-budget.sh`, find what grows, then fix or formally raise the budget
   (ADR 0009 records the history of this budget).
2. **UI test gap:** no automated tests for Edit mode, Widget Picker, Detail views, Settings or Onboarding. Add Playwright
   tests against the Lab or a stub host before refactoring.
3. **Split `app/src/layer/LayerApp.tsx`** (1,808 lines, one ~1,400-line component) once those tests exist.
4. **`fans` provider** takes ~405 ms per sample but is declared `cheap` (see `opaline --diagnose`).
5. **Instant-mode layer restart** retries every 30 s with no backoff ceiling (seen in logs on 2026-11-24).
6. **GNOME 51 readiness:** the helper declares `shell-version: ["50"]`; the nested `gnome-shell --devkit` workflow
   (task 4.4) was skipped.
7. **Updater:** confirm it refuses a release without a valid minisign signature (the release workflow signs only when the
   secrets are configured).

## State of the machine
- Installed: `opaline 1.1.0` from the `.deb`; core, `opaline --layer --backend native` and (when CPU power is on)
  `opaline-privileged` are running.
- `~/.config/opaline/layouts.json` holds the owner's layout (currently one widget on `eDP-1`).
- Helper installed system-wide by the `.deb`; the dev install script (`scripts/install-helper-dev.sh`) puts one in
  `~/.local` and should not be used at the same time.
- When launching `opaline` from an integrated VS Code terminal, the Snap environment leaks `GSETTINGS_SCHEMA_DIR` /
  `GTK_PATH`; launch via `systemd-run --user --unit=<name> --collect <binary>` or a regular GNOME Terminal.
- `target/` is large (about 63 GB, including old bundle folders); `cargo clean` frees it.

## How to work here (essentials; details in CLAUDE.md)
- Commits: conventional, author `ali-kenjo <285495463+ali-kenjo@users.noreply.github.com>` (repo git config),
  **no Co-Authored-By / "Generated with" lines** (the repo's rule overrides any default attribution). Push to `main`; CI must stay green.
- Checks: `cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings && cargo fmt --all --check`;
  `cd app && pnpm lint && pnpm typecheck && pnpm test && pnpm lint:helper && pnpm test:e2e`.
- Builds: `cd app && pnpm tauri build --debug --no-bundle` (or `--no-bundle` for release, `--bundles deb` for the package).
- Run: `opaline`, `--quit`, `--peek`, `--edit`, `--settings`, `--diagnose`, `--dump <prefix>`.
- Never `pkill -f 'opaline --layer'` from a shell command (it matches the shell itself).
- Real data only in the product; mocks only in tests and the Lab. The owner prefers plain, short explanations.

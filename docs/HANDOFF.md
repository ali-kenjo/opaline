# Handoff: where Opaline stands (2026-11-25)

For whoever continues this work (person or AI tool). Read this first, then `CLAUDE.md`, `OPALINE_2_BRIEF.md` (the
2.0 brief), `docs/PLAN-2.md`, `docs/DESIGN-2.md`, `docs/PROGRESS.md` and the ADRs in `docs/adr/` (0001–0011).

## The project in one paragraph
Opaline is a desktop-widgets app for Ubuntu 26.04 / GNOME 50: glass widgets on the wallpaper, above the desktop
icons and below windows. Rust core (sensor engine, settings, layouts, IPC, D-Bus) + Tauri 2 layer process (one
transparent WebKitGTK window per monitor, React 19 frontend) + a small GNOME Shell helper for "Native mode".
1.0 and 1.1 are released (`v1.0.0`, `v1.1.0`). **Opaline 2.0** is in progress: phases P0–P10 of `docs/PLAN-2.md`,
each ending with acceptance checks, a PROGRESS entry and the owner's sign-off.

## Status
- **2.0 Phase 0 (stabilize)** is done and signed off (2026-11-25; see PROGRESS "2.0 · Phase 0").
  Pushed to `origin/main`. The crash-recovery fix (open item 2) is on branch `claude/quizzical-matsumoto-d181cd`, not merged yet.
- Next: **P1, design language and glass 2.0**, starting with three visual directions for the Opaline theme in the
  Lab (PLAN-2 task 1.1) and spikes S1 (transparency, blur pyramid) and S2 (WebKitGTK features).
- RAM budget is now **450 MB PSS** (owner's decision, ADR 0009 update). Idle CPU budget unchanged (≤ 0.5 %).

## Open items
1. **Updater can't install anything:** `RELEASE_MINISIGN_PUBKEY` in `crates/opaline-core/src/updates.rs` is empty
   and v1.0/1.1 were published unsigned. Needs the owner: create a minisign key pair, add `MINISIGN_SECRET_KEY` and
   `MINISIGN_PASSWORD` as GitHub secrets, then put the public key in the code. The release workflow now fails
   without the secret.
2. **Two web processes after a crash:** when the shared web process dies, the layer reloads both windows, but they
   then run in two processes (+60 MB) until Opaline restarts (ADR 0009 update). Fix by recreating the windows with
   a related view after a crash.
3. Memory levers documented but not built (ADR 0009 update): recycle the web process while hidden, windows sized
   to widgets, glibc tunables for core, fewer animation frames.
4. GNOME 51 readiness: the helper declares `shell-version: ["50"]`; the devkit test (1.0 task 4.4) was skipped.

## State of the machine
- Installed: `opaline 1.1.0` from the `.deb`. It was restarted several times on 2026-11-25 for measurements and runs
  as a transient user unit (`systemd-run --user`); it returns to normal autostart at the next login.
- A dev copy of the helper is in `~/.local/share/gnome-shell/extensions/` (core logs that path); don't use it at the
  same time as the system-wide one from the `.deb`.
- `~/.config/opaline/layouts.json` holds the owner's layout (CPU, Memory, Clock, Visualizer, GPU on `eDP-1`).
- Docker Desktop is stopped; it holds an exited `n8n` container (needed in P6).

## How to work here (essentials; details in CLAUDE.md)
- Commits: conventional, author `ali-kenjo <285495463+ali-kenjo@users.noreply.github.com>` (repo git config),
  **no Co-Authored-By / "Generated with" lines**.
- Checks: `cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings && cargo fmt --all --check`;
  `cd app && pnpm lint && pnpm typecheck && pnpm test && pnpm lint:helper && pnpm test:e2e`.
- UI tests run the real pages on a fake core: `app/e2e/stub/` (`openLayer`, `openShellPage`).
- Memory: `scripts/memory-breakdown.sh` (now), `scripts/memory-trend.sh INTERVAL COUNT out.csv` (over time).
- Never `pkill -f <pattern>` with the pattern in the same shell command (it matches the shell itself); use PIDs.
- Real data only in the product; mocks only in tests and the Lab. The owner prefers plain, short explanations.

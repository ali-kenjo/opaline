# Opaline: notes for Claude

Desktop widgets for Ubuntu 26.04 / GNOME 50. The brief is `OPALINE_BUILD_PROMPT.md`; the plan is `docs/PLAN.md`;
where we are is `docs/PROGRESS.md`. Read those three before working. Decisions live in `docs/adr/`.

## Commands

```bash
pnpm install                                   # JS deps (pnpm via corepack)
cd app && pnpm tauri build --debug --no-bundle # debug binary with the frontend embedded → target/debug/opaline
cd app && pnpm tauri build --no-bundle         # release binary → target/release/opaline
cd app && pnpm tauri build --bundles deb       # .deb → target/release/bundle/deb/
./target/debug/opaline                         # start core (spawns the layer in Instant mode)
./target/debug/opaline --quit                  # stop it (also --edit, --peek, --settings)
./target/debug/opaline --diagnose              # redacted JSON inventory
scripts/measure-budget.sh 60                   # CPU/RAM of all Opaline processes vs. the budgets
cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings && cargo fmt --all --check
cd app && pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e
```

Logs: `~/.local/state/opaline/logs/opaline-{core,layer}.<date>.log` and journald (`journalctl --user -t opaline-core`).
Filter with `OPALINE_LOG` (e.g. `OPALINE_LOG=info,opaline=debug`).

A plain `cargo build -p opaline` produces a binary that loads the frontend from the Vite dev server
(`http://localhost:5173`); use `pnpm tauri build --debug --no-bundle` (or `pnpm tauri dev`) to embed it.
`cargo clippy`/`cargo build` need `app/dist` to exist (run `pnpm exec vite build` in `app/` once).

## Layout

- `crates/opaline-ipc`: wire protocol (frames, messages). Shared by core and layer.
- `crates/opaline-core`: hub (topic bus), IPC server, D-Bus app service (single instance), displays (Mutter),
  samplers, logging, diagnose.
- `app/src-tauri`: the `opaline` binary. `core_mode.rs` (tray, D-Bus, IPC server, layer supervisor), `layer/`
  (windows per monitor, IPC client, bridge to the webviews), `instant.rs`.
- `app/src`: React frontend. `layer/` is the widget layer page (`layer.html`).

## Conventions

- Rust: no `unwrap`/`expect`/`panic` outside tests (workspace lints deny them); `clippy -D warnings`; rustfmt.
  Providers must never be able to crash core.
- TypeScript strict, ESLint (strictTypeChecked), Prettier. No TODO/FIXME comments (lint rule) without an issue
  reference.
- Commits: conventional commits, as `ali-kenjo <285495463+ali-kenjo@users.noreply.github.com>` (set in this repo's
  git config). **No `Co-Authored-By` or "Generated with" lines.**
- Real data only in the product; mocks only in tests and the Widget Lab.

## Gotchas found so far

- **zbus 6**: `zvariant` is merged into `zbus` (`zbus::OwnedVariant`, `zbus::wire`); `Value` is now `Variant`;
  `connection::Builder` methods no longer return `Result`; a taken name comes back as `Err(zbus::Error::NameTaken)`,
  not as `RequestNameReply::Exists`.
- **Tauri identifier** can't contain `_`, so `tauri.conf.json` uses `io.github.ali-kenjo.opaline`; the public app ID
  stays `io.github.ali_kenjo.Opaline` (ADR 0007). Keep `enableGTKAppId` off.
- **TypeScript is pinned to 6.0**: typescript-eslint 8.x supports `<6.1`; TS 7 (the Go port) isn't supported yet.
- **Vite 8** uses Rolldown: `build.rolldownOptions`, not `rollupOptions`. Vitest config comes from `vitest/config`.
- **Xwayland runs at 2×** on this machine (`xwayland-native-scaling`, monitors at 1.25 and 1.0): X11 coordinates are
  logical × 2 and GTK's scale factor is 2.
- **Mutter ignores the position of a newly mapped X11 window** unless `USPosition` is set; in-process
  `gtk_window_move`/`gdk_window_move` after mapping did nothing. See ADR 0008 and `layer/windows.rs` (`show_at`, `pin`).
- **DING's window is in Mutter's DESKTOP layer**, so keep-below (BOTTOM layer) is always above it (ADR 0006).
- **WebKit hides the GPU name** from WebGL (`UNMASKED_RENDERER_WEBGL` says "Apple GPU"); it isn't a fault.
- Playwright WebKit needs `libevent-2.1-7t64` and `libmanette-0.2-0` on the host (`sudo` once; CI installs them).
- The NVIDIA dGPU on this laptop never runtime-suspends (RTD3 not supported, and it drives the HDMI monitor): ADR 0003.

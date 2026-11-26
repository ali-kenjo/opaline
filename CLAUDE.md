# Opaline: notes for Claude

Desktop widgets for Ubuntu 26.04 / GNOME 50. **Current work is Opaline 2.0**: the brief is `OPALINE_2_BRIEF.md`,
the plan is `docs/PLAN-2.md`, the design is `docs/DESIGN-2.md`. The 1.0 brief (`OPALINE_BUILD_PROMPT.md`) and plan
(`docs/PLAN.md`) still apply where the 2.0 brief says nothing. Where we are is `docs/PROGRESS.md`; the latest handoff
is `docs/HANDOFF.md`. Read those before working. Decisions live in `docs/adr/`.

## Commands

```bash
pnpm install                                   # JS deps (pnpm via corepack)
cd app && pnpm tauri build --debug --no-bundle # debug binary with the frontend embedded → target/debug/opaline
cd app && pnpm tauri build --no-bundle         # release binary → target/release/opaline
cd app && pnpm tauri build --bundles deb       # .deb → target/release/bundle/deb/
./target/debug/opaline                         # start core (spawns the layer in Instant mode)
./target/debug/opaline --quit                  # stop it (also --edit, --peek, --settings)
./target/debug/opaline --diagnose              # redacted JSON inventory (providers, topic availability)
./target/debug/opaline --dump cpu.             # sample the engine ~3 s, print topics as JSON (prefix optional)
scripts/acceptance-p1.sh                       # Opaline next to top/free/nvidia-smi/df/ip/upower/docker
scripts/capture-fixtures.sh [name]             # redacted sysfs/procfs/D-Bus snapshot → fixtures/<name>/
cargo test -p opaline-core -- --ignored nvml   # on NVIDIA machines: NVML holds no /dev/nvidia* after release
scripts/measure-budget.sh 60                   # CPU/RAM of all Opaline processes vs. the budgets
cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings && cargo fmt --all --check
cd app && pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e
cd app && LAB=1 pnpm exec vite build && pnpm exec vite preview  # Widget Lab at http://localhost:4173/lab.html
cd app && LAB=1 pnpm tauri build --debug --no-bundle && OPALINE_LAYER_PAGE='lab.html?still' ../target/debug/opaline
                                               # the Lab in the real layer windows; reports key="lab-glass" to the layer log
                                               # 'lab.html?live': widgets with real data/fonts, reports key="lab-widgets"
cd app && pnpm exec playwright test --update-snapshots=all  # re-record the Lab baselines (look at the diff first)
cd app && pnpm icons                           # re-subset Material Symbols after adding to icons/codepoints.ts
cd app && pnpm lint:helper                     # ESLint + schema check for the GNOME Shell helper
cargo build -p opaline-expr --example lines && cd app && OPALINE_EXPR_LINES=target/debug/examples/lines pnpm exec vitest run src/expr
                                               # expressions: Rust and TS agree on random programs (OPALINE_EXPR_N=100000 for more)
scripts/install-helper-dev.sh [--remove]       # helper into ~/.local for this user (no sudo); needs a re-login
scripts/capture-monitor.py eDP-1 /tmp/shot     # silent screenshot of one monitor (Mutter ScreenCast) → /tmp/shot.N.png
./target/debug/opaline --peek                  # toggle Peek (raises the layer, so screenshots can see it)
```

Logs: `~/.local/state/opaline/logs/opaline-{core,layer}.<date>.log` and journald (`journalctl --user -t opaline-core`).
Filter with `OPALINE_LOG` (e.g. `OPALINE_LOG=info,opaline=debug`).

A plain `cargo build -p opaline` produces a binary that loads the frontend from the Vite dev server
(`http://localhost:5173`); use `pnpm tauri build --debug --no-bundle` (or `pnpm tauri dev`) to embed it.
`cargo clippy`/`cargo build` need `app/dist` to exist (run `pnpm exec vite build` in `app/` once).

## Layout

- `crates/opaline-ipc`: wire protocol (frames, messages). Shared by core and layer.
- `crates/opaline-core`: hub (topic bus), `engine/` (Provider trait, sampler, supervisor, `while_subscribed`),
  `providers/` (one module per source; parsers are pure and tested against `fixtures/`), `store.rs` (settings),
  `history.rs`, `alerts.rs`, `commands.rs` (IPC commands), `http.rs`, IPC server, D-Bus app service, displays,
  logging, diagnose/dump.
- `desktop-integration/`: the GNOME Shell helper (GJS, ESM): `layer.js` (starts the layer as a trusted Wayland client
  while core runs), `stacking.js` (ADR 0006), `dbus.js` (`io.github.ali_kenjo.Opaline.Shell1`, ApiVersion 1), `keys.js`.
  Core side: `desktop.rs` (Native/Instant selection, live switching), `shortcuts.rs` (portal shortcuts in Instant).
- `crates/opaline-expr`: the expression language (docs/EXPRESSIONS.md); its TypeScript twin is `app/src/expr/`. Both
  pass `spec/expressions/*.json`; change the corpus first, then both sides.
- `crates/opaline-compose`: the composition model (docs/COMPOSITION.md). Its JSON Schema (`spec/composition.schema.json`)
  and the layer's types (`app/src/compose/model.gen.ts`) are generated from it; tests fail when either is stale:
  `OPALINE_UPDATE_SCHEMA=1 cargo test -p opaline-compose`, then `cd app && pnpm gen:types`.
- `crates/opaline-privileged`: the root helper (RAPL only); its D-Bus/polkit files are in `packaging/`.
- `app/src-tauri`: the `opaline` binary. `core_mode.rs` (tray, D-Bus, IPC server, layer supervisor), `layer/`
  (windows per monitor, IPC client, bridge to the webviews), `instant.rs`.
- `app/src`: React frontend. `layer/` is the widget layer page (`layer.html`); `design-system/` (tokens, color,
  shapes, motion, icons, glass compositor, components, `style/` = widget style model, ADR 0011); `widgets/` (the
  framework: `types.ts` contract, `content.ts`, `WidgetFrame`, `StatLayout`, `settings/` sheet, `host.tsx` +
  `layerHost.ts`, one file per widget, `registry.ts`); `lab/` is the Widget Lab (`lab.html`, only built with `LAB=1`).

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
- **zbus 6 builders**: `MatchRule::builder()` and proxy builders chain plain setters; only `build()` returns a
  `Result`. D-Bus errors arrive as different `zbus::Error` variants; match on the error *name* (`ServiceUnknown`).
- Providers read files through `sysfs::Root` (`/` or a fixture dir); `Root::recording()` logs accessed paths.
  Per-tick files use `HotFile` (open once, `pread`). Topic names are static strings (GPU ones are leaked once).
- **Never `pkill -f 'opaline --layer'` from a shell command**: the pattern matches the shell running it.
- Run reference tools with `LC_ALL=C`; this machine is `de_DE` (decimal commas, German labels in `top`/`free`).
- **PSS of shared libraries depends on other processes** (libLLVM, libwebkit): the memory budget moves with what
  else runs. Compare runs with the same apps open.
- Mutter's ScreenCast D-Bus API + `pipewiresrc` gives silent screenshots for visual checks (X11 `import` of the layer
  windows returns black).
- The NVIDIA dGPU on this laptop never runtime-suspends (RTD3 not supported, and it drives the HDMI monitor): ADR 0003.
- **material-color-utilities** imports without file extensions: Vitest needs it in `server.deps.inline`.
- **Canvas 2D can't resolve `var(--…)` colors**: resolve them through `getComputedStyle` first (Sparkline).
- The Lab sets `window.__labScheduler`; the e2e test reads its frame counter to prove an idle page draws nothing.
  Animations must go through `design-system/motion` `scheduler`, never their own `requestAnimationFrame` loop.
- **Adding a widget:** declare fields (topics + `read`), options and `status` in `widgets/<kind>.ts(x)`, add it to
  `registry.ts` and the Lab layout (`lab/labHost.ts`); style and content settings come for free. Style keys live in
  three places that must agree: `design-system/style/{types,fields}.ts` and `crates/opaline-core/src/style.rs`.
- The React compiler lint forbids reading refs or mutating state objects during render; keep mutable buffers in a
  class instance from `useState(() => new X())` and mutate them in effects (see `HeroHistory`).
- **WebKitGTK GPU mode in the transparent layer window**: a child with its own composited layer can get stretched
  over the whole window as a solid colour (the Peek hint did: a grey veil). Keep stage content in one layer
  (`.content { transform: translateZ(0) }`), avoid `position: fixed` + `translate`. Compare pixel values of a
  ScreenCast capture during `--peek` to catch it; DOM inspection (`elementsFromPoint`) doesn't show it.
- **`opaline-asset://` can't be read cross-origin** (fetch fails, images taint WebGL): use the `layer_asset` command
  and a blob URL for anything WebGL uploads.
- A layer window attaching late used to miss topic values; the layer process replays the latest values on attach.
- WebKit pauses timers in a fully covered layer window; diagnostics with `setTimeout` need the window visible (Peek).
- Logs are named by **UTC** date (`opaline-layer.<UTC date>.log`).
- GlobalShortcuts triggers use the XDG format (`LOGO+ALT+w`, not `SUPER`); GNOME shows "Disabled" otherwise.

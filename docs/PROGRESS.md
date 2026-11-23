# Progress

## Phase 0: Foundations (2026-11-22)

**Done**
- Repository, GPL-3.0 licence, `CLAUDE.md`, ADRs 0001–0009, `.editorconfig`, rustfmt, workspace lints (no
  `unwrap`/`expect`/`panic` outside tests).
- Cargo workspace: `opaline-ipc`, `opaline-core`, `app/src-tauri` (binary `opaline`). `opaline-privileged` is
  created in P1 when it has something to do (task 1.16).
- `opaline-ipc`: length-prefixed frames (MessagePack messages, raw spectrum frames), handshake with protocol
  version, 11 tests including fuzz-style random input.
- Core: single instance over the session bus (`io.github.ali_kenjo.Opaline`, interface `…Opaline1`: Peek, Edit,
  OpenSettings, Quit); a second `opaline`/`--edit`/`--quit` forwards to the running core. Tray (Peek · Edit widgets ·
  Pause updates · Settings · Quit). IPC server in `$XDG_RUNTIME_DIR/opaline/` (dir `0700`, socket `0600`,
  `SO_PEERCRED` check). Mutter `DisplayConfig` monitors with live change tracking. `system.loadavg` sampled only
  while subscribed. Layer supervisor with backoff. Logging to journald and a rotating file.
- Layer: one transparent window per monitor, reconnecting IPC client, Tauri Channel to React (Zustand), input region
  (click-through outside widgets), Phase 0 test card with live load averages.
- `--diagnose` skeleton (OS, session, shell version, displays with serials redacted, helper presence).
- Frontend: Vite 8, React 19, TypeScript 6 strict, ESLint strictTypeChecked, Prettier, Vitest (3 tests), Playwright
  WebKit config with 2 smoke tests.
- CI workflow (`ubuntu:26.04` container): lint, types, unit tests, fmt, clippy, Rust tests, Playwright WebKit, `.deb`
  build. `.deb` builds locally (4.2 MB).
- `scripts/measure-budget.sh`.

**Spike results**
- **A, WebGL2 + transparency:** WebGL2 context works in both layer windows (Tauri/WebKitGTK 2.52, X11 backend),
  premultiplied alpha, max texture 16384, first frame 24–30 ms (debug build, includes `gl.finish`). WebKit masks
  the GPU name. The transparent glass card is visible on the desktop (you confirmed it, 2026-11-23, after the fix
  below).
- **B, RAM/CPU:** sharing one web process across windows. Release, two monitors, windows drawing: 278 MB, then
  **259 MB** after loading only Mesa's EGL on this hybrid laptop (brief's budget 220 MB; **you raised it to 280 MB** on 2026-11-23), and **0.13 %** idle CPU
  (budget 0.5 %). All levers tried, with numbers, are in ADR 0009. *(The first figure, 209 MB, was measured while the
  bug below kept the webviews from drawing.)*

**Fixed 2026-11-23: a layer could outlive core.** Tauri ends the process right after its exit event, sometimes
before the supervisor had stopped the layer; the orphan then reconnected to the next core (two layers). Core now waits
up to 2 s for the layer to stop, and a layer exits when the process that started it is gone. Checked: five quits and
one `kill -9` of core left no layer behind.

**Fixed 2026-11-23: the test card never appeared.** Your visual check found the desktop empty. The layer windows
were mapped and in the right place, but they were shown with GTK `show()` after being created hidden, which maps the
toplevel and leaves Tauri's box and the webview unmapped. The page still ran (logs and WebGL reports looked healthy),
but nothing was ever painted. Now `show_all()`; the glass card shows on eDP-1 (checked with a Mutter screencast
frame).
- **C, Instant mode:** Xwayland runs at 2×; keep-below/sticky/skip-taskbar/skip-pager set; DING is in the DESKTOP
  layer so we're above it by construction; Mutter misplaced new windows until we set `USPosition` (ADR 0008). Both
  windows are now exactly on their monitors' work areas (verified with `xwininfo`). Your visual check (2026-11-23):
  the card isn't in Alt-Tab or the overview, has no dock icon, and normal windows cover it. Show Desktop and
  click-through weren't checked separately.

**Acceptance (brief §10, P0)**
| Check | Result |
| - | - |
| CI green | ✅ First run on [github.com/ali-kenjo/opaline](https://github.com/ali-kenjo/opaline) (2026-11-22): lint, types, unit tests, fmt, clippy, Rust tests, Playwright WebKit (2/2) and the `.deb` job all passed. |
| Core shows its tray | ✅ Tray icon registered through AppIndicator (StatusNotifierWatcher present). You saw it and its menu (Peek · Edit widgets · Pause updates · Settings · Quit). |
| Test layer window connects to core | ✅ Both windows connect, subscribe and receive `system.loadavg` every second. |

**Open**
- Memory: 259 MB against the raised 280 MB budget (ADR 0009). Windows sized to the widgets come with the grid engine
  (Phase 5); Native mode gets measured in Phase 4. Then we see whether the budget can come back down.

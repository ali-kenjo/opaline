# Opaline: analysis report

Date: 2026-11-25 · Version analysed: 1.1.0 (`main` at `9c4726a`, clean tree) · Machine: HP i5-10300H, Ubuntu 26.04.1, GNOME 50.1 Wayland, `eDP-1` + `HDMI-2`

## 1. Verdict

Opaline is a **well-engineered, feature-complete 1.1.0** with very strong CPU behaviour, a clean automated-check record and unusually good decision documentation. The one number that is clearly off is **memory: 426 MB PSS against the 280 MB budget** on the installed build. The documentation has also fallen behind the code since v1.0.0. Everything else I found is minor or a medium-term risk.

| Area | Rating | One line |
| - | - | - |
| Code quality | Strong | `unsafe` denied, `unwrap`/`expect`/`panic` denied, clippy `-D warnings` clean |
| Automated checks | Strong | Everything I ran passed (section 3) |
| CPU / startup | Strong | 0.05 % idle (budget 0.5 %), 0.72 s start (budget 1.5 s, from PROGRESS) |
| **Memory** | **Over budget** | **426 MB vs 280 MB**, up from 240–338 MB recorded in Phase 7 |
| Security design | Strong on paper | Documented in `docs/SECURITY.md`; I read it but did not re-audit the code |
| Documentation | Drifted | `PROGRESS.md` stops at v1.0.0; `HANDOFF.md` still says "Phase 5 awaiting sign-off" |
| UI test coverage | Thin | Edit mode, Settings and Onboarding have no automated UI tests |
| Portability | Narrow by design | Ubuntu 26.04 / GNOME 50 only; verified on one laptop |

## 2. What the app is

Desktop widgets for Ubuntu 26.04 / GNOME 50: glass cards on the wallpaper, above desktop icons and below windows, with an Android-style edit mode. 14 widgets (Clock, CPU, Memory, GPU, Storage, Network, Battery & Power, Fans, Processes, Now Playing, Visualizer, Weather, Calendar, Docker), each fully customizable (42 style settings plus per-widget content options). English, German and Arabic (RTL). GPL-3.0-or-later, no telemetry.

**Process model** (ADR 0001): three cooperating pieces.

- `opaline` (core): Rust sensor engine, settings/layout store, IPC server, tray, D-Bus service, update checker. No window unless Settings is open.
- `opaline --layer`: a second Tauri process, one transparent WebKitGTK window per monitor, one shared web process (ADR 0009), a WebGL2 glass compositor, React 19 front end.
- GNOME Shell helper (630 lines of GJS): starts the layer as a trusted Wayland client ("Native" mode) and handles stacking. Without it, core falls back to "Instant" mode through Xwayland and switches live when the helper appears.
- `opaline-privileged`: a tiny root helper, read-only, RAPL power only, behind polkit.

## 3. Size and health

| Part | Size |
| - | - |
| `opaline-core` (providers, engine, store, IPC server) | 17.9k lines Rust, 55 files |
| `app/src-tauri` (tray, windows, layer bridge) | 2.5k lines Rust |
| `opaline-ipc` / `opaline-privileged` | 0.9k / 0.25k lines Rust |
| Front end | 21.7k lines TS/TSX (117 files) + 3.4k lines CSS |
| Shell helper | 629 lines JS |
| Repository | 91 commits, 965 tracked files, tags `v1.0.0`, `v1.1.0` |

**Checks I ran today (all on this machine):**

| Check | Result |
| - | - |
| `cargo test --workspace` | 159 passed, 0 failed, 1 ignored (NVML test, needs an NVIDIA machine) |
| `cargo clippy --workspace --all-targets -- -D warnings` | clean |
| `cargo fmt --all --check` | clean |
| `pnpm typecheck` (TS 6.0 strict) | clean |
| `pnpm lint` (ESLint strictTypeChecked + Prettier) | clean |
| `pnpm test` (Vitest) | 70 passed in 11 files |
| `pnpm test:e2e` (Playwright WebKit) | 12 passed |
| `opaline --diagnose` | helper running, API v1, every provider reports `ok` |

I did **not** check the remote GitHub Actions status, and I did not rebuild the `.deb`.

## 4. Runtime measurements (installed v1.1.0, Native mode, up 2 h 43 min)

`scripts/measure-budget.sh 15`:

| Process | PSS |
| - | - |
| core (`opaline`) | 70.5 MB |
| layer (`opaline --layer`) | 92.3 MB |
| WebKitNetworkProcess | 16.0 MB |
| **WebKitWebProcess** | **247.7 MB** |
| **Total** | **426.4 MB** (budget 280) |
| CPU over 15 s | 0.050 % of the machine (budget 0.5 %) |

Context: `layouts.json` holds a single widget on `eDP-1` right now, so this is not a heavy layout. Earlier numbers in `PROGRESS.md`: 239.9 MB before Edit mode, 337.9 MB after Edit. Core itself has grown from 29 MB (Phase 1) to 52 MB (Phase 7) to 70.5 MB today.

Caveats: this is one 15 s sample. PSS charges shared libraries (libLLVM, libwebkit) to whoever else maps them, so it moves with what else is running (documented in `PROGRESS.md`). I do not know whether Edit mode, the new v1.1.0 visualizers, or the long uptime caused the rise. That needs a trend, not a snapshot.

## 5. Findings, most important first

### F1. Memory is 52 % over budget (important)
See section 4. The v1.1.0 release was shipped with Phase 7 already showing ⚠️ for post-Edit memory, and the number is now worse. The web process is the bulk (248 MB). Phase 7 explained the post-Edit jump as Mesa keeping full-screen `dpr=2` EGL buffers after the Edit backdrop; that explanation fits, but it has not been re-measured since.

### F2. Documentation has drifted behind the code (important, cheap to fix)
- `docs/PROGRESS.md` ends at "Phase 8: v1.0.0". No entry for v1.1.0 (transparency, 10 visualizers, hardware info, click-through and audio fix, the 755-line `WidgetCustomizer`).
- `docs/HANDOFF.md` still lists Phase 5 as awaiting sign-off, names Phase 6 as next, and describes a release binary run under `systemd-run`. The machine now runs `/usr/bin/opaline` from the `.deb`.
- `README.md` does not mention anything new in 1.1.0.
- My own memory note also still said "Phase 4 next" (fixed as part of this task).

### F3. UI behaviour is mostly verified by hand, not by tests (medium)
The 12 Playwright tests cover the Widget Lab (mock data) and a two-test smoke of the layer page. Edit mode (drag, resize, stacks, undo, cross-display), the Widget Picker, Detail views, Settings (11 sections) and Onboarding have no automated UI tests; their pure logic (`grid.ts`, presets, i18n parity, styles) does. The GNOME Shell helper (the part most likely to break on a GNOME update) is linted but has no tests. Sign-off for these came from interactive checks on one laptop.

### F4. `LayerApp.tsx` is a 1,808-line file with a ~1,400-line component and 61 hook calls (medium)
`SettingsApp.tsx` (1,199), `WidgetSettings.tsx` (873) and `WidgetCustomizer.tsx` (755) are also large; `gpu.rs` is 1,199 lines. The code is lint-clean and the React-compiler rules are respected, but this is where future bugs and merge pain will concentrate, and where the lack of UI tests (F3) hurts most.

### F5. One provider sample is slow for a "cheap" one (low, worth a look)
`--diagnose` shows `fans` sampling in **405 ms** while labelled `cheap` (CPU: 0.17 ms, memory: 0.08 ms, GPU: 87 ms). It runs on the blocking pool so it does not stall the UI, but it is 2,000× its siblings. Probably a slow hwmon/NVML read; the cost label is wrong either way.

### F6. Small hygiene items (low)
- `scripts/__pycache__/capture-monitor.cpython-314.pyc` is tracked in git; `.gitignore` has no `__pycache__/`.
- `target/` is **63 GB**, including stale bundles (`Opaline_0.1.0`, `1.0.0`). `cargo clean -p opaline` or deleting old bundle folders would recover most of it.
- Logs show the instant-mode backend retrying "could not start the layer (file not found)" every 30 s for several minutes on 2026-11-24 (the binary was missing during a rebuild). It recovered, but a flat 30 s retry with no ceiling or backoff would be noisy in a real failure.
- One `global shortcuts unavailable: An app id is required` warning (2026-11-24) when launched outside a registered app context. Native mode uses the helper's keybindings, so this only matters to Instant mode.

### F7. Platform and bus-factor risk (medium-term)
- The helper declares `shell-version: ["50"]`; every GNOME release needs a re-test, and stacking relies on DING living in Mutter's DESKTOP layer (ADR 0006). The `Shell1` API versioning (N and N−1) is a good mitigation.
- Dependencies are deliberately new (TypeScript pinned to 6.0, Vite 8/Rolldown, zbus 6, Tauri 2). Reasonable, but upgrades will need care.
- Only one reference machine (Intel iGPU + NVIDIA dGPU). AMD, Intel Arc and VM cases are covered by synthetic fixtures, not real hardware. Hardware reports are invited via the issue template.
- It is effectively a one-person project.

## 6. Strengths worth keeping

- **Fault isolation is tested, not assumed**: panicking and hanging providers are proven not to stall siblings; provider failures back off 5 s → 5 min.
- **Cheap by design**: shared 1 s tick, values published only on change, subscription-driven sampling, covered windows get no pushes, and the dGPU is never woken (ADR 0003).
- **Privacy and least privilege**: no telemetry; webviews have no network access; per-window Tauri capabilities; IPC socket `0600` in a `0700` dir with `SO_PEERCRED`; `EndTask` re-checks UID and process start time; the root helper is read-only with a path allow-list and rate limit; updates are minisign + SHA-256 verified.
- **Decision trail**: 11 ADRs record not only choices but measured numbers and corrections (ADR 0009 admits its own earlier 209 MB figure was wrong).
- **Real data only** in the product, mocks confined to tests and the Lab.
- **Accessibility and i18n** are first-class: key/placeholder parity tests across en/de/ar, RTL, high contrast, reduced motion, text scale.

## 7. Recommendations

| # | Action | Effort | Why |
| - | - | - | - |
| 1 | Re-measure memory over time (fresh start, after Edit, after 1 h, after 8 h) and find which process grows. Decide: fix, or formally raise the budget again | Medium | F1 |
| 2 | Update `PROGRESS.md` (add v1.1.0), rewrite `HANDOFF.md` to the current state, mention 1.1 features in the README | Small | F2 |
| 3 | Add `__pycache__/` to `.gitignore` and `git rm --cached` the `.pyc`; prune old `target/` bundles | Tiny | F6 |
| 4 | Add Playwright tests for Edit mode (add, drag, remove, undo) and the Settings window against the Lab/stub host | Medium | F3 |
| 5 | Split `LayerApp.tsx` (drag/resize controller, toolbar, grid items) once tests from #4 exist | Medium | F4 |
| 6 | Look into the 405 ms `fans` sample and correct its cost label | Small | F5 |
| 7 | Add a backoff ceiling to the Instant-mode layer restart loop | Small | F6 |
| 8 | Before the next GNOME release, run the helper against GNOME 51 (devkit workflow, task 4.4, was skipped) | Medium | F7 |
| 9 | Confirm the updater refuses a release that has no valid signature (the release workflow only signs when the secrets exist). I did not verify this | Small | Security |

## 8. What I did not do

- No line-by-line security audit; I relied on `docs/SECURITY.md` and spot checks (no `unsafe`, lints deny `unwrap`/`panic`).
- No remote CI check, no `.deb` rebuild, no fresh-VM install test, no 60 fps or visualizer CPU measurement.
- No visual review of the desktop (I did not take screenshots or move any windows).

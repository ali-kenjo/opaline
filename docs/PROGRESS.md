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

## Phase 1: Sensor engine (2026-11-23)

**Done** (one commit per task; 133 Rust tests: 114 core, 11 IPC, 5 binary, 3 privileged helper)
- **Engine (1.1, 1.2):** `Provider` trait with probe/sample/cost; one shared 1 s tick that samples only subscribed
  topics at the rate of the most demanding subscriber (1/2/5/10 s by class, ×2 in Eco, per-topic floors); each sample
  on the blocking pool inside `catch_unwind`, failures publish `provider-failed` and back off 5 s → 5 min, hung samples
  are reported as stuck; event-driven providers run under a restarting supervisor; NVML-style handles are released
  10 s after the last subscriber. Values are published only when they change; new subscribers get the latest value
  at once; covered/idle subscribers and a locked screen get no pushes.
- **Fixtures (1.3):** `scripts/capture-fixtures.sh` (redacts MACs, serials (also inside UDisks2 object paths), UUIDs,
  SSIDs, connection names, user and host names) → `fixtures/hp-i5-10300h/`; synthetic fixtures: AMD desktop (Ryzen +
  Radeon, no battery), Intel Arc on xe, hybrid laptop with a sleeping NVIDIA dGPU, VM without GPU/sensors/swap/PSI.
- **Providers:** CPU (1.4), memory (1.5), GPU with the runtime-PM rule (1.6), storage + UDisks2 health (1.7),
  network + NetworkManager + latency + data usage (1.8), UPower + power profiles (1.9), audio spectrum (1.10), MPRIS
  (1.11), processes with app grouping (1.12), Docker/Podman (1.13), fans, clock settings, EDS calendar + ICS
  (ADR 0010), Open-Meteo weather + geocoding (1.14), wallpaper renders + appearance + screen lock (1.15), CPU power
  through the privileged helper (1.16), history rings + SQLite rollups, alerts with notifications (1.17).
- **Core infrastructure that came with it:** the settings store (`settings.json`, versioned, validated merge
  patches; Phase 6 adds the UI), IPC `Command`/`CommandResult` (eject, power off, power profile, media, seek, End
  task, containers, Docker Desktop, settings, geocoding, history), the shared HTTP client (rustls, https only, size
  limits), the `opaline-asset://` scheme in the layer.
- **`opaline --dump [prefix]`** and the full **`--diagnose`** (1.18).

**Findings on this laptop**
- The internal SATA SSD reports **4 bad sectors** (UDisks2 `SmartNumBadSectors`); `storage.health` shows it as a
  warning. Worth keeping an eye on; the NVMe is fine (16 % used, 100 % spare).
- GNOME shows **no microphone indicator** while Opaline captures the default sink's monitor (SENSORS.md).
- SCSI model names are 16 bytes in sysfs ("Samsung SSD 870"); UDisks2 has the full name.

**Acceptance (brief §10, P1)** — `scripts/acceptance-p1.sh`, values sampled seconds apart

| Reference | Opaline | Reference tool | Result |
| - | - | - | - |
| `top` | CPU 1.6 % | 2.8 % (idle 97.2) | ✅ live value, sampled a moment apart |
| `free -b` | used 4 242 MB, available 11 750 MB | used 4 223 MB, available 11 769 MB | ✅ same formula (total − available) |
| `sensors` (hwmon; lm-sensors isn't installed) | CPU 45 °C, NVMe 25.85 °C | coretemp 50 °C, nvme 24.85 °C | ✅ live temperatures |
| `nvidia-smi` | 3 %, 46 °C, 33 MiB, 5.1 W, P8 | 3 %, 45 °C, 33 MiB, 5.15 W, P8 | ✅ |
| `df -B1` | `/` used 205 290 618 880, avail 270 953 213 952 | identical | ✅ |
| `ip -s link` | eno1 down, wlo1 up | eno1 DOWN, wlo1 UP | ✅ |
| `upower -d` | 100 %, full, capacity 75.0 % | 100 %, fully-charged, 75.0095 % | ✅ |
| `docker ps -a` | Docker Desktop stopped: "desktop-stopped". Started (2026-11-23): engine 29.8.2 via `context:desktop-linux`, container `n8n` (`n8nio/n8n:latest`, exited, "Exited (0) 6 weeks ago") | same container, image and status | ✅ (CPU/memory per container only exist while one runs; covered by unit tests) |
| Parser tests on all fixtures | | | ✅ |
| dGPU (ADR 0003) | sleeping-card fixture: no NVML, no device reads; on this laptop NVML holds no `/dev/nvidia*` after release (`cargo test -p opaline-core -- --ignored nvml`) | | ✅ (the RTD3 check needs a machine that supports RTD3) |

Wi-Fi: Opaline's bitrate is the link's current rate (NetworkManager `Bitrate`); `nmcli dev wifi` shows the access
point's maximum rate, so those differ by design.

**Budget** (release, idle, layer showing the test card): CPU **0.08 %**; memory **283 MB** against 280. Core itself is
29 MB. The rise from 259 MB is in shared libraries, not in Opaline's own memory: PSS splits a shared library's pages
between all processes that map it, and with fewer other Mesa users running right now, the layer's and web process's
share of `libLLVM` grew from 15 to 21.7 MB each. The PSS budget therefore moves with whatever else runs; Phase 7
(budgets) needs to take that into account.

**Not done yet / moved**
- Automatic weather location (Location portal) moves to onboarding (P6), where the user is asked first.
- Data usage is kept in `~/.local/share/opaline/data-usage.json` (atomic writes every 10 min) instead of the history
  database; it is small and keeps working if SQLite is unavailable.
- Core-side notification text is English until the Phase 7 translations.
- `RDATE` and `RANGE=THISANDFUTURE` in recurring events (ADR 0010).

**Needs you**
1. Optional: install the privileged helper to try CPU power (`sudo` copy of three files and the binary; I'll give you
   the exact commands, or it waits for the `.deb` in Phase 8).
2. Optional: play some music for a minute, so I can check the visualizer levels and the media widget's data live.

# ADR 0009: One WebKit web process for all layer windows

Status: accepted (Phase 0 spike B) · 2026-11-22 · budget raised to 280 MB on 2026-11-23, to 450 MB on 2026-11-25

## Context
The RAM budget is 220 MB for core plus layer (brief §7). This laptop has two monitors, so the layer has two windows.
By default WebKitGTK gives every webview its own web process.

Measured with the Phase 0 test widget (PSS from `smaps_rollup`, `scripts/measure-budget.sh`):

| Setup | core | layer | network proc. | web proc(s). | total |
| - | - | - | - | - | - |
| debug, one web process per window | 34 MB | 66 MB | 14 MB | 82 + 82 MB | **271 MB** |
| debug, shared web process | 34 MB | 69 MB | 15 MB | 111 MB | **224 MB** |
| release, shared web process (webviews never drawn, see below) | 25 MB | 60 MB | 15 MB | 109 MB | 209 MB |
| **release, shared web process, drawing** (2026-11-23) | 27 MB | 105 MB | 16 MB | 130 MB | **278 MB** |

Idle CPU, release build, 60 s, with the 1 Hz test topic subscribed: **0.062 %** of the machine (budget 0.5 %); 0.13 %
once the windows actually draw (20 s).

**Correction (2026-11-23):** the first three rows were measured while a bug kept the webviews unmapped (the windows
were shown with `show()` instead of `show_all()`), so WebKit never painted anything. With the windows really drawing,
the same setup uses **278 MB**, 58 MB over budget. Sharing the web process is still right; it isn't enough on its own.

### Memory levers, measured 2026-11-23
Release build, two monitors, test card, PSS after 20 s settle, three runs each (spread under 1.5 MB):

| Setup | total | notes |
| - | - | - |
| windows drawing, default drivers | 278 MB | 32 MB of X11 shared-memory window buffers in the layer (Xwayland draws at 2×) |
| only Mesa's EGL (`__EGL_VENDOR_LIBRARY_FILENAMES`) | 258 MB | glvnd otherwise loads NVIDIA's *and* Mesa's EGL into the layer and the web process |
| + glass canvas sized to the card, not the window | 259 MB | saves GPU memory, which PSS doesn't count |
| + windows 480×320 instead of the work area (experiment) | 230 MB | the window buffers are most of the rest |
| + `DocumentViewer` cache model, page cache off | 230 MB | no effect; not kept |
| + JavaScriptCore without the optimizing JIT (`JSC_useDFGJIT=0`) | 226 MB | |
| + JavaScriptCore without any JIT (`JSC_useJIT=0`) | 220 MB | costs CPU for any real JavaScript work |
| only NVIDIA's EGL | n/a | the layer doesn't start |

**Kept:** Mesa-only EGL for the layer when an Intel or AMD GPU is present and the user hasn't set the variable (an
NVIDIA-only machine keeps its driver), and the card-sized canvas (the real compositor in P2 must not draw into a
full-window canvas either). Result: **259 MB**.

**Left open (needs a decision):** sizing the windows to the widgets instead of the whole work area (about −29 MB, but
the windows then have to move and resize with the widgets, and edit mode needs the full area), turning off the JIT,
or a higher budget. Native mode (no Xwayland 2× buffers) isn't measured yet.

## Decision
The first layer window is created normally. Every further window is created with
`WebviewWindowBuilder::with_related_view(<first window's WebKit view>)` (built on the main thread inside
`with_webview`, because the WebKit view isn't `Send`), so all of them share one web process.

## Consequences
- **Budget raised to 280 MB (your decision, 2026-11-23).** The brief's 220 MB can't be met with two WebKit windows
  through Xwayland without trading away JIT performance, and real widgets will add to the test card. 259 MB leaves
  21 MB of headroom. The windows-sized-to-widgets lever is built with the grid engine in Phase 5 (it needs widget
  bounds and a full-area edit mode), Native mode is measured in Phase 4, and then we see whether the budget can come
  back down. Memory is still the tightest budget.
  Planned work:
  - P2/P3: watch the web-process size as widgets land (Lab measurement in CI);
  - P4: measure Native mode; P5: windows sized to the widgets;
  - keep the frontend bundle small (no UI kit, code-split detail views and the picker).
  (Cache model and page cache were tried and made no difference. WebKit's memory-pressure settings for the web
  process can only be set when its web context is created, which Tauri does for us.)
  If even 280 MB can't be met with the real widget set, I'll bring you numbers and options first.
- A crash of the shared web process blanks every layer window at once; the layer has to bring them back (added in
  P4 with the other robustness work; since 2026-11-25 it recreates them, see "Found on the way" below).

## Update 2026-11-25 (Opaline 2.0, Phase 0): budget raised to 450 MB

**Measured** (release build of `main`, Native mode, both monitors, the owner's five-widget layout, PSS with
`scripts/memory-breakdown.sh`; Peek and Edit driven with `opaline --peek` / `--edit`):

| State | core | layer | network | web process | total |
| - | - | - | - | - | - |
| fresh start | 33–60 MB | 85–100 MB | 16 MB | 146–153 MB | 300–330 MB |
| 90 s of Peek (widgets visible, values updating) | 70–80 MB | 94–108 MB | 16 MB | 203 MB | 370–400 MB |
| after Peek + 4–8 Edit sessions | 70–110 MB | 94–108 MB | 16 MB | 238–305 MB | 430–505 MB |
| installed 1.1.0 after 2 h 43 min / 3 h 28 min of normal use | 70–78 MB | 92 MB | 16 MB | 244–248 MB | 426–429 MB |

**What grows and why:**
- The **web process** grows while widgets are visible and their values change (about 0.5 MB/s with springs; five
  times slower with animations off) and in Edit mode (the first session adds 10–30 MB), and keeps that memory. It
  levels off rather than growing forever (426 MB after 2.7 h, 429 MB after 3.5 h).
- It is **not** a JavaScript leak (a JavaScriptCore GC log in WPE WebKit shows a bounded heap), **not** Tauri's
  channel delivery (120 `eval` messages/s for over 2 minutes: +0.4 MB), **not** the visualizer (flat on its own),
  and **not** `will-change` on the odometer digits.
- Reloading the pages doesn't release it; only a new web process does (a fresh one is 90–110 MB again).
- **Core** keeps short peaks (wallpaper rendering, about 16 MB for NVML while a GPU widget is visible) because glibc
  doesn't return freed memory; its heap swings between 12 and 80 MB.

**Options offered:** recycle the web process while the layer is hidden, size the windows to the widgets outside
Edit/Peek (about −29 MB), glibc tunables for core, fewer animation frames, or a higher budget.

**Decision (owner, 2026-11-25): raise the RAM budget to 450 MB PSS** (default layout, both monitors, including after
Edit and long use). The levers above stay documented here for later; every 2.0 feature still states its memory
cost, and `scripts/memory-trend.sh` records long runs.

**Found on the way:** after a crash of the shared web process the layer recovered, but the two windows then ran in
two web processes (about +60 MB until Opaline restarted), because a related view only shares a process when it is
created. **Fixed 2026-11-25:** on termination the layer no longer reloads each window in place; it destroys all layer
windows and creates them again, the first one normally and the rest as related views of it, so they share one new web
process (`windows.rs`, `recreate_all`). The termination signal arrives once per window; they are folded into one
recovery. Backoff: 250 ms before the first recovery, doubling for each further one, at most 5 per minute.

# ADR 0009: One WebKit web process for all layer windows

Status: accepted (Phase 0 spike B) · 2026-11-22

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

## Decision
The first layer window is created normally. Every further window is created with
`WebviewWindowBuilder::with_related_view(<first window's WebKit view>)` (built on the main thread inside
`with_webview`, because the WebKit view isn't `Send`), so all of them share one web process.

## Consequences
- At 278 MB we're **over the 220 MB budget** before any real widget exists. Memory is the tightest budget.
  Planned work:
  - P2/P3: watch the web-process size as widgets land (Lab measurement in CI);
  - try WebKit's memory-pressure settings (`WebKitMemoryPressureSettings`: lower limit, earlier conservative and
    strict thresholds) and turning off the page cache and back/forward cache for layer views;
  - keep the frontend bundle small (no UI kit, code-split detail views and the picker).
  If the budget can't be met with the real widget set, I'll bring you numbers and options before relaxing it.
- A crash of the shared web process blanks every layer window at once; the layer has to reload them (added in P4
  with the other robustness work).

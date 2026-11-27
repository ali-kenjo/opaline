# FIX_HANDOFF: shared state for Claude Code and Antigravity

Task description: `FIX_PROMPT.md`. Update this file after every completed step. Delete both files at the very end
(see section 4.6 of the prompt).

## Resume here
- **Active tool:** Claude Code (started 2026-11-27)
- **Current step:** 1.1 and 1.2 code fixes committed; real-app Clock check (layer on the desktop) still to do; plugin watchdog fix (audit) in progress.
- **Next action:** finish the PluginWatchdog pause fix (`app/src/plugins/pluginSandbox.ts`, `PluginWidget.tsx`, test in `hostile.test.ts`), then the real-app Clock check, then 1.3.
- **Files touched so far:** `app/src/compose/render/View.tsx`, `app/src/compose/runtime.ts`, `app/src/compose/runtime.test.ts`, `app/src/compose/render/View.clock.test.tsx` (new)
- **Commands still to run:** see section 2 of the prompt (full gate) and the real-app checks in 1.1 and 1.2.

## Status board
| Item | Status | Evidence (commands + results, commit hash) |
| - | - | - |
| 1.1 Clock freeze: tests that fail on old code | done | `app/src/compose/render/View.clock.test.tsx` (7 tests: seconds on 12 s, seconds off minute boundary + `evaluations` unchanged, timer fires early (env clock 20 ms behind), pause/resume +90 s, suspend +3 min with seconds off, hidden face does not keep the view awake, unmount leaves 0 timers). With `View.tsx` from HEAD: 6 of 7 fail (unmount passes trivially); with the fix: 7/7. |
| 1.1 Clock freeze: fix in View.tsx | done | Wake read in a `useEffect` after every commit via new `Runtime.settle()`; wait measured on `runtime.now()`, re-checked when the timer fires, capped at 5 s (suspend). `pnpm test` 327 passed, `pnpm lint`/`typecheck` OK, e2e `round1`, `looks`, `lab` 32/32 (baselines unchanged). |
| 1.1 Clock real-app check (seconds on/off, lock/unlock, covered window, all faces) | todo | |
| 1.2 Timers wall-clock fix + tests (incl. old-format file) | done | `crates/opaline-core/src/providers/timers.rs`: persisted `endsAtMs` (timer/Pomodoro) and `startedAtMs` (stopwatch), `#[serde(default)]`, stripped from `timers.state` (shape test). 11 unit tests (late tick, suspend gap, restart, expired-while-down once, Pomodoro one phase after 3 h, midnight, pause/resume re-base, clock set back, published shape, late notification text) + `tests/migrations.rs::v2_0_timers_file_loads_and_resumes_from_its_saved_values` with `fixtures/v2.0/timers.json`. `cargo test -p opaline-core`: 220 lib + all integration OK; clippy/fmt OK. |
| 1.2 Timers real-app check (`--dump timers.`, suspend/restart) | done (restart/downtime); suspend covered by unit tests only | Debug build, isolated `XDG_*` dirs in the scratchpad. File with Pomodoro ended 10 min ago, Tea ending in 20 s, stopwatch started 1 h ago → `--dump timers.`: Pomodoro `running=false phase=break done=3` (was 2), Tea `remaining=17844`, stopwatch `elapsed=3602156`, no `*AtMs` keys in the topic. Two more runs (restarts): Tea 5427 → 1326 (wall clock across the gaps), Pomodoro stays done=3; next runs: Tea finished, saved `running=false`, not finished again. `dbus-monitor`: an expired Pomodoro sent exactly one `Notify` ("Focus (Work complete) (finished at 21:11)") over two runs. A real suspend wasn't done (it would interrupt the owner's session). |
| 1.3a Locale in dates | todo | |
| 1.3b Automation `time.*` documented | todo | |
| 1.3c Memory tile clipping | todo | |
| 2 Audit of timers/intervals | todo | |
| 2 Known open items from docs/HANDOFF.md ("Open:") | todo | |
| 2 Full gate (cargo test/clippy/fmt, pnpm lint/typecheck/test/test:e2e, lint:helper) | todo | |
| 4.5 docs/HANDOFF.md + docs/PROGRESS.md updated | todo | |
| 4.6 Prompt files removed locally and on GitHub | todo | |

## Findings log (newest first)
(Add anything new you find: file, what is wrong, fixed / not a bug / left open, and why.)

- **Audit: plugin watchdog restarted every plugin after a covered window or suspend (fixed).** `app/src/plugins/PluginWidget.tsx` pings every 500 ms and `PluginWatchdog.check()` terminates when the last pong is older than 2 s. WebKit pauses timers in a covered layer window (and nothing runs while the machine sleeps), so the first heartbeat after it saw a stale pong and killed a healthy plugin (state lost, "Restarting (heartbeat-timeout)"). Now the watchdog knows the check cadence (`checkEveryMs`); a gap between checks longer than max(deadline, 4 × cadence) restarts the deadline instead. A plugin that really stops answering is still caught 2 s later. Tests in `app/src/plugins/hostile.test.ts` (both fail on the old code).

- **1.2 Timers (fixed):** confirmed by reading and by tests: `run` added a constant 1000 ms per `interval` tick (monotonic, stops in suspend, late under load) and running values were only saved on actions, so a restart resumed from stale values. Also found: the Pomodoro daily counter only rolled over on a user action (now also in the tick loop), and a work phase that ended before midnight while asleep would have counted for the new day (now only if it ended after local midnight). A wall clock set backwards pauses an entry for that step instead of running it backwards. `MissedTickBehavior::Skip` (no burst of catch-up ticks). `timers.tsx` only displays `remainingMs`/`elapsedMs` from core (no own clock), so no double counting.

- **1.1 Clock freeze, two more defects found while fixing (fixed).** (a) `Runtime.nextWake()` takes the minimum over *every* memo, including results nothing reads any more (another size's layout, a hidden face, `bind.time` after seconds were turned on). Those stay stale forever, so an effect that runs after every commit would see a wake in the past and re-render in a tight loop. New `Runtime.settle()` only considers memos read since its last call (a render pass) and is what the view uses; `nextWake()` is unchanged. (b) The old timeout was measured on `Date.now()` while the memo uses `env.now()`; in Lab still mode (`now` fixed) or with any clock offset the two disagree. The view now measures on `runtime.now()` and, when the timer fires before the wake, just re-arms without re-rendering, so a fixed clock costs one idle timer and no renders. (c) Timers use the monotonic clock, which stops during suspend: a minute clock could stay up to 60 s behind after resume. Sleeps are capped at 5 s (no render, no evaluation in between).
- **1.1 Clock freeze root cause (confirmed):** `CompositionView` called `runtime.nextWake()` in its render body, before its children had read their fields: the first render scheduled nothing, later renders were one pass behind, and the effect keyed on `[wake]` stopped re-running.

## Session log
(One line per session: tool, date/time, what you did, what is left.)

- Claude Code, 2026-11-27 evening: started; 1.1 fix + tests.

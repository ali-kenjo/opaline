# FIX_HANDOFF: shared state for Claude Code and Antigravity

Task description: `FIX_PROMPT.md`. Update this file after every completed step. Delete both files at the very end
(see section 4.6 of the prompt).

## Resume here
- **Active tool:** Claude Code (started 2026-11-27)
- **Current step:** 1.1 code fix committed; real-app check of the Clock next.
- **Next action:** build the debug app (`cd app && pnpm tauri build --debug --no-bundle`), run it against a config copy, compare Clock seconds on/off with the top bar; then 1.2 (timers).
- **Files touched so far:** `app/src/compose/render/View.tsx`, `app/src/compose/runtime.ts`, `app/src/compose/runtime.test.ts`, `app/src/compose/render/View.clock.test.tsx` (new)
- **Commands still to run:** see section 2 of the prompt (full gate) and the real-app checks in 1.1 and 1.2.

## Status board
| Item | Status | Evidence (commands + results, commit hash) |
| - | - | - |
| 1.1 Clock freeze: tests that fail on old code | done | `app/src/compose/render/View.clock.test.tsx` (7 tests: seconds on 12 s, seconds off minute boundary + `evaluations` unchanged, timer fires early (env clock 20 ms behind), pause/resume +90 s, suspend +3 min with seconds off, hidden face does not keep the view awake, unmount leaves 0 timers). With `View.tsx` from HEAD: 6 of 7 fail (unmount passes trivially); with the fix: 7/7. |
| 1.1 Clock freeze: fix in View.tsx | done | Wake read in a `useEffect` after every commit via new `Runtime.settle()`; wait measured on `runtime.now()`, re-checked when the timer fires, capped at 5 s (suspend). `pnpm test` 327 passed, `pnpm lint`/`typecheck` OK, e2e `round1`, `looks`, `lab` 32/32 (baselines unchanged). |
| 1.1 Clock real-app check (seconds on/off, lock/unlock, covered window, all faces) | todo | |
| 1.2 Timers wall-clock fix + tests (incl. old-format file) | todo | |
| 1.2 Timers real-app check (`--dump timers.`, suspend/restart) | todo | |
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

- **1.1 Clock freeze, two more defects found while fixing (fixed).** (a) `Runtime.nextWake()` takes the minimum over *every* memo, including results nothing reads any more (another size's layout, a hidden face, `bind.time` after seconds were turned on). Those stay stale forever, so an effect that runs after every commit would see a wake in the past and re-render in a tight loop. New `Runtime.settle()` only considers memos read since its last call (a render pass) and is what the view uses; `nextWake()` is unchanged. (b) The old timeout was measured on `Date.now()` while the memo uses `env.now()`; in Lab still mode (`now` fixed) or with any clock offset the two disagree. The view now measures on `runtime.now()` and, when the timer fires before the wake, just re-arms without re-rendering, so a fixed clock costs one idle timer and no renders. (c) Timers use the monotonic clock, which stops during suspend: a minute clock could stay up to 60 s behind after resume. Sleeps are capped at 5 s (no render, no evaluation in between).
- **1.1 Clock freeze root cause (confirmed):** `CompositionView` called `runtime.nextWake()` in its render body, before its children had read their fields: the first render scheduled nothing, later renders were one pass behind, and the effect keyed on `[wake]` stopped re-running.

## Session log
(One line per session: tool, date/time, what you did, what is left.)

- Claude Code, 2026-11-27 evening: started; 1.1 fix + tests.

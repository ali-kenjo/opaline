# Task: fix the frozen Clock, the drifting Timers, and audit Opaline for related bugs

You are continuing work on **Opaline** (repo root = the folder this file is in; branch `main`; remote `origin` =
`github.com/ali-kenjo/opaline`). Two different AI coding tools (Claude Code and Antigravity) share this task and
may take over from each other at any time because of usage limits. **`FIX_HANDOFF.md` is the shared state.** Read it
first, keep it current, and follow the rules in "Working with the other tool" below.

Goal: a fully working result, not a minimal patch. Each fix needs a root-cause explanation, a regression test, and
verification against the real app where that is possible.

---

## 0. Before you start (every session, both tools)

1. Read `FIX_HANDOFF.md` completely. It says what is done, what is in progress, and where to resume.
2. Read `CLAUDE.md` (Antigravity does not load it automatically). The rules that matter here:
   - Rust: no `unwrap`/`expect`/`panic` outside tests (workspace lints deny them); `cargo clippy ... -D warnings`;
     rustfmt. Providers must never be able to crash core.
   - TypeScript strict, ESLint strictTypeChecked + React Compiler rules, Prettier. No TODO/FIXME without an issue number.
   - The React Compiler lint forbids reading refs or mutating state during render. Keep mutable buffers in a class
     instance from `useState(() => new X())` and mutate them in effects.
   - Animations go through `design-system/motion` `scheduler`, never their own `requestAnimationFrame` loop.
   - Real data only in the product; mocks only in tests and the Widget Lab.
   - Run reference tools with `LC_ALL=C` (this machine is `de_DE`).
   - **WebKit pauses timers in a fully covered layer window**; diagnostics with `setTimeout` need the window visible
     (Peek: `./target/debug/opaline --peek`).
3. Skim `docs/HANDOFF.md` (project state) and `docs/COMPOSITION.md` (composition engine).
4. Run `git status` and `git log --oneline -5`. If there are uncommitted changes you did not make, the other tool
   probably stopped mid-step: read `git diff`, compare with `FIX_HANDOFF.md`, and continue from them. Never discard
   or `git checkout` someone else's work.
5. Do not edit anything in `.claude/` and never stage it (`git add -A` is forbidden here; stage explicit paths).

---

## 1. Findings (already diagnosed; verify, then fix)

### 1.1 The Clock freezes (confirmed, reproduced). Priority 1

**Symptom:** the Clock widget shows the right time at first and then stops following the system time. In the owner's
screenshot the widget read 21:04:21 while the GNOME top bar read 21:05:37 (76 s behind). It only moves when
something else forces a re-render.

**Root cause:** `app/src/compose/render/View.tsx`, `CompositionView`. It calls `runtime.nextWake()` in the render
body to compute `wake`, then schedules a `setTimeout` in a `useEffect` keyed on `[wake]`. But `nextWake()` reads the
runtime's memo table, and that table is only filled while the **children** (`NodeView` -> `useField` -> `rt.read`)
render, which happens *after* the parent's body ran. Consequences:
- First render: memo empty -> `wake === null` -> **no timer is ever scheduled**.
- Afterwards `wake` is always one render behind. A timer fires, `setTick` re-renders, the children re-evaluate and
  compute a new `nextAt`, but the effect only re-runs when `wake` *changes*. In practice the chain dies after one or two
  ticks. A timer that fires 1 ms early (browsers do this) also breaks it, because the memo is still "fresh" and
  nothing reschedules.

Only the Clock composition reads `now()` (`spec/compositions/clock.json`, `app/src/widgets/clock.composition.ts`), so
only the Clock is visibly affected; the bug is in generic code, so any future composition using `now()`/`until()` would be too.

**Why the tests missed it:** `app/src/compose/render/View.test.tsx` renders with a frozen `now: () => 0`;
`runtime.test.ts` only tests `nextWake()` on the runtime, without React.

**Reproduction that was run (outside the repo):** `CompositionView` + the real `clockComposition` (seconds on, 24 h
format) + fake timers, advancing 1 s eight times. Before the fix the text stayed at the start value for all 8 seconds;
after the fix it advanced every second. Re-create this as a permanent test.

**Intended fix (verified in the isolated copy):** stop computing the wake time in the render body. Read
`runtime.nextWake()` inside a `useEffect` that runs **after every commit** (no dependency array), so the children's
memos exist. Schedule one timeout for `max(0, wake - Date.now()) + 5`, clear it in the cleanup, and `setTick` when it
fires. Because the effect re-runs after each commit, a timer that fires early simply schedules the next one. Do not
change `runtime.ts` semantics (`nextAt` per memo, `step` per skeleton) unless you find a separate real defect. Make
sure it passes the React Compiler lint, and that a hidden/covered window resuming after a pause catches up on the
next timer (no accumulated state).

**Tests to add (permanent, in `app/src/compose/render/View.test.tsx` or a new `View.clock.test.tsx`):**
1. Real Clock composition, seconds **on**: with fake timers and a mocked `Date`, the displayed time advances every second for >= 10 s, starting from a non-aligned time (e.g. x:xx:20.100).
2. Seconds **off**: the text stays constant within a minute and changes exactly at the minute boundary (and does not re-render every second: assert the evaluation count via `runtime.evaluations`).
3. Timer fires 1 ms early: the clock still advances (simulate with a `now()` that lags).
4. Pause/resume: advance system time by 90 s in one step; the next timer shows the correct time, not an intermediate one.
5. Unmount clears the timer (no timers left with `vi.getTimerCount()`).
Make sure these tests **fail on the old code** (check this by temporarily stashing the fix) and pass on the new code.

**Real-app verification (required):** build and run the real app (`cd app && pnpm tauri build --debug --no-bundle`,
then `./target/debug/opaline`), place a Clock with seconds on and a Clock with seconds off, and compare with the GNOME top
bar for at least 3 minutes. Then: lock and unlock the screen, and cover the layer with a fullscreen window for about a minute and
uncover it. The Clock must be correct again within about 1 s each time. Record what you saw in `FIX_HANDOFF.md`.
Check the other clock faces (analog tick, analog sweep, flip, word, segment, binary, day-ring) in the Widget Lab or the real layer; they
all read `now()`.

### 1.2 Timers, Stopwatch and Pomodoro lose time (found by reading, not yet reproduced). Priority 2

File: `crates/opaline-core/src/providers/timers.rs` (`run`, `tick_store`, `TimerEntry`, `save_store`). Frontend: `app/src/widgets/timers.tsx`.

Problems:
- `run` ticks with `tokio::time::interval(1 s)` and calls `tick_store(&mut st, 1000)`, i.e. it assumes every tick is
  exactly 1000 ms. The interval runs on the monotonic clock, which does **not** advance during system suspend, and ticks can
  also be late under load. After a laptop sleep a running stopwatch/timer/Pomodoro is behind real time.
- The running state is only saved on a user action or when a timer finishes (`save_store`). A core restart or crash
  resumes a `running: true` timer from a stale `remaining_ms`/`elapsed_ms`, losing all downtime.

Intended behaviour: running timers follow the **wall clock**.
- Persist absolute timestamps for running entries (e.g. the wall-clock start/end time in ms) in `timers.json` and derive `remaining_ms` / `elapsed_ms` from `now - timestamp` on every tick. Keep the published `timers.state` topic shape
  (`remainingMs`, `elapsedMs`, `running`, ...) **unchanged**: widgets, the SDK docs and custom widgets rely on it.
  The new persisted fields must be `#[serde(default)]`, so old `timers.json` files still load (add a migration/compat test in the style of
  `crates/opaline-core/tests/migrations.rs`).
- Use the real elapsed time since the last tick (or the stored timestamps) instead of the constant `1000`.
- A countdown that expired while the computer slept or core was down: finish it exactly once, send one notification
  ("finished while asleep"/similar, no spam), and do not repeat on every tick. Pomodoro: advance **one** phase, not a chain through
  several phases; the daily counter must increase at most once per finished work phase.
- Pause/resume/reset/lap/next-phase must stay correct (re-base the timestamps on every action). Midnight rollover of `pomo_completed_today` must keep working.
- Keep `tick_store` pure and unit-tested; add tests for: late tick, suspend gap, restart with a running timer, expired-while-down,
  Pomodoro phase change after a long gap, old-format file. No `unwrap`/`expect`.
- Check `app/src/widgets/timers.tsx` and any countdown/world-clock widget for their own clock logic (`Date.now`, intervals) and make sure they display
  from the new state correctly (no double counting).
Verify with `./target/debug/opaline --dump timers.` and a real run (start a 1-minute timer, suspend/resume or stop and restart core, confirm).

### 1.3 Smaller items

a) **Locale in dates.** `app/src/compose/widget.tsx` passes `date: (ms, skeleton, zone) => formatDate(ms, skeleton, zone)`
   without the widget's `locale`, so dates use the WebView default locale. `app/src/compose/render/context.ts` `asString`
   hard-codes `"en"`. Decide whether the `locale` already computed in `widget.tsx` should be passed through; the machine is `de_DE`
   and the German date output is currently correct, so first prove there is a real mismatch case (e.g. LANG differs from
   the WebView language) before changing behaviour. If you change it, do not alter expression-language semantics; the Rust and TS
   implementations must keep passing `spec/expressions/*.json` (change the corpus first, then both sides).
b) **Automation `time.*`.** `crates/opaline-core/src/automation.rs` hard-codes `time.isNight` as outside 06:00-21:00 and uses `Locale::En`
   in `SnapshotExprHost`. Do **not** change behaviour; confirm it is documented (add one line to the relevant doc if not).
c) **Visual issue to check: Memory widget, small vertical tile.** In the owner's desktop screenshot (1920x1080, German UI, dark
   Opaline look) the narrow memory tile (about 74 px wide, 175 px tall, left of the "5,7 GB / 16,0 GB" text) shows the
   hero "36%" and, below it, "5,7 GB" and "16,0 GB". The "5,7 GB" line looks clipped/overlapped by a stray glyph at its right edge.
   The owner can attach the screenshot to your chat. Reproduce it in the Widget Lab or with the real layer using German number formatting
   (decimal comma), the same size class, and the same text scale. The project promises zero truncation (see `app/e2e/truncation.spec.ts`
   and `contrast.spec.ts`). If you confirm it, fix the layout (`spec/compositions/memory.json` /
   `app/src/widgets/memory.composition.ts` and the visual in `app/src/compose/render/monitorVisuals.tsx`), keep both in sync (a test compares them),
   and add a truncation e2e case. If you cannot reproduce it, say so in `FIX_HANDOFF.md`.

---

## 2. Broader audit (after 1.1 to 1.3)

Look for more bugs of the same kinds, and fix what is real:
- **Time and timer assumptions.** Review every `setTimeout`/`setInterval` in `app/src` and every `tokio::time::interval` /
  `Instant`-based accumulation in `crates/`. Hunting for: code that assumes exact tick spacing, schedule values computed before the data they depend on exists, effects whose dependencies hide a needed re-run, timers not cleared on unmount, and
  anything that misbehaves after suspend/resume or while the window is covered. Starting points: `app/src/compose/render/round3Visuals.tsx`
  (~line 586), `app/src/widgets/media.tsx` (~45), `app/src/layer/StackWidget.tsx`, `app/src/compose/render/blocks.tsx`,
  `crates/opaline-core/src/automation.rs` (~622), `engine/sampler.rs`, `sources/manager.rs`, `providers/photos.rs`, `providers/audio.rs`.
- Known open items already listed in `docs/HANDOFF.md` (search for "Open:"): weather card clipping its top line at 4x2 in the Lab, hero numbers in small cards, GPU card empty state, Storage `UNKNOWN` in red. Re-check them; fix any that are quick and clearly wrong.
- Run the complete quality gate and fix real failures you introduced or find:
  - `cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings && cargo fmt --all --check`
  - `cd app && pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`
  - `cd app && pnpm lint:helper`
  - Lab screenshot baselines must not change unless the change is intended: look at the diff first, and only then `pnpm exec playwright test --update-snapshots=all`.
- Report every finding in `FIX_HANDOFF.md` as: fixed / not a bug (with evidence) / left open (with reason). Do not silently skip items.

---

## 3. Working with the other tool

- `FIX_HANDOFF.md` has a **"Resume here"** section at the top. Rewrite it after every completed step and **before** you expect your usage
  limit to run out: current step, exact next action, files touched, commands still to run.
- Only one tool works at a time. At the start set `Active tool:` in the handoff file; at the end of your session clear it.
- Make small commits, one per logical fix (Clock fix + tests; Timers fix + tests; locale; memory tile; ...), so a half-finished state is never lost.
  Include the updated `FIX_HANDOFF.md` in your commits.
- Commit rules (from `CLAUDE.md`): conventional commits (`fix(compose): ...`, `fix(core): ...`, `test(...)`, `docs: ...`); the author is already set in this
  repo's git config (`ali-kenjo`); do not change git config; **no `Co-Authored-By` and no "Generated with" lines.**
- **Push** to `origin main` after each commit once its checks pass (`git push origin main`). If a push is rejected, `git pull --rebase origin main` and retry. Never force-push.
- Never claim something is verified unless you ran it; write the command and its result in the handoff.

---

## 4. Definition of done

1. The Clock follows the system time in the real app (seconds on and off, and after lock/unlock and a covered window), with permanent tests that fail on the old code.
2. Timers/Stopwatch/Pomodoro survive suspend and core restarts, tested at the pure-function level and in a real run.
3. Every item in 1.3 and 2 is marked fixed / not a bug / left open in `FIX_HANDOFF.md`, with evidence.
4. The full gate in section 2 passes (or any pre-existing failure is documented with proof it existed before your change).
5. Add a short "Fixes after v2.0.1" section to `docs/HANDOFF.md` and a line in `docs/PROGRESS.md` summarising what changed and why.
6. **Clean-up (last step, only after 1 to 5 are done and pushed):**
   - Delete `FIX_PROMPT.md` and `FIX_HANDOFF.md` from the folder with `git rm` (stage only those two paths).
   - Commit as `chore: remove temporary fix prompt files` (no `Co-Authored-By` line) and `git push origin main`.
   - Verify: `ls FIX_*` finds nothing, `git ls-files | grep '^FIX_'` is empty, and after `git fetch origin`,
     `git ls-tree -r origin/main --name-only | grep '^FIX_'` is empty.
   - Tell the owner that the two files are gone from the folder and from the current state of GitHub, but still exist in git history
     (older commits); they contain no secrets. Do not rewrite or force-push history unless the owner asks.

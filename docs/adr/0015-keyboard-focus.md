# ADR 0015: Keyboard focus and clicks on the desktop layer (spike S3)

Status: proposed, measurement in progress · 2026-11-26 (Opaline 2.0, Phase 2)

## Context
2.0 adds interactive blocks (buttons, toggles, sliders, text fields; docs/COMPOSITION.md) and keyboard navigation
inside widgets. The plan's spike S3 asks: can the layer take focus on click without rising above normal windows, and
give it back on Esc or a click elsewhere, in Native and Instant mode?

Today the layer is click-through everywhere except while Peek, Edit or an overlay is open (`LayerApp` sets the
input region to the full window then, and to nothing otherwise), so widgets on the desktop take no clicks.

## Measured so far (Native mode, GNOME 50.1, both monitors)
`lab.html?spike=focus` in the real layer windows (debug build, `OPALINE_LAYER_PAGE`), logging page events and, on
the Rust side, every button press and focus change the GTK window and the WebKit view receive. The owner clicked
and typed by hand, guided round by round.

1. **The layer steals keyboard focus when it starts.** In every run (5 of 5) the layer window on `HDMI-2` received
   focus while mapping, with nobody clicking, and took key presses meant for another app (arrow keys). This is a bug
   in today's Opaline, independent of 2.0 features: a desktop layer must never take focus on its own.
2. **A lowered layer window receives no pointer input in Native mode,** whatever input region it declares: a
   720 × 312 panel, the left half of the window, and the full window all gave zero button presses at the GTK level
   (3 runs, both monitors). Clicks went to what was below (the owner's window lost focus to the desktop).
3. **Under Peek** (the helper's `make_above` + `raise` + `activate`) the window got focus. The owner saw typing work,
   but the logs recorded no button press or key in that round, so this result is unconfirmed.

## Open questions
- Why a lowered Native layer window gets no pointer events (the helper doesn't touch input; DING is in its lower
  layer, no warning). Candidates: Mutter's handling of a window the helper keeps lowering, the input region not being
  committed for later changes, or pointer events going to a surface other than the one GTK reports.
- Instant mode (keep-below X11 window): not measured yet.

## Next measurement
An automated trace with Mutter's remote-desktop API (pointer clicks at known positions on the probe, no typing into
other windows), so every click is accounted for in the logs; then the same in Instant mode (helper briefly off).

## Decision (pending)
To be decided after the measurement. Whatever the result: fix finding 1 (layer windows never take focus on map;
focus only on an explicit click on an interactive block or during Peek/Edit).

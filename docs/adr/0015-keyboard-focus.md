# ADR 0015: Clicks and keyboard focus on the desktop layer (spike S3)

Status: accepted · 2026-11-26 (Opaline 2.0, Phase 2)

## Context
2.0 adds interactive blocks (buttons, toggles, sliders, text fields; docs/COMPOSITION.md) and keyboard navigation
inside widgets. The plan's spike S3 asks: can the layer take focus on click without rising above normal windows, and
give it back on Esc or a click elsewhere, in Native and Instant mode?

Today the layer is click-through everywhere except while Peek, Edit or an overlay is open (`LayerApp` sets the
input region to the full window then, and to nothing otherwise), so widgets on the desktop take no clicks.

## How it was measured
`lab.html?spike=focus` in the real layer windows (debug build, `OPALINE_LAYER_PAGE`): a text field that logs focus,
blur, pointer and key events (key names only) to the layer log, plus debug-only logging of every button press and
focus change the GTK window and WebKit view receive. Clicks and keys came from Mutter's remote-desktop API
(`scripts/remote-input.py`), on an empty workspace of the `HDMI-2` monitor. Before every click a one-frame
ScreenCast capture had to show the probe's own colours at the click spot, so no click could land in another window;
keys were sent only after the log showed the probe's field had focus. The stacking case opened an X11 test window
(`xmessage`) over the probe's edge, away from the field. Instant mode was reached by turning the helper off after
core started (core re-enables it on every start).

An earlier, guided round by hand concluded "no clicks reach a lowered layer"; it was wrong: maximized windows covered
the probe on both monitors. The automated trace above replaces it.

## Results

| | Native (Wayland, helper) | Instant (X11, keep-below) |
| - | - | - |
| Layer takes keyboard focus **when it starts**, unasked | ❌ yes, in every run (the owner's arrow keys went to the layer) | ❌ yes |
| A click inside the input region reaches the page (panel-sized or full-window region) | ✅ | ✅ |
| That click takes keyboard focus from the focused window | ✅ | ✅ |
| Typing reaches the field; Esc leaves the field | ✅ | ✅ |
| The layer **rises above** an overlapping window on that click | ✅ no (the window stays on top, after the click and after Esc) | ✅ no |
| Esc gives keyboard focus back to the other window | ❌ no: the field blurs, the layer keeps window focus | ❌ no |
| Peek (raise + activate + full region): click, focus, typing | ✅ | (not run; Peek in Instant lifts the window the same way) |

The "no rise" check is a capture 1 s after the click, so a one-frame raise-and-lower in Native (Mutter raises on
click, the helper lowers again on `restacked`) can't be excluded; the owner saw no jump by eye.

## Decision
1. **Interactive blocks are click targets on the desktop.** The layer's input region becomes the union of the
   rectangles of interactive blocks (button, toggle, slider, text input, and list items with an action), updated
   when the layout changes, plus the whole window during Peek, Edit and overlays as today. Everything else stays
   click-through, so desktop icons keep working around and between widgets.
2. **The layer never takes focus by itself.** Fix the start-up focus theft: Instant sets `focus-on-map` off (and a
   zero user time) on the layer windows; in Native the helper gives focus back to the previously focused window
   when a layer window takes it on map. A regression test runs the focus probe and fails on a focus event at load.
3. **Keyboard focus only while it's needed.** A click on a text input or slider keeps focus until Esc, a click
   elsewhere, or the action is done; a click on a button or toggle acts and hands focus back at once.
4. **Handing focus back:** Native gets a helper method (`ReleaseFocus`, Shell1 API v2 with N−1 compatibility, S8)
   that re-focuses the window that had focus before the click. Instant has no reliable way to focus another app's
   window, so focus stays on the layer until the user clicks elsewhere (documented limitation).
5. **No stacking change is needed:** the layer stays below normal windows while it has focus, in both modes.

## Consequences
- P2 follow-up: the focus-theft fix (decision 2), the interactive input region (decision 1) and focus hand-back on
  button clicks (decision 3) before the composed controls ship; `ReleaseFocus` joins the helper API v2 work.
- Side finding: core enables the helper on every start (`desktop::ensure_enabled`), overriding a user who turned it
  off on purpose. It should enable it only once after install (or when the user asks), not on every start.
- `scripts/remote-input.py` stays as a tool for checks on the real desktop; the probe page and its debug-only GTK
  logging stay for re-runs after GNOME or WebKitGTK updates.

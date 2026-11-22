# ADR 0006: Staying below windows and above DING

Status: accepted for Instant mode (Phase 0); Native mode verified in P4 · 2026-11-22 (revised)

## Context
GNOME 50's Mutter typelib (`Meta-18`) has `make_above`/`unmake_above`, `lower()`, `stick()` and the `restacked`
signal, but **no `make_below`**. The brief asks us to sit above DING's desktop icons and below every app window,
and never to fight DING.

The first draft of this ADR assumed DING shares the normal window layer with us and keeps itself at the bottom with
`lower()`. Reading DING's current code (`emulateX11WindowType.js`) during Phase 0 showed that DING also calls
`window.set_type?.(Meta.WindowType.DESKTOP)`, which moves its window into Mutter's **DESKTOP layer**, the lowest
layer. Mutter's layer order is DESKTOP < BOTTOM < NORMAL < TOP.

## Decision
- **Instant mode:** the layer window is keep-below (`_NET_WM_STATE_BELOW`), so it lives in the BOTTOM layer:
  above DING (DESKTOP layer) and below every normal window, enforced by Mutter itself. No restack handling needed.
- **Native mode:** the helper keeps the layer window in the NORMAL layer and calls `lower()` on it when a normal
  window ends up below it (checked on `restacked`, with a re-entrancy guard for the restack our own `lower()`
  causes). Because DING is in a lower layer, `lower()` can never put us below DING, so the two helpers can't
  ping-pong. `SetRaised(true)` (Peek/Edit) uses `make_above()`; `SetRaised(false)` undoes it and lowers again.
- We never change DING's window and never call `set_type(DESKTOP)` on ours, since that would put us in DING's layer
  and under its full-screen input surface.

## Consequences
Coexistence follows from Mutter's layers instead of from timing. If a future DING stops using the DESKTOP type, the
Native helper's `lower()` would put us below DING's window. To guard against that, `stacking.js` checks DING's
window type at runtime and logs a clear diagnostic if it changes.

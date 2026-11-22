# ADR 0008: Instant-mode window geometry under Xwayland

Status: accepted (Phase 0 spike C) · 2026-11-22

## What we measured on this machine
- With `xwayland-native-scaling` on and monitors at 1.25 and 1.0, **Xwayland runs the whole X11 screen at 2×**:
  `xrandr` shows eDP-1 as 3072×1728 at +0+0 and HDMI-2 as 3840×2160 at +3072+0, `Xft.dpi` is 192, and GTK3 X11
  windows get scale factor 2. Logical (Mutter) coordinates × 2 = X11 coordinates, so Tauri's logical positions
  land correctly.
- Mutter publishes per-monitor work areas to X11 clients (`_GTK_WORKAREAS_D0 = 0,64,3072,1530, 3072,0,3840,2160`),
  and Tauri's `Monitor::work_area()` returns them, keyed by the same connector names as Mutter.
- A keep-below + sticky + skip-taskbar window gets `_NET_WM_STATE_BELOW`, `_STICKY`, `_SKIP_TASKBAR`, `_SKIP_PAGER`.
- **Mutter ignored the requested position** of a new full-monitor window: the eDP-1 window was mapped on HDMI-2
  (the pointer's monitor), and when it overlapped the top bar its height grew by a 74 px frame extent. Moves after
  mapping from inside our process (`gtk_window_move`, `gdk_window_move`) didn't take effect; a move from another
  X client did.
- DING puts its own window in Mutter's DESKTOP layer (`set_type(Meta.WindowType.DESKTOP)`), so a keep-below window
  (BOTTOM layer) is always above DING's icons and below normal windows. Nothing has to fight over the stack.

## Decision
1. In Instant mode a layer window covers its monitor's **work area**, not the whole monitor. The widget grid only
   uses the work area anyway (brief §2.4). Edit/Peek backdrops then leave the top bar and dock visible, which is a
   reasonable look for an edit mode; revisit in P5 if a full-screen backdrop is wanted (it would be a separate,
   temporary window).
2. Windows are created hidden. Before mapping we set `WM_NORMAL_HINTS` with `USPosition` + `PPosition` and fixed
   min/max size (`gtk_window_set_geometry_hints`), then move and show. Mutter honours user-specified positions, and
   both windows land exactly in place (verified with `xwininfo`).
3. A `configure-event` guard moves a window back if anything else moves it (at most 4 corrections per second, then it
   logs and stops), like DING's `position-changed` handler.

## Consequences
- **Cost**: on a 1.0 monitor next to a fractional one, Instant mode renders at 2× and Mutter scales down, so it costs
  four times the pixels on HDMI-2 here. Native mode (a Wayland client) doesn't have this cost, which is one more
  reason to prefer it.
- Work-area changes in Instant mode (dock auto-hide, top-bar changes) aren't signalled yet; P4 adds a watch on the
  X11 `_GTK_WORKAREAS_D*` root properties.
- Still to check visually in P4 (needs you): Alt-Tab, overview and dock visibility, and Show Desktop.

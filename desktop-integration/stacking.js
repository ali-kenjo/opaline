// Keeps the layer's windows at the bottom of the normal windows (ADR 0006): DING's icon window
// lives in Mutter's DESKTOP layer below us, so lower() never fights it. Peek and Edit raise the
// layer above everything until dismissed. Also tells core which monitors are covered by a
// maximized or fullscreen window, so it can sample less and not render there.
import GLib from "gi://GLib";
import Meta from "gi://Meta";

const DING_WM_CLASS = "ding";

export class Stacking {
  constructor(layer, service) {
    this._layer = layer;
    this._service = service;
    this._raised = false;
    this._lowering = false;
    this._idle = 0;
    this._covered = new Map();
    this._signals = [];
    this._dingWarned = false;
    const on = (obj, sig, fn) => this._signals.push([obj, obj.connect(sig, fn)]);
    on(global.display, "restacked", () => this._schedule());
    on(global.display, "notify::focus-window", () => {
      this._schedule();
      this._service.setDesktopFocused(this._desktopFocused());
    });
    on(global.display, "in-fullscreen-changed", () => this._schedule());
    on(global.workspace_manager, "active-workspace-changed", () => this._schedule());
    on(global.window_manager, "size-changed", () => this._schedule());
    on(global.window_manager, "minimize", () => this._schedule());
    on(global.window_manager, "unminimize", () => this._schedule());
    on(global.window_manager, "destroy", () => this._schedule());
    this._layer.onWindowsChanged = () => this._schedule();
    this._schedule();
  }

  /** One pass per main-loop turn, however many signals arrive. */
  _schedule() {
    if (this._idle) return;
    this._idle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this._idle = 0;
      this._keepDown();
      this._updateCovered();
      return GLib.SOURCE_REMOVE;
    });
  }

  _isOther(win) {
    if (!win || this._layer.owns(win) || win.minimized || win.is_hidden()) return false;
    const t = win.get_window_type();
    return t === Meta.WindowType.NORMAL || t === Meta.WindowType.DIALOG || t === Meta.WindowType.MODAL_DIALOG || t === Meta.WindowType.UTILITY;
  }

  _keepDown() {
    if (this._raised || this._lowering) return;
    const ours = this._layer.windows;
    if (!ours.length) return;
    const stack = global.display.sort_windows_by_stacking(global.display.list_all_windows());
    this._checkDing(stack);
    // Every layer window must stay below every normal window, so check below our highest one.
    const highestOurs = Math.max(-1, ...ours.map((w) => stack.indexOf(w)));
    if (highestOurs <= 0) return;
    const otherBelow = stack.slice(0, highestOurs).some((w) => this._isOther(w));
    if (!otherBelow) return;
    this._lowering = true;
    try {
      for (const w of ours) w.lower();
    } finally {
      this._lowering = false;
    }
  }

  _checkDing(stack) {
    if (this._dingWarned) return;
    const ding = stack.find((w) => (w.get_wm_class() ?? "").toLowerCase().includes(DING_WM_CLASS));
    if (ding && ding.get_window_type() !== Meta.WindowType.DESKTOP) {
      this._dingWarned = true;
      console.warn("Opaline: DING's window is no longer a DESKTOP window; lowering the layer could hide the desktop icons' area (ADR 0006).");
    }
  }

  _desktopFocused() {
    const f = global.display.focus_window;
    if (!f) return true;
    if (this._layer.owns(f)) return true;
    return f.get_window_type() === Meta.WindowType.DESKTOP;
  }

  _updateCovered() {
    const ws = global.workspace_manager.get_active_workspace();
    const n = global.display.get_n_monitors();
    const covered = new Array(n).fill(false);
    for (const win of ws.list_windows()) {
      if (!this._isOther(win)) continue;
      const full = win.is_fullscreen() || win.is_maximized();
      if (full) {
        const m = win.get_monitor();
        if (m >= 0 && m < n) covered[m] = true;
      }
    }
    for (const win of this._layer.windows) {
      const connector = this._layer.connectorOf(win);
      const m = win.get_monitor();
      if (!connector || m < 0) continue;
      const now = covered[m] ?? false;
      if (this._covered.get(connector) !== now) {
        this._covered.set(connector, now);
        this._service.emitCovered(connector, now);
      }
    }
  }

  /** Peek and Edit: above everything, focused so Esc reaches it; then back down. */
  setRaised(raised) {
    this._raised = raised;
    for (const w of this._layer.windows) {
      if (raised) {
        w.make_above();
        w.raise();
      } else {
        w.unmake_above();
      }
    }
    if (raised) {
      const first = this._layer.windows[0];
      first?.activate(global.get_current_time());
    } else {
      this._lowering = true;
      try {
        for (const w of this._layer.windows) w.lower();
      } finally {
        this._lowering = false;
      }
      this._schedule();
    }
  }

  destroy() {
    this._layer.onWindowsChanged = null;
    if (this._idle) GLib.source_remove(this._idle);
    this._idle = 0;
    for (const [obj, id] of this._signals) obj.disconnect(id);
    this._signals = [];
    if (this._raised) for (const w of this._layer.windows) w.unmake_above();
  }
}

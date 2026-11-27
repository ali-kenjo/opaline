// Keeps the layer's windows at the bottom of the normal windows (ADR 0006): DING's icon window
// lives in Mutter's DESKTOP layer below us, so lower() never fights it. Peek and Edit raise the
// layer above everything until dismissed. Also tells core which monitors are covered by a
// maximized or fullscreen window, so it can sample less and not render there.
import GLib from "gi://GLib";
import Meta from "gi://Meta";

const DING_WM_CLASS = "ding";
/** A layer window that gets focus this soon after appearing took it by itself (ADR 0015). */
const MAP_GRACE_US = 1500 * 1000;

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
    // The last other window that had focus, to give it back to.
    this._lastOther = null;
    this._lastOtherGone = 0;
    this._mappedAt = 0;
    const on = (obj, sig, fn) => this._signals.push([obj, obj.connect(sig, fn)]);
    on(global.display, "restacked", () => this._schedule());
    on(global.display, "notify::focus-window", () => {
      this._schedule();
      this._service.setDesktopFocused(this._desktopFocused());
      this._trackFocus();
    });
    on(global.display, "in-fullscreen-changed", () => this._schedule());
    on(global.workspace_manager, "active-workspace-changed", () => this._schedule());
    on(global.window_manager, "size-changed", () => this._schedule());
    on(global.window_manager, "minimize", () => this._schedule());
    on(global.window_manager, "unminimize", () => this._schedule());
    on(global.window_manager, "destroy", () => this._schedule());
    this._layer.onWindowsChanged = () => {
      this._mappedAt = GLib.get_monotonic_time();
      this._schedule();
    };
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

  /** Remembers the last other window with focus; takes focus back from a layer window that got
   * it just by appearing (Wayland ignores GTK's focus-on-map hint). */
  _trackFocus() {
    const f = global.display.focus_window;
    if (!f) {
      this._service.setFocusedApp("");
      return;
    }
    if (!this._layer.owns(f)) {
      if (this._isOther(f)) {
        this._remember(f);
        const app = f.get_wm_class_instance?.() || f.get_wm_class?.() || "";
        this._service.setFocusedApp(app);
      } else {
        this._service.setFocusedApp("");
      }
      return;
    }
    if (!this._raised && GLib.get_monotonic_time() - this._mappedAt < MAP_GRACE_US) this.releaseFocus();
  }

  _remember(win) {
    if (this._lastOther === win) return;
    if (this._lastOther && this._lastOtherGone) this._lastOther.disconnect(this._lastOtherGone);
    this._lastOther = win;
    this._lastOtherGone = win.connect("unmanaged", () => {
      this._lastOther = null;
      this._lastOtherGone = 0;
    });
  }

  /** Gives keyboard focus back from the layer to the window that had it, or to no window. */
  releaseFocus() {
    const f = global.display.focus_window;
    if (this._raised || !f || !this._layer.owns(f)) return;
    const prev = this._lastOther;
    const time = global.get_current_time();
    if (prev && !prev.minimized && prev.located_on_workspace(global.workspace_manager.get_active_workspace())) {
      prev.activate(time);
    } else {
      global.display.unset_input_focus(time);
    }
  }

  _desktopFocused() {
    const f = global.display.focus_window;
    if (!f) return true;
    if (this._layer.owns(f)) return true;
    return f.get_window_type() === Meta.WindowType.DESKTOP;
  }

  _updateCovered() {
    if (!this._layer.windows.length) {
      this._covered.clear();
      return;
    }
    const ws = global.workspace_manager.get_active_workspace();
    const n = global.display.get_n_monitors();
    const covered = new Array(n).fill(false);
    let anyFullscreen = false;
    // While Peek or Edit raises the layer above all windows, nothing covers it.
    for (const win of ws.list_windows()) {
      if (!this._isOther(win)) continue;
      if (win.is_fullscreen()) anyFullscreen = true;
      if (!this._raised) {
        const full = win.is_fullscreen() || win.is_maximized();
        if (full) {
          const m = win.get_monitor();
          if (m >= 0 && m < n) covered[m] = true;
        }
      }
    }
    this._service.setFullscreen(anyFullscreen);
    for (const win of this._layer.windows) {
      const connector = this._layer.connectorOf(win);
      const m = this._layer.monitorIndexOf(win);
      const idx = m >= 0 ? m : win.get_monitor();
      if (!connector || idx < 0) continue;
      const now = covered[idx] ?? false;
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
      this._updateCovered();
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

  /** Per-monitor Peek (Shell1 API v2): raises or lowers only the matching monitor's window. */
  setRaisedMonitor(connector, raised) {
    const matches = this._layer.windows.filter((w) => this._layer.connectorOf(w) === connector);
    if (!matches.length) {
      this.setRaised(raised);
      return;
    }
    this._raised = raised;
    for (const w of matches) {
      if (raised) {
        w.make_above();
        w.raise();
      } else {
        w.unmake_above();
      }
    }
    if (raised) {
      this._updateCovered();
      matches[0]?.activate(global.get_current_time());
    } else {
      this._lowering = true;
      try {
        for (const w of matches) w.lower();
      } finally {
        this._lowering = false;
      }
      this._schedule();
    }
  }

  destroy() {
    this._layer.onWindowsChanged = null;
    if (this._lastOther && this._lastOtherGone) this._lastOther.disconnect(this._lastOtherGone);
    this._lastOther = null;
    if (this._idle) GLib.source_remove(this._idle);
    this._idle = 0;
    for (const [obj, id] of this._signals) obj.disconnect(id);
    this._signals = [];
    if (this._raised) for (const w of this._layer.windows) w.unmake_above();
  }
}

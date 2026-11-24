// Starts the layer (`opaline --layer --backend native`) as a trusted Wayland client while
// Opaline's core owns its bus name, restarts it with a backoff if it exits, stops it when core
// goes away, and places each of its windows on its monitor (the title names the connector).
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Meta from "gi://Meta";

import * as Main from "resource:///org/gnome/shell/ui/main.js";

const CORE_NAME = "io.github.ali_kenjo.Opaline";
const CORE_PATH = "/io/github/ali_kenjo/Opaline";
const CORE_IFACE = "io.github.ali_kenjo.Opaline1";
const TITLE_PREFIX = "opaline-layer:";
/** Environment core may pass to the layer; anything else is ignored. */
const ENV_ALLOWED = new Set(["__EGL_VENDOR_LIBRARY_FILENAMES", "OPALINE_LOG", "OPALINE_LAYER_PAGE", "RUST_BACKTRACE"]);
const MIN_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30000;
const HEALTHY_RUN_MS = 60000;

export class Layer {
  constructor(service) {
    this._service = service;
    this.onWindowsChanged = null;
    this._client = null;
    this._process = null;
    this._windows = new Map();
    this._signals = [];
    this._backoff = MIN_BACKOFF_MS;
    this._retry = 0;
    this._coreOwner = null;
    this._destroyed = false;

    this._watch = Gio.bus_watch_name(
      Gio.BusType.SESSION,
      CORE_NAME,
      Gio.BusNameWatcherFlags.NONE,
      (_conn, _name, owner) => {
        this._coreOwner = owner;
        this._start();
      },
      () => {
        this._coreOwner = null;
        this._stop();
      },
    );

    this._connect(global.display, "window-created", (_d, win) => this._adopt(win));
    this._signals.push([
      global.window_manager,
      global.window_manager.connect_after("map", (_wm, actor) => {
        const win = actor?.get_meta_window?.();
        if (!win || !this.owns(win)) return;
        this._place(win);
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
          if (!this._destroyed && this.owns(win)) this._place(win);
          return GLib.SOURCE_REMOVE;
        });
      }),
    ]);
    this._connect(Main.layoutManager, "monitors-changed", () => this.placeAll());
    this._connect(global.display, "workareas-changed", () => this.placeAll());
    this._placing = false;
    this._placeGuard = new WeakMap();
  }

  /** The layer's windows (Meta.Window), for stacking. */
  get windows() {
    return [...this._windows.keys()];
  }

  owns(win) {
    return this._windows.has(win);
  }

  _connect(obj, signal, fn) {
    this._signals.push([obj, obj.connect(signal, fn)]);
  }

  /** Reads the executable and environment core wants for the layer. */
  _coreLaunchInfo() {
    try {
      const proxy = Gio.DBusProxy.new_for_bus_sync(
        Gio.BusType.SESSION,
        Gio.DBusProxyFlags.DO_NOT_CONNECT_SIGNALS,
        null,
        CORE_NAME,
        CORE_PATH,
        CORE_IFACE,
        null,
      );
      const exe = proxy.get_cached_property("LayerExecutable")?.deepUnpack();
      const env = proxy.get_cached_property("LayerEnvironment")?.deepUnpack() ?? {};
      if (typeof exe !== "string" || !exe.startsWith("/") || !exe.endsWith("/opaline")) return null;
      return { exe, env };
    } catch (e) {
      console.warn(`Opaline: could not ask core how to start the layer: ${e.message}`);
      return null;
    }
  }

  _start() {
    if (this._destroyed || this._client || !this._coreOwner) return;
    const info = this._coreLaunchInfo();
    if (!info) {
      this._scheduleRetry();
      return;
    }
    const launcher = new Gio.SubprocessLauncher({ flags: Gio.SubprocessFlags.NONE });
    // A trusted Wayland client; never Xwayland.
    launcher.unsetenv("GDK_BACKEND");
    launcher.setenv("GDK_BACKEND", "wayland", true);
    for (const [k, v] of Object.entries(info.env)) {
      if (ENV_ALLOWED.has(k) && typeof v === "string") launcher.setenv(k, v, true);
    }
    const argv = [info.exe, "--layer", "--backend", "native"];
    try {
      this._client = Meta.WaylandClient.new_subprocess(global.context, launcher, argv);
    } catch (e) {
      console.error(`Opaline: could not start the layer: ${e.message}`);
      this._client = null;
      this._scheduleRetry();
      return;
    } finally {
      launcher.close?.();
    }
    const proc = this._client.get_subprocess();
    this._process = proc;
    const started = GLib.get_monotonic_time();
    console.log(`Opaline: layer started (pid ${proc?.get_identifier() ?? "?"})`);
    proc?.wait_async(null, (p, res) => {
      try {
        p.wait_finish(res);
      } catch {
        // Exit status is logged below; wait_finish just clears the GAsyncResult.
      }
      // Ignore exits of a process we already replaced or stopped.
      if (p !== this._process) return;
      const ranMs = (GLib.get_monotonic_time() - started) / 1000;
      this._client = null;
      this._process = null;
      this._windows.clear();
      this._service.layerWindowsChanged(0);
      if (this._destroyed || !this._coreOwner) return;
      if (ranMs >= HEALTHY_RUN_MS) this._backoff = MIN_BACKOFF_MS;
      console.warn(`Opaline: the layer exited after ${Math.round(ranMs)} ms; restarting`);
      this._scheduleRetry();
    });
    // Windows that already exist (unlikely, but cheap to check).
    for (const actor of global.get_window_actors()) this._adopt(actor.meta_window);
  }

  _scheduleRetry() {
    if (this._retry || this._destroyed) return;
    const wait = this._backoff;
    this._backoff = Math.min(this._backoff * 2, MAX_BACKOFF_MS);
    this._retry = GLib.timeout_add(GLib.PRIORITY_DEFAULT, wait, () => {
      this._retry = 0;
      this._start();
      return GLib.SOURCE_REMOVE;
    });
  }

  _stop() {
    if (this._retry) {
      GLib.source_remove(this._retry);
      this._retry = 0;
    }
    this._backoff = MIN_BACKOFF_MS;
    const process = this._process;
    this._client = null;
    this._process = null;
    for (const [win, ids] of this._windows) for (const id of ids) win.disconnect(id);
    this._windows.clear();
    process?.send_signal(15);
  }

  _adopt(win) {
    if (!win || !this._client || this._windows.has(win) || !this._client.owns_window(win)) return;
    const ids = [
      win.connect("notify::title", () => {
        this._place(win);
        this.onWindowsChanged?.();
      }),
      win.connect("shown", () => {
        this._place(win);
        this.onWindowsChanged?.();
      }),
      win.connect("position-changed", () => {
        if (!this._placing) this._placeGuarded(win);
      }),
      // Show Desktop and friends minimize everything; the layer belongs to the desktop.
      win.connect("notify::minimized", () => {
        if (win.minimized) win.unminimize();
      }),
      win.connect("unmanaged", () => {
        this._windows.delete(win);
        this._service.layerWindowsChanged(this._windows.size);
        this.onWindowsChanged?.();
      }),
    ];
    this._windows.set(win, ids);
    win.hide_from_window_list();
    win.stick();
    this._place(win);
    this._service.layerWindowsChanged(this._windows.size);
    this.onWindowsChanged?.();
  }

  _monitorIndex(win) {
    const title = win.get_title() ?? "";
    if (!title.startsWith(TITLE_PREFIX)) return -1;
    const connector = title.slice(TITLE_PREFIX.length);
    const manager = global.backend.get_monitor_manager();
    return manager.get_monitor_for_connector(connector);
  }

  _placeGuarded(win) {
    const now = GLib.get_monotonic_time();
    const state = this._placeGuard.get(win) ?? { since: now, count: 0 };
    if (now - state.since > 1_000_000) {
      state.since = now;
      state.count = 0;
    }
    if (state.count >= 6) return;
    state.count += 1;
    this._placeGuard.set(win, state);
    this._place(win);
  }

  _place(win) {
    if (this._placing) return;
    const index = this._monitorIndex(win);
    if (index < 0 || index >= global.display.get_n_monitors()) return;
    const ws = global.workspace_manager.get_active_workspace();
    const a = ws.get_work_area_for_monitor(index);
    const r = win.get_frame_rect();
    const onMonitor = win.get_monitor() === index;
    if (onMonitor && r.x === a.x && r.y === a.y && r.width === a.width && r.height === a.height) return;
    this._placing = true;
    try {
      if (!onMonitor) win.move_to_monitor(index);
      win.move_resize_frame(true, a.x, a.y, a.width, a.height);
      const after = win.get_frame_rect();
      console.log(
        `Opaline: placed ${win.get_title()} on monitor ${index} target=(${a.x},${a.y} ${a.width}x${a.height}) actual=(${after.x},${after.y} ${after.width}x${after.height})`,
      );
    } finally {
      this._placing = false;
    }
  }

  monitorIndexOf(win) {
    return this._monitorIndex(win);
  }

  placeAll() {
    for (const win of this._windows.keys()) this._place(win);
  }

  /** The connector a layer window shows (from its title), or null. */
  connectorOf(win) {
    const title = win.get_title() ?? "";
    return title.startsWith(TITLE_PREFIX) ? title.slice(TITLE_PREFIX.length) : null;
  }

  destroy() {
    this._destroyed = true;
    if (this._watch) Gio.bus_unwatch_name(this._watch);
    this._watch = 0;
    for (const [obj, id] of this._signals) obj.disconnect(id);
    this._signals = [];
    this._stop();
  }
}

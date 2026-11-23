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
    this._connect(Main.layoutManager, "monitors-changed", () => this.placeAll());
    this._connect(global.display, "workareas-changed", () => this.placeAll());
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
    }
    this._process = this._client.get_subprocess();
    const started = GLib.get_monotonic_time();
    console.log(`Opaline: layer started (pid ${this._process?.get_identifier() ?? "?"})`);
    this._process?.wait_async(null, () => {
      const ranMs = (GLib.get_monotonic_time() - started) / 1000;
      this._client = null;
      this._process = null;
      this._windows.clear();
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
      win.connect("notify::title", () => this._place(win)),
      // Show Desktop and friends minimize everything; the layer belongs to the desktop.
      win.connect("notify::minimized", () => {
        if (win.minimized) win.unminimize();
      }),
      win.connect("unmanaged", () => {
        this._windows.delete(win);
        this._service.layerWindowsChanged(this._windows.size);
      }),
    ];
    this._windows.set(win, ids);
    win.hide_from_window_list();
    win.stick();
    this._place(win);
    this._service.layerWindowsChanged(this._windows.size);
  }

  _monitorIndex(win) {
    const title = win.get_title() ?? "";
    if (!title.startsWith(TITLE_PREFIX)) return -1;
    const connector = title.slice(TITLE_PREFIX.length);
    const manager = global.backend.get_monitor_manager();
    return manager.get_monitor_for_connector(connector);
  }

  _place(win) {
    const index = this._monitorIndex(win);
    if (index < 0 || index >= global.display.get_n_monitors()) return;
    const g = global.display.get_monitor_geometry(index);
    const r = win.get_frame_rect();
    if (r.x === g.x && r.y === g.y && r.width === g.width && r.height === g.height) return;
    win.move_resize_frame(false, g.x, g.y, g.width, g.height);
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

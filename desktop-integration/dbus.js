// io.github.ali_kenjo.Opaline.Shell1 on the session bus: what Opaline's core needs from the
// shell. ApiVersion is bumped on incompatible changes; core supports N and N−1.
import Gio from "gi://Gio";
import GLib from "gi://GLib";

import * as Main from "resource:///org/gnome/shell/ui/main.js";

export const API_VERSION = 1;
const NAME = "io.github.ali_kenjo.Opaline.Shell1";
const PATH = "/io/github/ali_kenjo/Opaline/Shell1";

const XML = `
<node>
  <interface name="io.github.ali_kenjo.Opaline.Shell1">
    <property name="ApiVersion" type="u" access="read"/>
    <property name="DesktopFocused" type="b" access="read"/>
    <property name="OverviewVisible" type="b" access="read"/>
    <property name="LayerWindows" type="u" access="read"/>
    <method name="GetMonitors">
      <arg type="a(siiiidb)" direction="out" name="monitors"/>
    </method>
    <method name="GetWorkAreas">
      <arg type="a(siiii)" direction="out" name="areas"/>
    </method>
    <method name="SetRaised">
      <arg type="b" direction="in" name="raised"/>
    </method>
    <signal name="MonitorsChanged"/>
    <signal name="WorkAreasChanged"/>
    <signal name="DesktopFocusChanged"><arg type="b" name="focused"/></signal>
    <signal name="OverviewChanged"><arg type="b" name="visible"/></signal>
    <signal name="LayerCovered"><arg type="s" name="connector"/><arg type="b" name="covered"/></signal>
    <signal name="ShortcutActivated"><arg type="s" name="name"/></signal>
  </interface>
</node>`;

function connectorOf(index) {
  const manager = global.backend.get_monitor_manager();
  for (const logical of manager.get_logical_monitors?.() ?? []) {
    if (logical.get_number?.() === index) {
      return logical.get_monitors?.()[0]?.get_connector?.() ?? String(index);
    }
  }
  return String(index);
}

export class ShellService {
  constructor() {
    this.onSetRaised = null;
    this._desktopFocused = true;
    this._overview = false;
    this._layerWindows = 0;
    this._signals = [];
    this._impl = Gio.DBusExportedObject.wrapJSObject(XML, this);
    this._impl.export(Gio.DBus.session, PATH);
    this._owner = Gio.bus_own_name_on_connection(Gio.DBus.session, NAME, Gio.BusNameOwnerFlags.NONE, null, null);

    const on = (obj, sig, fn) => this._signals.push([obj, obj.connect(sig, fn)]);
    on(Main.layoutManager, "monitors-changed", () => this._impl.emit_signal("MonitorsChanged", null));
    on(global.display, "workareas-changed", () => this._impl.emit_signal("WorkAreasChanged", null));
    on(Main.overview, "showing", () => this._setOverview(true));
    on(Main.overview, "hidden", () => this._setOverview(false));
  }

  get ApiVersion() {
    return API_VERSION;
  }

  get DesktopFocused() {
    return this._desktopFocused;
  }

  get OverviewVisible() {
    return this._overview;
  }

  get LayerWindows() {
    return this._layerWindows;
  }

  GetMonitors() {
    const n = global.display.get_n_monitors();
    const primary = global.display.get_primary_monitor();
    const out = [];
    for (let i = 0; i < n; i++) {
      const g = global.display.get_monitor_geometry(i);
      out.push([connectorOf(i), g.x, g.y, g.width, g.height, global.display.get_monitor_scale(i), i === primary]);
    }
    return out;
  }

  GetWorkAreas() {
    const ws = global.workspace_manager.get_active_workspace();
    const out = [];
    for (let i = 0; i < global.display.get_n_monitors(); i++) {
      const a = ws.get_work_area_for_monitor(i);
      out.push([connectorOf(i), a.x, a.y, a.width, a.height]);
    }
    return out;
  }

  SetRaised(raised) {
    this.onSetRaised?.(raised);
  }

  setDesktopFocused(focused) {
    if (focused === this._desktopFocused) return;
    this._desktopFocused = focused;
    this._impl.emit_signal("DesktopFocusChanged", new GLib.Variant("(b)", [focused]));
    this._impl.emit_property_changed("DesktopFocused", new GLib.Variant("b", focused));
  }

  _setOverview(visible) {
    if (visible === this._overview) return;
    this._overview = visible;
    this._impl.emit_signal("OverviewChanged", new GLib.Variant("(b)", [visible]));
    this._impl.emit_property_changed("OverviewVisible", new GLib.Variant("b", visible));
  }

  emitCovered(connector, covered) {
    this._impl.emit_signal("LayerCovered", new GLib.Variant("(sb)", [connector, covered]));
  }

  emitShortcut(name) {
    this._impl.emit_signal("ShortcutActivated", new GLib.Variant("(s)", [name]));
  }

  layerWindowsChanged(count) {
    if (typeof count === "number" && count !== this._layerWindows) {
      this._layerWindows = count;
      this._impl.emit_property_changed("LayerWindows", new GLib.Variant("u", count));
    }
  }

  destroy() {
    for (const [obj, id] of this._signals) obj.disconnect(id);
    this._signals = [];
    if (this._owner) Gio.bus_unown_name(this._owner);
    this._owner = 0;
    this._impl?.unexport();
    this._impl = null;
  }
}

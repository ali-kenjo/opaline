// Opaline Desktop Integration (docs/ARCHITECTURE.md, brief §5.2). Window placement and shell
// signals only: it starts Opaline's layer as a trusted Wayland client while Opaline runs, keeps
// its windows on the desktop, and tells Opaline about focus, the overview and coverage. No
// rendering, no polling.
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

import { ShellService } from "./dbus.js";
import { Keys } from "./keys.js";
import { Layer } from "./layer.js";
import { Stacking } from "./stacking.js";

export default class OpalineDesktop extends Extension {
  enable() {
    this._service = new ShellService();
    this._layer = new Layer(this._service);
    this._stacking = new Stacking(this._layer, this._service);
    this._service.onSetRaised = (raised) => this._stacking.setRaised(raised);
    this._keys = new Keys(this.getSettings(), (name) => this._service.emitShortcut(name));
  }

  disable() {
    // Everything we connected or started goes away, so Opaline falls back to Instant mode.
    this._keys?.destroy();
    this._stacking?.destroy();
    this._layer?.destroy();
    this._service?.destroy();
    this._keys = null;
    this._stacking = null;
    this._layer = null;
    this._service = null;
  }
}

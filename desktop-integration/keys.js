// Peek and Edit shortcuts through the shell's keybinding API (configurable in GSettings).
import Meta from "gi://Meta";
import Shell from "gi://Shell";

import * as Main from "resource:///org/gnome/shell/ui/main.js";

const BINDINGS = [
  ["peek-shortcut", "peek"],
  ["edit-shortcut", "edit"],
];

export class Keys {
  constructor(settings, onActivated) {
    this._added = [];
    for (const [key, name] of BINDINGS) {
      const ok = Main.wm.addKeybinding(key, settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT, Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, () => onActivated(name));
      if (ok !== Meta.KeyBindingAction.NONE) this._added.push(key);
      else console.warn(`Opaline: the ${name} shortcut is taken or invalid`);
    }
  }

  destroy() {
    for (const key of this._added) Main.wm.removeKeybinding(key);
    this._added = [];
  }
}

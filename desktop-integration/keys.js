// Peek, Edit, and Phase 8 profile/look shortcuts through the shell's keybinding API.
import Meta from "gi://Meta";
import Shell from "gi://Shell";

import * as Main from "resource:///org/gnome/shell/ui/main.js";

const BINDINGS = [
  ["peek-shortcut", "peek"],
  ["edit-shortcut", "edit"],
  ["next-profile-shortcut", "next-profile"],
  ["cycle-look-shortcut", "cycle-look"],
  ["peek-primary-shortcut", "peek-primary"],
];

export class Keys {
  constructor(settings, onActivated) {
    this._added = [];
    const schema = settings.settings_schema;
    for (const [key, name] of BINDINGS) {
      if (schema && !schema.has_key(key)) continue;
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

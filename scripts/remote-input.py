"""Drives the pointer and keyboard through Mutter's remote-desktop API, for checks on the real
desktop (spike S3). Coordinates are the monitor's stream pixels: physical pixels, i.e. logical ×
the monitor's scale (on a 1.25 monitor, logical (100, 100) is (125, 125)), counted from the
monitor's top-left (the top bar included).

  scripts/remote-input.py CONNECTOR STEP...
    click X Y        move to (X, Y) and click the left button
    move X Y         move only
    key NAME         press and release a key (a-z, 0-9, Escape, Return, Tab)
    wait MS          pause

Moves the real pointer and types into whatever has focus: run it only where that is intended."""
import sys
import time

from gi.repository import Gio, GLib

BTN_LEFT = 0x110
KEYSYMS = {"Escape": 0xFF1B, "Return": 0xFF0D, "Tab": 0xFF09}

connector, steps = sys.argv[1], sys.argv[2:]
bus = Gio.bus_get_sync(Gio.BusType.SESSION)


def call(dest, path, iface, method, args=None, rtype="()"):
    return bus.call_sync(dest, path, iface, method, args, GLib.VariantType(rtype),
                         Gio.DBusCallFlags.NONE, -1, None).unpack()


RD = "org.gnome.Mutter.RemoteDesktop"
SC = "org.gnome.Mutter.ScreenCast"
(rd_session,) = call(RD, "/org/gnome/Mutter/RemoteDesktop", RD, "CreateSession", None, "(o)")
session_id = call(RD, rd_session, "org.freedesktop.DBus.Properties", "Get",
                  GLib.Variant("(ss)", (RD + ".Session", "SessionId")), "(v)")[0]
(sc_session,) = call(SC, "/org/gnome/Mutter/ScreenCast", SC, "CreateSession",
                     GLib.Variant("(a{sv})", ({"remote-desktop-session-id": GLib.Variant("s", session_id)},)),
                     "(o)")
(stream,) = call(SC, sc_session, SC + ".Session", "RecordMonitor",
                 GLib.Variant("(sa{sv})", (connector, {})), "(o)")

loop = GLib.MainLoop()
ready = {"done": False}


def on_added(*_args):
    ready["done"] = True
    loop.quit()


sub = bus.signal_subscribe(SC, SC + ".Stream", "PipeWireStreamAdded", stream, None,
                           Gio.DBusSignalFlags.NONE, on_added)
call(RD, rd_session, RD + ".Session", "Start")
GLib.timeout_add(5000, loop.quit)
loop.run()
bus.signal_unsubscribe(sub)
if not ready["done"]:
    print("stream did not start", file=sys.stderr)


def rd(method, args):
    call(RD, rd_session, RD + ".Session", method, args)


def keysym(name):
    if name in KEYSYMS:
        return KEYSYMS[name]
    if len(name) == 1 and name.isascii() and name.isalnum():
        return ord(name.lower())
    raise SystemExit(f"unknown key {name}")


try:
    i = 0
    while i < len(steps):
        s = steps[i]
        if s in ("click", "move"):
            x, y = float(steps[i + 1]), float(steps[i + 2])
            rd("NotifyPointerMotionAbsolute", GLib.Variant("(sdd)", (stream, x, y)))
            time.sleep(0.15)
            if s == "click":
                rd("NotifyPointerButton", GLib.Variant("(ib)", (BTN_LEFT, True)))
                time.sleep(0.06)
                rd("NotifyPointerButton", GLib.Variant("(ib)", (BTN_LEFT, False)))
            i += 3
        elif s == "key":
            k = keysym(steps[i + 1])
            rd("NotifyKeyboardKeysym", GLib.Variant("(ub)", (k, True)))
            time.sleep(0.04)
            rd("NotifyKeyboardKeysym", GLib.Variant("(ub)", (k, False)))
            time.sleep(0.08)
            i += 2
        elif s == "wait":
            time.sleep(int(steps[i + 1]) / 1000)
            i += 2
        else:
            raise SystemExit(f"unknown step {s}")
        time.sleep(0.2)
finally:
    rd("Stop", None)

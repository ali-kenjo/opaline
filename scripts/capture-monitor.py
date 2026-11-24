"""Grabs frames of one monitor through Mutter's ScreenCast API (silent, no dialog), for checking the
layer on the real desktop. Usage: scripts/capture-monitor.py CONNECTOR OUT  → OUT.0.png … OUT.7.png
(use the last frame). The layer sits below windows, so run `opaline --peek` first to see it."""
import sys
import gi

gi.require_version("Gst", "1.0")
from gi.repository import Gio, GLib, Gst

connector, out = sys.argv[1], sys.argv[2]
Gst.init(None)
bus = Gio.bus_get_sync(Gio.BusType.SESSION)
loop = GLib.MainLoop()


def call(path, iface, method, args, rtype):
    return bus.call_sync("org.gnome.Mutter.ScreenCast", path, iface, method, args,
                         GLib.VariantType(rtype), Gio.DBusCallFlags.NONE, -1, None).unpack()


(session,) = call("/org/gnome/Mutter/ScreenCast", "org.gnome.Mutter.ScreenCast", "CreateSession",
                  GLib.Variant("(a{sv})", ({},)), "(o)")
(stream,) = call(session, "org.gnome.Mutter.ScreenCast.Session", "RecordMonitor",
                 GLib.Variant("(sa{sv})", (connector, {"cursor-mode": GLib.Variant("u", 0)})), "(o)")


def on_added(_c, _s, _p, _i, _sig, params):
    node = params.unpack()[0]
    pipe = Gst.parse_launch(
        f"pipewiresrc path={node} num-buffers=8 ! videoconvert ! videorate ! pngenc snapshot=false ! multifilesink location={out}.%d.png")
    pipe.set_state(Gst.State.PLAYING)
    b = pipe.get_bus()
    b.add_signal_watch()

    def done(_b, msg):
        if msg.type in (Gst.MessageType.EOS, Gst.MessageType.ERROR):
            if msg.type == Gst.MessageType.ERROR:
                print("error", msg.parse_error())
            pipe.set_state(Gst.State.NULL)
            call(session, "org.gnome.Mutter.ScreenCast.Session", "Stop", None, "()")
            loop.quit()

    b.connect("message", done)


bus.signal_subscribe("org.gnome.Mutter.ScreenCast", "org.gnome.Mutter.ScreenCast.Stream",
                     "PipeWireStreamAdded", stream, None, Gio.DBusSignalFlags.NONE, on_added)
call(session, "org.gnome.Mutter.ScreenCast.Session", "Start", None, "()")
GLib.timeout_add_seconds(10, loop.quit)
loop.run()

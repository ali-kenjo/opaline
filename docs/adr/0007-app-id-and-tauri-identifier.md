# ADR 0007: Public app ID vs. Tauri's `identifier`

Status: accepted · 2026-11-22

## Context
The brief's app ID is `io.github.ali_kenjo.Opaline`. The underscore is required, because a GitHub user name with a
hyphen becomes an underscore in reverse-DNS IDs: hyphens are allowed in D-Bus names, but the Flathub/AppStream
convention for `ali-kenjo` is `ali_kenjo`. The Tauri CLI refuses that `identifier` ("must contain only alphanumeric
characters, hyphens and periods"), because it applies Apple bundle-ID rules on every platform.

Checked in the source (Tauri 2.12.7, tao 0.37.3): on Linux the `identifier` becomes the GTK application ID only when
`app.enableGTKAppId` is true (default false). Without it, `gtk::Application` is created with no ID, never registers
on D-Bus and isn't unique. Core and layer (same binary) therefore can't collide with each other, nor with the
`io.github.ali_kenjo.Opaline` bus name that core owns itself.

## Decision
- `tauri.conf.json` `identifier` = `io.github.ali-kenjo.opaline`. It is used only by the Tauri CLI and bundler, and
  never appears on the bus.
- `enableGTKAppId` stays off.
- The public ID `io.github.ali_kenjo.Opaline` is used everywhere users and the system see it: the session bus name,
  the shell helper interface names, the desktop file (`io.github.ali_kenjo.Opaline.desktop`, shipped from
  `packaging/` in P8 instead of Tauri's generated `Opaline.desktop`), AppStream metainfo, icons, the polkit action
  and the system bus name.
- For Wayland dock matching, the Settings/Onboarding windows (core) will set the GLib program name to the public ID
  before GTK starts (P6).

## Consequences
One ID mismatch is kept inside the build tooling. Phase 8 checks the `.deb` contents to make sure no generated file
leaks the Tauri identifier.

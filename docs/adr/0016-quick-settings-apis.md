# ADR 0016: GNOME 50 Quick Settings controls from Opaline (spike S4)

Status: accepted · 2026-11-26 (Opaline 2.0, Phase 2)

## Context
The 2.0 brief plans control widgets (brightness, volume, Bluetooth, Wi-Fi, VPN, Do Not Disturb, Night Light, dark
style, keep awake; §8). Spike S4 had to find, for each, an interface that a normal session client (Opaline's core,
not the shell) may read **and** change on GNOME 50, and compare it with what GNOME Shell's own Quick Settings use, so
Opaline and the shell never disagree.

## How it was measured
`cargo run -p opaline-core --example quick_settings_probe` reads each control, writes back exactly the value it read,
and reads again: it proves the write is allowed without changing anything. It prints levels and states only.
GNOME Shell's sources (`/org/gnome/shell/ui/status/*.js`, `misc/brightnessManager.js` in `libshell-18.so`) were
read for comparison. Polkit defaults were checked with `pkaction` before any system-bus write, so no password
dialog could appear. Machine: Ubuntu 26.04.1, GNOME 50.1, both monitors.

## Results

| Control | Interface (read, change, follow) | Same-value write from core | What GNOME Shell uses |
| - | - | - | - |
| Brightness, per monitor | Mutter `org.gnome.Mutter.DisplayConfig`: `Backlight` property `(serial, [{connector, active, min, max, value}])`, `SetBacklight(serial, connector, value)`; follow `PropertiesChanged` | ✅ both: `eDP-1` (1200–120000) and `HDMI-2` over DDC (10–210) | the same Mutter backlight objects (`brightnessManager`, `backlights-changed`), so changes show in both |
| Keyboard backlight | gsd `org.gnome.SettingsDaemon.Power.Keyboard`: `Brightness` (%), `Steps`, `BrightnessChanged` | — this laptop has none (property read fails) | same interface (`status/backlight.js`) |
| Airplane mode | gsd `org.gnome.SettingsDaemon.Rfkill`: `AirplaneMode`, `HardwareAirplaneMode`, `ShouldShowAirplaneMode` | ✅ | same (`status/rfkill.js`) |
| Bluetooth on/off | Rfkill `BluetoothAirplaneMode` (on = false); when turning on, BlueZ `org.bluez.Adapter1.Powered = true` if needed | ✅ both (BlueZ policy allows the default context) | exactly this pair (`status/bluetooth.js` `toggleActive`) |
| Bluetooth devices | BlueZ object manager, `Device1.Connect`/`Disconnect` | not exercised (would connect a device) | GnomeBluetooth client over BlueZ |
| Wi-Fi on/off | NetworkManager `WirelessEnabled` (system bus; polkit `enable-disable-wifi`: allowed for the active session) | ✅ | libnm, same property |
| VPN | NetworkManager: connection profiles of type `vpn`/`wireguard`; `ActivateConnection(profile, "/", "/")`, `DeactivateConnection` (polkit `network-control`: allowed for the active session) | not testable: no VPN profile on this machine (only Wi-Fi, Ethernet, Bluetooth) | libnm |
| Volume and mute (output, microphone) | write: `wpctl set-volume`/`set-mute` on `@DEFAULT_AUDIO_SINK@`/`@DEFAULT_AUDIO_SOURCE@`; read and follow: PipeWire (core already links `pipewire`) | ✅ both | Gvc (PulseAudio protocol through pipewire-pulse); there's no `pactl` here |
| Do Not Disturb | GSettings `org.gnome.desktop.notifications show-banners` (inverted) | ✅ | same key (`status/doNotDisturb.js`) |
| Night Light | GSettings `org.gnome.settings-daemon.plugins.color night-light-enabled`; supported: Mutter `DisplayConfig.NightLightSupported` | ✅ | same key and flag (`status/nightLight.js`) |
| Dark style | GSettings `org.gnome.desktop.interface color-scheme` (`default` / `prefer-dark`) | ✅ | same key (`status/darkMode.js`) |
| Keep awake | `org.gnome.SessionManager.Inhibit(app, 0, reason, 8)` → cookie, `Uninhibit(cookie)`; the session drops it if core's bus connection goes away | ✅ (inhibited, then released) | (not a Shell toggle; extensions use the same call) |
| Screen locked (read) | `org.gnome.ScreenSaver.GetActive` | ✅ | — |

Following GSettings changes from core: core runs on tokio, not a GLib main loop, so instead of `gio::Settings`
signals it subscribes to dconf's change signal (`ca.desrt.dconf.Writer` `Notify` on `/ca/desrt/dconf/Writer/user`)
and re-reads the affected keys.

## Decision
1. Control widgets (P7) use exactly the interfaces in the table, the ones GNOME Shell uses where it uses D-Bus or
   GSettings, so the shell's Quick Settings and Opaline always show the same state.
2. **Volume** is the one place we differ from the shell: writes through `wpctl` (WirePlumber, part of Ubuntu's
   default audio stack), reads and live updates through core's existing PipeWire connection. No PulseAudio library
   dependency. A slider sends at most every 150 ms (as the composition slider already does).
3. **Bluetooth on/off** copies the shell's logic (rfkill first, then power the adapter), so it also works when
   rfkill blocked it.
4. A control is **shown only when its interface answers**: no keyboard-backlight slider on this laptop, no VPN
   toggle without a VPN profile, no Night Light without `NightLightSupported`, no airplane toggle unless
   `ShouldShowAirplaneMode`.
5. Every change goes through core as a validated command (one per control, like `set-power-profile` today), so the
   composition command allowlist (docs/COMPOSITION.md) grows by these names in P7, not by generic setters.

## Consequences
- P7 builds providers and commands for these controls on top of the probe's calls; VPN gets tested when a profile
  exists (or with a dummy WireGuard profile the user creates).
- `quick_settings_probe` stays as a quick re-check after GNOME updates; it changes nothing on the system.

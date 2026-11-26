//! Spike S4 (PLAN-2 §4, ADR 0016): which GNOME 50 Quick Settings controls a normal session
//! client like Opaline's core can read and change. Every write sets the value just read, so
//! running it changes nothing; it proves the call is allowed and works from outside the shell.
//! Prints levels and states only (no device or network names).
//!
//!   cargo run -p opaline-core --example quick_settings_probe
#![allow(clippy::print_stdout)]

use std::collections::HashMap;
use std::process::Command;

use zbus::{Connection, OwnedVariant, proxy};

#[proxy(
    interface = "org.gnome.Mutter.DisplayConfig",
    default_service = "org.gnome.Mutter.DisplayConfig",
    default_path = "/org/gnome/Mutter/DisplayConfig"
)]
trait DisplayConfig {
    #[zbus(property)]
    fn backlight(&self) -> zbus::Result<(u32, Vec<HashMap<String, OwnedVariant>>)>;
    fn set_backlight(&self, serial: u32, connector: &str, value: i32) -> zbus::Result<()>;
}

#[proxy(
    interface = "org.gnome.SettingsDaemon.Power.Keyboard",
    default_service = "org.gnome.SettingsDaemon.Power",
    default_path = "/org/gnome/SettingsDaemon/Power"
)]
trait Keyboard {
    #[zbus(property)]
    fn brightness(&self) -> zbus::Result<i32>;
    #[zbus(property)]
    fn set_brightness(&self, value: i32) -> zbus::Result<()>;
}

#[proxy(
    interface = "org.gnome.SettingsDaemon.Rfkill",
    default_service = "org.gnome.SettingsDaemon.Rfkill",
    default_path = "/org/gnome/SettingsDaemon/Rfkill"
)]
trait Rfkill {
    #[zbus(property)]
    fn airplane_mode(&self) -> zbus::Result<bool>;
    #[zbus(property)]
    fn set_airplane_mode(&self, value: bool) -> zbus::Result<()>;
    #[zbus(property)]
    fn bluetooth_airplane_mode(&self) -> zbus::Result<bool>;
    #[zbus(property)]
    fn set_bluetooth_airplane_mode(&self, value: bool) -> zbus::Result<()>;
}

#[proxy(
    interface = "org.bluez.Adapter1",
    default_service = "org.bluez",
    default_path = "/org/bluez/hci0"
)]
trait Adapter {
    #[zbus(property)]
    fn powered(&self) -> zbus::Result<bool>;
    #[zbus(property)]
    fn set_powered(&self, value: bool) -> zbus::Result<()>;
}

#[proxy(
    interface = "org.freedesktop.NetworkManager",
    default_service = "org.freedesktop.NetworkManager",
    default_path = "/org/freedesktop/NetworkManager"
)]
trait NetworkManager {
    #[zbus(property)]
    fn wireless_enabled(&self) -> zbus::Result<bool>;
    #[zbus(property)]
    fn set_wireless_enabled(&self, value: bool) -> zbus::Result<()>;
}

#[proxy(
    interface = "org.freedesktop.NetworkManager.Settings",
    default_service = "org.freedesktop.NetworkManager",
    default_path = "/org/freedesktop/NetworkManager/Settings"
)]
trait NmSettings {
    fn list_connections(&self) -> zbus::Result<Vec<zbus::OwnedObjectPath>>;
}

#[proxy(
    interface = "org.freedesktop.NetworkManager.Settings.Connection",
    default_service = "org.freedesktop.NetworkManager"
)]
trait NmConnection {
    fn get_settings(&self) -> zbus::Result<HashMap<String, HashMap<String, OwnedVariant>>>;
}

#[proxy(
    interface = "org.gnome.SessionManager",
    default_service = "org.gnome.SessionManager",
    default_path = "/org/gnome/SessionManager"
)]
trait SessionManager {
    fn inhibit(
        &self,
        app_id: &str,
        toplevel_xid: u32,
        reason: &str,
        flags: u32,
    ) -> zbus::Result<u32>;
    fn uninhibit(&self, cookie: u32) -> zbus::Result<()>;
    fn is_inhibited(&self, flags: u32) -> zbus::Result<bool>;
}

#[proxy(
    interface = "org.gnome.ScreenSaver",
    default_service = "org.gnome.ScreenSaver",
    default_path = "/org/gnome/ScreenSaver"
)]
trait ScreenSaver {
    fn get_active(&self) -> zbus::Result<bool>;
}

fn report(name: &str, read: impl std::fmt::Debug, write: Result<(), String>, same: bool) {
    let w = match write {
        Ok(()) => "ok".to_owned(),
        Err(e) => format!("refused ({e})"),
    };
    let after = if same { "unchanged" } else { "CHANGED" };
    println!("{name:<28} read={read:?}  same-value write={w}  after={after}");
}

fn err(e: zbus::Error) -> String {
    e.to_string().chars().take(120).collect()
}

/// `gsettings get`, then `gsettings set` with the same value.
fn gsettings(name: &str, schema: &str, key: &str) {
    let get = || {
        Command::new("gsettings")
            .args(["get", schema, key])
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_owned())
    };
    let Some(before) = get() else {
        println!("{name:<28} gsettings unavailable");
        return;
    };
    let set = Command::new("gsettings")
        .args(["set", schema, key, &before])
        .status()
        .map_err(|e| e.to_string())
        .and_then(|s| s.success().then_some(()).ok_or_else(|| s.to_string()));
    report(
        name,
        &before,
        set,
        get().as_deref() == Some(before.as_str()),
    );
}

/// `wpctl get-volume`, then `wpctl set-volume` with the same level.
fn volume(name: &str, target: &str) {
    let get = || {
        Command::new("wpctl")
            .args(["get-volume", target])
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_owned())
    };
    let Some(before) = get() else {
        println!("{name:<28} wpctl unavailable");
        return;
    };
    let level = before.split_whitespace().nth(1).unwrap_or("").to_owned();
    let set = Command::new("wpctl")
        .args(["set-volume", target, &level])
        .status()
        .map_err(|e| e.to_string())
        .and_then(|s| s.success().then_some(()).ok_or_else(|| s.to_string()));
    report(
        name,
        &before,
        set,
        get().as_deref() == Some(before.as_str()),
    );
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> zbus::Result<()> {
    let session = Connection::session().await?;
    let system = Connection::system().await?;

    // Brightness: Mutter's backlight API (built-in panel and DDC monitors).
    let display = DisplayConfigProxy::new(&session).await?;
    match display.backlight().await {
        Ok((serial, monitors)) => {
            for m in monitors {
                let connector = m
                    .get("connector")
                    .and_then(|v| String::try_from(v.clone()).ok())
                    .unwrap_or_default();
                let value = m
                    .get("value")
                    .and_then(|v| i32::try_from(v.clone()).ok())
                    .unwrap_or(-1);
                let range = (
                    m.get("min").and_then(|v| i32::try_from(v.clone()).ok()),
                    m.get("max").and_then(|v| i32::try_from(v.clone()).ok()),
                );
                let write = display
                    .set_backlight(serial, &connector, value)
                    .await
                    .map_err(err);
                let after = display.backlight().await.ok().and_then(|(_, ms)| {
                    ms.into_iter()
                        .find(|x| {
                            x.get("connector")
                                .and_then(|v| String::try_from(v.clone()).ok())
                                .as_deref()
                                == Some(connector.as_str())
                        })
                        .and_then(|x| x.get("value").and_then(|v| i32::try_from(v.clone()).ok()))
                });
                report(
                    &format!("brightness {connector}"),
                    (value, range),
                    write,
                    after == Some(value),
                );
            }
        }
        Err(e) => println!("brightness                   unreadable ({})", err(e)),
    }

    let kbd = KeyboardProxy::new(&session).await?;
    match kbd.brightness().await {
        Ok(v) if v >= 0 => {
            let w = kbd.set_brightness(v).await.map_err(err);
            report(
                "keyboard backlight",
                v,
                w,
                kbd.brightness().await.ok() == Some(v),
            );
        }
        Ok(v) => println!("keyboard backlight           none ({v})"),
        Err(e) => println!("keyboard backlight           unreadable ({})", err(e)),
    }

    let rfkill = RfkillProxy::new(&session).await?;
    if let Ok(v) = rfkill.airplane_mode().await {
        let w = rfkill.set_airplane_mode(v).await.map_err(err);
        report(
            "airplane mode",
            v,
            w,
            rfkill.airplane_mode().await.ok() == Some(v),
        );
    }
    if let Ok(v) = rfkill.bluetooth_airplane_mode().await {
        let w = rfkill.set_bluetooth_airplane_mode(v).await.map_err(err);
        report(
            "bluetooth off (rfkill)",
            v,
            w,
            rfkill.bluetooth_airplane_mode().await.ok() == Some(v),
        );
    }

    match AdapterProxy::new(&system).await {
        Ok(adapter) => match adapter.powered().await {
            Ok(v) => {
                let w = adapter.set_powered(v).await.map_err(err);
                report(
                    "bluetooth adapter (BlueZ)",
                    v,
                    w,
                    adapter.powered().await.ok() == Some(v),
                );
            }
            Err(e) => println!("bluetooth adapter            unreadable ({})", err(e)),
        },
        Err(e) => println!("bluetooth adapter            none ({})", err(e)),
    }

    let nm = NetworkManagerProxy::new(&system).await?;
    if let Ok(v) = nm.wireless_enabled().await {
        let w = nm.set_wireless_enabled(v).await.map_err(err);
        report(
            "wi-fi (NetworkManager)",
            v,
            w,
            nm.wireless_enabled().await.ok() == Some(v),
        );
    }
    // VPN: count the connection profiles NetworkManager could activate (no names printed).
    let settings = NmSettingsProxy::new(&system).await?;
    let mut types: HashMap<String, usize> = HashMap::new();
    for path in settings.list_connections().await.unwrap_or_default() {
        let Ok(c) = NmConnectionProxy::builder(&system).path(path).build().await else {
            continue;
        };
        let t = c
            .get_settings()
            .await
            .ok()
            .and_then(|s| s.get("connection")?.get("type").cloned())
            .and_then(|v| String::try_from(v).ok())
            .unwrap_or_default();
        *types.entry(t).or_default() += 1;
    }
    let vpn = types.get("vpn").copied().unwrap_or(0) + types.get("wireguard").copied().unwrap_or(0);
    println!(
        "{:<28} profiles by type {types:?}  vpn+wireguard={vpn}",
        "vpn (NetworkManager)"
    );

    volume("volume (output)", "@DEFAULT_AUDIO_SINK@");
    volume("volume (microphone)", "@DEFAULT_AUDIO_SOURCE@");

    gsettings(
        "do not disturb (banners)",
        "org.gnome.desktop.notifications",
        "show-banners",
    );
    gsettings(
        "night light",
        "org.gnome.settings-daemon.plugins.color",
        "night-light-enabled",
    );
    gsettings("dark style", "org.gnome.desktop.interface", "color-scheme");

    // Keep awake (Caffeine): an idle inhibitor, released at once.
    let sm = SessionManagerProxy::new(&session).await?;
    const IDLE: u32 = 8;
    match sm
        .inhibit("io.github.ali_kenjo.Opaline", 0, "spike S4", IDLE)
        .await
    {
        Ok(cookie) => {
            let held = sm.is_inhibited(IDLE).await.unwrap_or(false);
            let w = sm.uninhibit(cookie).await.map_err(err);
            println!(
                "{:<28} inhibit ok (inhibited={held}), uninhibit={}",
                "keep awake (session idle)",
                if w.is_ok() { "ok" } else { "refused" }
            );
        }
        Err(e) => println!("keep awake                   refused ({})", err(e)),
    }

    let saver = ScreenSaverProxy::new(&session).await?;
    println!(
        "{:<28} {:?}",
        "screen locked (read)",
        saver.get_active().await.map_err(err)
    );
    Ok(())
}

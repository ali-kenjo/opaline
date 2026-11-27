//! GNOME 50 Quick Settings controls provider & validated commands (brief §8.2, ADR 0016,
//! PLAN-2 task 7.1).
//!
//! Uses the exact interfaces verified in Spike S4 (`quick_settings_probe.rs`):
//! - Wi-Fi: `org.freedesktop.NetworkManager.WirelessEnabled`
//! - Bluetooth: `org.gnome.SettingsDaemon.Rfkill.BluetoothAirplaneMode` + `org.bluez.Adapter1.Powered`
//! - Airplane mode: `org.gnome.SettingsDaemon.Rfkill.AirplaneMode`
//! - DND / Night Light / Dark style: `gsettings`
//! - Keep awake: `org.gnome.SessionManager.Inhibit` / `Uninhibit`
//! - Volume & mute: `wpctl` (`@DEFAULT_AUDIO_SINK@` / `@DEFAULT_AUDIO_SOURCE@`)
//! - Display brightness: `org.gnome.Mutter.DisplayConfig` (`Backlight` / `SetBacklight`)
//! - Keyboard backlight: `org.gnome.SettingsDaemon.Power.Keyboard` (`Brightness`)

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock, PoisonError};
use std::time::Duration;

use opaline_ipc::{Topic, TopicUpdate, Value};
use tokio::process::Command;
use zbus::{Connection, OwnedVariant, proxy};

use crate::hub::Hub;

pub const STATE: &str = "controls.state";

static INHIBIT_COOKIE: OnceLock<Mutex<Option<u32>>> = OnceLock::new();

fn inhibit_cookie() -> &'static Mutex<Option<u32>> {
    INHIBIT_COOKIE.get_or_init(|| Mutex::new(None))
}

#[proxy(
    interface = "org.gnome.Mutter.DisplayConfig",
    default_service = "org.gnome.Mutter.DisplayConfig",
    default_path = "/org/gnome/Mutter/DisplayConfig"
)]
trait DisplayConfig {
    #[zbus(property)]
    fn backlight(&self) -> zbus::Result<(u32, Vec<HashMap<String, OwnedVariant>>)>;
    #[zbus(property)]
    fn night_light_supported(&self) -> zbus::Result<bool>;
    fn set_backlight(&self, serial: u32, connector: &str, value: i32) -> zbus::Result<()>;
}

#[proxy(
    interface = "org.gnome.SettingsDaemon.Power.Keyboard",
    default_service = "org.gnome.SettingsDaemon.Power",
    default_path = "/org/gnome/SettingsDaemon/Power"
)]
trait KeyboardBacklight {
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
    #[zbus(property)]
    fn should_show_airplane_mode(&self) -> zbus::Result<bool>;
}

#[proxy(
    interface = "org.bluez.Adapter1",
    default_service = "org.bluez",
    default_path = "/org/bluez/hci0"
)]
trait BluezAdapter {
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
}

/// Parses `wpctl get-volume` output such as `Volume: 0.65` or `Volume: 0.40 [MUTED]`.
pub fn parse_wpctl_volume(raw: &str) -> Option<(f64, bool)> {
    let line = raw.lines().next()?.trim();
    let rest = line.strip_prefix("Volume:")?.trim();
    let mut parts = rest.split_whitespace();
    let val: f64 = parts.next()?.parse().ok()?;
    let muted = rest.contains("[MUTED]");
    Some(((val * 100.0).clamp(0.0, 150.0).round(), muted))
}

async fn read_wpctl(target: &str) -> Option<(f64, bool)> {
    let out = Command::new("wpctl")
        .args(["get-volume", target])
        .output()
        .await
        .ok()?;
    if !out.status.success() {
        return None;
    }
    parse_wpctl_volume(&String::from_utf8_lossy(&out.stdout))
}

async fn gsettings_get(schema: &str, key: &str) -> Option<String> {
    let out = Command::new("gsettings")
        .args(["get", schema, key])
        .output()
        .await
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_owned())
}

async fn gsettings_set(schema: &str, key: &str, value: &str) -> Result<(), String> {
    let status = Command::new("gsettings")
        .args(["set", schema, key, value])
        .status()
        .await
        .map_err(|e| format!("gsettings-failed: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("gsettings exited with {status}"))
    }
}

fn variant_i32(v: &OwnedVariant) -> Option<i32> {
    match &**v {
        zbus::Variant::I32(n) => Some(*n),
        zbus::Variant::U32(n) => i32::try_from(*n).ok(),
        _ => None,
    }
}

fn variant_str(v: &OwnedVariant) -> Option<String> {
    match &**v {
        zbus::Variant::Str(s) => Some(s.as_str().to_owned()),
        _ => None,
    }
}

/// Samples every available GNOME 50 Quick Settings control into one `Value::Map`.
pub async fn sample_state() -> Value {
    let session = Connection::session().await.ok();
    let system = Connection::system().await.ok();

    let wifi = match &system {
        Some(conn) => match NetworkManagerProxy::new(conn).await {
            Ok(p) => p.wireless_enabled().await.ok(),
            Err(_) => None,
        },
        None => None,
    };

    let (airplane, show_airplane, bt_rfkill) = match &session {
        Some(conn) => match RfkillProxy::new(conn).await {
            Ok(p) => (
                p.airplane_mode().await.ok(),
                p.should_show_airplane_mode().await.ok().unwrap_or(false),
                p.bluetooth_airplane_mode().await.ok(),
            ),
            Err(_) => (None, false, None),
        },
        None => (None, false, None),
    };

    let bt_powered = match &system {
        Some(conn) => match BluezAdapterProxy::new(conn).await {
            Ok(p) => p.powered().await.ok(),
            Err(_) => None,
        },
        None => None,
    };
    let bluetooth = match (bt_rfkill, bt_powered) {
        (Some(blocked), Some(powered)) => Some(!blocked && powered),
        (Some(blocked), None) => Some(!blocked),
        (None, Some(powered)) => Some(powered),
        (None, None) => None,
    };

    let dnd = gsettings_get("org.gnome.desktop.notifications", "show-banners")
        .await
        .map(|s| s == "false");
    let night_light_supported = match &session {
        Some(conn) => match DisplayConfigProxy::new(conn).await {
            Ok(p) => p.night_light_supported().await.ok().unwrap_or(true),
            Err(_) => true,
        },
        None => true,
    };
    let night_light = if night_light_supported {
        gsettings_get(
            "org.gnome.settings-daemon.plugins.color",
            "night-light-enabled",
        )
        .await
        .map(|s| s == "true")
    } else {
        None
    };
    let dark_style = gsettings_get("org.gnome.desktop.interface", "color-scheme")
        .await
        .map(|s| s.contains("prefer-dark"));
    let keep_awake = inhibit_cookie()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .is_some();

    let (out_vol, out_mute) = read_wpctl("@DEFAULT_AUDIO_SINK@")
        .await
        .map_or((None, None), |(v, m)| (Some(v), Some(m)));
    let (in_vol, in_mute) = read_wpctl("@DEFAULT_AUDIO_SOURCE@")
        .await
        .map_or((None, None), |(v, m)| (Some(v), Some(m)));

    let mut backlights = Vec::new();
    if let Some(conn) = &session
        && let Ok(dc) = DisplayConfigProxy::new(conn).await
        && let Ok((_serial, items)) = dc.backlight().await
    {
        for item in items {
            let connector = item
                .get("connector")
                .and_then(variant_str)
                .unwrap_or_default();
            let min = item.get("min").and_then(variant_i32).unwrap_or(0);
            let max = item.get("max").and_then(variant_i32).unwrap_or(100);
            let value = item.get("value").and_then(variant_i32).unwrap_or(min);
            if !connector.is_empty() && max > min {
                let pct = (f64::from(value - min) / f64::from(max - min) * 100.0)
                    .clamp(0.0, 100.0)
                    .round();
                backlights.push(Value::map([
                    ("connector", Value::Text(connector)),
                    ("percent", Value::Num(pct)),
                ]));
            }
        }
    }

    let kbd_brightness = match &session {
        Some(conn) => match KeyboardBacklightProxy::new(conn).await {
            Ok(p) => p.brightness().await.ok().map(f64::from),
            Err(_) => None,
        },
        None => None,
    };

    Value::map([
        ("wifi", Value::from(wifi)),
        ("bluetooth", Value::from(bluetooth)),
        (
            "airplane",
            Value::from(if show_airplane { airplane } else { None }),
        ),
        ("dnd", Value::from(dnd)),
        ("nightLight", Value::from(night_light)),
        ("darkStyle", Value::from(dark_style)),
        ("keepAwake", Value::Bool(keep_awake)),
        ("outputVolume", Value::from(out_vol)),
        ("outputMuted", Value::from(out_mute)),
        ("inputVolume", Value::from(in_vol)),
        ("inputMuted", Value::from(in_mute)),
        ("backlights", Value::List(backlights)),
        ("kbdBrightness", Value::from(kbd_brightness)),
    ])
}

/// Validates and applies a Quick Controls toggle, then refreshes `controls.state`.
pub async fn set_toggle(hub: &Arc<Hub>, control: &str, enabled: bool) -> Result<(), String> {
    match control {
        "wifi" => {
            let conn = Connection::system()
                .await
                .map_err(|e| format!("no-system-bus: {e}"))?;
            let nm = NetworkManagerProxy::new(&conn)
                .await
                .map_err(|e| format!("nm-unavailable: {e}"))?;
            nm.set_wireless_enabled(enabled)
                .await
                .map_err(|e| format!("wifi-toggle-failed: {e}"))?;
        }
        "bluetooth" => {
            let session = Connection::session()
                .await
                .map_err(|e| format!("no-session-bus: {e}"))?;
            if let Ok(rfkill) = RfkillProxy::new(&session).await {
                let _ = rfkill.set_bluetooth_airplane_mode(!enabled).await;
            }
            if let Ok(system) = Connection::system().await
                && let Ok(adapter) = BluezAdapterProxy::new(&system).await
            {
                let _ = adapter.set_powered(enabled).await;
            }
        }
        "airplane" => {
            let session = Connection::session()
                .await
                .map_err(|e| format!("no-session-bus: {e}"))?;
            let rfkill = RfkillProxy::new(&session)
                .await
                .map_err(|e| format!("rfkill-unavailable: {e}"))?;
            rfkill
                .set_airplane_mode(enabled)
                .await
                .map_err(|e| format!("airplane-toggle-failed: {e}"))?;
        }
        "dnd" => {
            gsettings_set(
                "org.gnome.desktop.notifications",
                "show-banners",
                if enabled { "false" } else { "true" },
            )
            .await?;
        }
        "night-light" => {
            gsettings_set(
                "org.gnome.settings-daemon.plugins.color",
                "night-light-enabled",
                if enabled { "true" } else { "false" },
            )
            .await?;
        }
        "dark-style" => {
            gsettings_set(
                "org.gnome.desktop.interface",
                "color-scheme",
                if enabled {
                    "'prefer-dark'"
                } else {
                    "'default'"
                },
            )
            .await?;
        }
        "keep-awake" => {
            let session = Connection::session()
                .await
                .map_err(|e| format!("no-session-bus: {e}"))?;
            let sm = SessionManagerProxy::new(&session)
                .await
                .map_err(|e| format!("session-manager-unavailable: {e}"))?;
            if enabled {
                let cookie = sm
                    .inhibit("io.github.ali_kenjo.Opaline", 0, "Opaline Keep Awake", 8)
                    .await
                    .map_err(|e| format!("inhibit-failed: {e}"))?;
                *inhibit_cookie()
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner) = Some(cookie);
            } else {
                let cookie = inhibit_cookie()
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .take();
                if let Some(cookie) = cookie {
                    let _ = sm.uninhibit(cookie).await;
                }
            }
        }
        "output-mute" | "input-mute" => {
            let target = if control == "output-mute" {
                "@DEFAULT_AUDIO_SINK@"
            } else {
                "@DEFAULT_AUDIO_SOURCE@"
            };
            let status = Command::new("wpctl")
                .args(["set-mute", target, if enabled { "1" } else { "0" }])
                .status()
                .await
                .map_err(|e| format!("wpctl-failed: {e}"))?;
            if !status.success() {
                return Err(format!("wpctl exited with {status}"));
            }
        }
        other => return Err(format!("unknown-control: {other}")),
    }

    let state = sample_state().await;
    hub.publish(vec![TopicUpdate {
        topic: Topic::new(STATE),
        value: state,
    }]);
    Ok(())
}

/// Validates and applies a Quick Controls slider (volume, display brightness, keyboard backlight).
pub async fn set_slider(
    hub: &Arc<Hub>,
    control: &str,
    percent: f64,
    target: Option<&str>,
) -> Result<(), String> {
    if !percent.is_finite() {
        return Err("invalid-slider-value".into());
    }
    match control {
        "output-volume" | "input-volume" => {
            let max_pct = if control == "output-volume" {
                150.0
            } else {
                100.0
            };
            let frac = (percent.clamp(0.0, max_pct) / 100.0).clamp(0.0, 1.5);
            let node = if control == "output-volume" {
                "@DEFAULT_AUDIO_SINK@"
            } else {
                "@DEFAULT_AUDIO_SOURCE@"
            };
            let status = Command::new("wpctl")
                .args(["set-volume", node, &format!("{frac:.2}")])
                .status()
                .await
                .map_err(|e| format!("wpctl-failed: {e}"))?;
            if !status.success() {
                return Err(format!("wpctl exited with {status}"));
            }
        }
        "brightness" => {
            let pct = percent.clamp(0.0, 100.0);
            let session = Connection::session()
                .await
                .map_err(|e| format!("no-session-bus: {e}"))?;
            let dc = DisplayConfigProxy::new(&session)
                .await
                .map_err(|e| format!("display-config-unavailable: {e}"))?;
            let (serial, items) = dc
                .backlight()
                .await
                .map_err(|e| format!("backlight-read-failed: {e}"))?;
            let chosen = items
                .iter()
                .find(|m| {
                    let c = m.get("connector").and_then(variant_str).unwrap_or_default();
                    target.map_or(!c.is_empty(), |t| c == t)
                })
                .ok_or_else(|| "no-matching-backlight".to_owned())?;
            let connector = chosen
                .get("connector")
                .and_then(variant_str)
                .ok_or_else(|| "missing-connector".to_owned())?;
            let min = chosen.get("min").and_then(variant_i32).unwrap_or(0);
            let max = chosen.get("max").and_then(variant_i32).unwrap_or(100);
            let raw = min + ((f64::from(max - min)) * (pct / 100.0)).round() as i32;
            dc.set_backlight(serial, &connector, raw.clamp(min, max))
                .await
                .map_err(|e| format!("set-backlight-failed: {e}"))?;
        }
        "kbd-brightness" => {
            let pct = percent.clamp(0.0, 100.0).round() as i32;
            let session = Connection::session()
                .await
                .map_err(|e| format!("no-session-bus: {e}"))?;
            let kb = KeyboardBacklightProxy::new(&session)
                .await
                .map_err(|e| format!("kbd-backlight-unavailable: {e}"))?;
            kb.set_brightness(pct)
                .await
                .map_err(|e| format!("kbd-brightness-failed: {e}"))?;
        }
        other => return Err(format!("unknown-slider: {other}")),
    }

    let state = sample_state().await;
    hub.publish(vec![TopicUpdate {
        topic: Topic::new(STATE),
        value: state,
    }]);
    Ok(())
}

/// Validated launcher command for `.desktop` apps, URLs (`https://`/`http://`), or local paths.
pub async fn launch_target(kind: &str, target: &str) -> Result<(), String> {
    let trimmed = target.trim();
    if trimmed.is_empty() || trimmed.len() > 512 {
        return Err("invalid-launch-target".into());
    }
    match kind {
        "app" => {
            if !trimmed
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
            {
                return Err("invalid-desktop-id".into());
            }
            Command::new("gtk-launch")
                .arg(trimmed)
                .spawn()
                .map_err(|e| format!("launch-app-failed: {e}"))?;
            Ok(())
        }
        "url" => {
            let parsed = url::Url::parse(trimmed).map_err(|_| "invalid-url".to_owned())?;
            if parsed.scheme() != "https" && parsed.scheme() != "http" {
                return Err("only-http-https-urls-allowed".into());
            }
            Command::new("xdg-open")
                .arg(parsed.as_str())
                .spawn()
                .map_err(|e| format!("open-url-failed: {e}"))?;
            Ok(())
        }
        "path" => {
            let path = crate::sources::runners::expand_user_path(trimmed);
            if !path.exists() {
                return Err("path-not-found".into());
            }
            Command::new("xdg-open")
                .arg(&path)
                .spawn()
                .map_err(|e| format!("open-path-failed: {e}"))?;
            Ok(())
        }
        other => Err(format!("unknown-launch-kind: {other}")),
    }
}

/// Polls `controls.state` while subscribed (every 3 s, skipped while idle/paused).
pub async fn run(hub: Arc<Hub>) -> Result<(), String> {
    let mut tick = tokio::time::interval(Duration::from_secs(3));
    loop {
        tick.tick().await;
        if hub.paused() || !hub.is_subscribed(STATE) {
            continue;
        }
        let state = sample_state().await;
        hub.publish(vec![TopicUpdate {
            topic: Topic::new(STATE),
            value: state,
        }]);
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    #[test]
    fn parses_wpctl_volume_and_mute_flag() {
        assert_eq!(parse_wpctl_volume("Volume: 0.65\n"), Some((65.0, false)));
        assert_eq!(
            parse_wpctl_volume("Volume: 0.40 [MUTED]\n"),
            Some((40.0, true))
        );
        assert_eq!(parse_wpctl_volume("Volume: 1.50\n"), Some((150.0, false)));
        assert_eq!(parse_wpctl_volume("garbage"), None);
    }

    #[tokio::test]
    async fn launch_rejects_unsafe_urls_and_desktop_ids() {
        assert!(launch_target("url", "javascript:alert(1)").await.is_err());
        assert!(launch_target("url", "file:///etc/passwd").await.is_err());
        assert!(launch_target("app", "foo; rm -rf /").await.is_err());
    }
}

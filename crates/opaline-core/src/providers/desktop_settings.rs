//! GNOME settings through the Settings portal (`org.freedesktop.portal.Settings`): clock format
//! and appearance (color scheme, accent, animations, contrast, motion, text size). The time zone
//! comes from `org.freedesktop.timedate1`, the week start from the locale. Event-driven:
//! `SettingChanged` and `PropertiesChanged` wake a fetch. Screen lock is tracked separately
//! and always (`org.gnome.ScreenSaver.ActiveChanged`), because it changes how everything samples.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use opaline_ipc::{TopicUpdate, Value};
use tokio::sync::Notify;
use zbus::{Connection, MatchRule, MessageStream, OwnedVariant};

use crate::engine::{update, while_subscribed_notified};
use crate::hub::Hub;

pub const CLOCK: &str = "clock.settings";
pub const APPEARANCE: &str = "appearance.settings";
pub const LOCKED: &str = "session.locked";
pub const TOPICS: &[&str] = &[CLOCK, APPEARANCE];

const PERIOD: Duration = Duration::from_secs(3600);
const PORTAL: &str = "org.freedesktop.portal.Desktop";
const PORTAL_PATH: &str = "/org/freedesktop/portal/desktop";
const SETTINGS: &str = "org.freedesktop.portal.Settings";
const INTERFACE_NS: &str = "org.gnome.desktop.interface";
const A11Y_NS: &str = "org.gnome.desktop.a11y.interface";
const APPEARANCE_NS: &str = "org.freedesktop.appearance";

/// Appearance as the design system needs it.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Appearance {
    /// Portal `color-scheme`: 0 no preference, 1 dark, 2 light.
    pub color_scheme: Option<u32>,
    pub accent_rgb: Option<(f64, f64, f64)>,
    /// GNOME's named accent (`orange`, `blue`, …).
    pub accent_name: Option<String>,
    pub animations: Option<bool>,
    pub high_contrast: Option<bool>,
    pub reduced_motion: Option<bool>,
    pub text_scale: Option<f64>,
}

pub fn appearance_value(a: &Appearance) -> Value {
    Value::map([
        (
            "colorScheme",
            Value::from(match a.color_scheme {
                Some(1) => "dark",
                Some(2) => "light",
                _ => "default",
            }),
        ),
        (
            "accentRgb",
            a.accent_rgb
                .filter(|(r, g, b)| [r, g, b].iter().all(|c| (0.0..=1.0).contains(*c)))
                .map_or_else(
                    || Value::unavailable("not-reported"),
                    |(r, g, b)| Value::Nums(vec![r, g, b]),
                ),
        ),
        ("accentName", Value::from(a.accent_name.clone())),
        ("animations", Value::Bool(a.animations.unwrap_or(true))),
        (
            "highContrast",
            Value::Bool(a.high_contrast.unwrap_or(false)),
        ),
        (
            "reducedMotion",
            Value::Bool(a.reduced_motion.unwrap_or(false)),
        ),
        (
            "textScale",
            Value::Num(a.text_scale.filter(|s| *s > 0.0).unwrap_or(1.0)),
        ),
    ])
}

/// glibc's `first_weekday` (1 = Sunday … 7 = Saturday) as 0 = Sunday … 6 = Saturday.
pub fn week_start(first_weekday: &str) -> Option<u8> {
    let n: u8 = first_weekday.trim().parse().ok()?;
    (1..=7).contains(&n).then(|| n - 1)
}

pub fn clock_value(
    clock_format: Option<&str>,
    show_seconds: Option<bool>,
    timezone: Option<&str>,
    week: Option<u8>,
) -> Value {
    Value::map([
        ("format24h", Value::Bool(clock_format != Some("12h"))),
        ("showSeconds", Value::Bool(show_seconds.unwrap_or(false))),
        ("timezone", Value::from(timezone.map(str::to_owned))),
        ("weekStart", Value::from(week.map(f64::from))),
    ])
}

/// `ReadAll` for one namespace: key → value.
async fn read_all(conn: &Connection, ns: &str) -> Result<HashMap<String, OwnedVariant>, String> {
    let reply = conn
        .call_method(
            Some(PORTAL),
            PORTAL_PATH,
            Some(SETTINGS),
            "ReadAll",
            &(vec![ns],),
        )
        .await
        .map_err(|e| e.to_string())?;
    let mut all: HashMap<String, HashMap<String, OwnedVariant>> =
        reply.body().deserialize().map_err(|e| e.to_string())?;
    Ok(all.remove(ns).unwrap_or_default())
}

async fn timezone(conn: &Connection) -> Option<String> {
    let reply = conn
        .call_method(
            Some("org.freedesktop.timedate1"),
            "/org/freedesktop/timedate1",
            Some("org.freedesktop.DBus.Properties"),
            "Get",
            &("org.freedesktop.timedate1", "Timezone"),
        )
        .await
        .ok()?;
    let v: OwnedVariant = reply.body().deserialize().ok()?;
    <&str>::try_from(&v).ok().map(str::to_owned)
}

async fn first_weekday() -> Option<u8> {
    let out = tokio::process::Command::new("locale")
        .arg("first_weekday")
        .output()
        .await
        .ok()?;
    week_start(&String::from_utf8_lossy(&out.stdout))
}

async fn fetch(session: &Connection, system: &Connection) -> Result<Vec<TopicUpdate>, String> {
    let iface = read_all(session, INTERFACE_NS).await.unwrap_or_default();
    let clock_format = iface
        .get("clock-format")
        .and_then(|v| <&str>::try_from(v).ok());
    let show_seconds = iface
        .get("clock-show-seconds")
        .and_then(|v| bool::try_from(v).ok());
    let tz = timezone(system).await;
    let week = first_weekday().await;
    let a11y = read_all(session, A11Y_NS).await.unwrap_or_default();
    let portal = read_all(session, APPEARANCE_NS).await.unwrap_or_default();
    let appearance = Appearance {
        color_scheme: portal
            .get("color-scheme")
            .and_then(|v| u32::try_from(v).ok()),
        accent_rgb: portal
            .get("accent-color")
            .and_then(|v| v.try_clone().ok())
            .and_then(|v| zbus::Structure::try_from(v).ok())
            .and_then(|s| {
                let f: Vec<f64> = s
                    .fields()
                    .iter()
                    .filter_map(|x| f64::try_from(x).ok())
                    .collect();
                (f.len() == 3).then(|| (f[0], f[1], f[2]))
            }),
        accent_name: iface
            .get("accent-color")
            .and_then(|v| <&str>::try_from(v).ok())
            .map(str::to_owned),
        animations: iface
            .get("enable-animations")
            .and_then(|v| bool::try_from(v).ok()),
        high_contrast: a11y
            .get("high-contrast")
            .and_then(|v| bool::try_from(v).ok()),
        reduced_motion: portal
            .get("reduced-motion")
            .and_then(|v| u32::try_from(v).ok())
            .map(|m| m == 1)
            .or_else(|| {
                a11y.get("reduced-motion")
                    .and_then(|v| bool::try_from(v).ok())
            }),
        text_scale: iface
            .get("text-scaling-factor")
            .and_then(|v| f64::try_from(v).ok()),
    };
    Ok(vec![
        update(
            CLOCK,
            clock_value(clock_format, show_seconds, tz.as_deref(), week),
        ),
        update(APPEARANCE, appearance_value(&appearance)),
    ])
}

async fn listen(session: &Connection, system: &Connection, wake: &Notify) -> Result<(), String> {
    let portal = MatchRule::builder()
        .msg_type(zbus::message::Type::Signal)
        .interface(SETTINGS)
        .member("SettingChanged")
        .build()
        .map_err(|e| e.to_string())?;
    let timedate = MatchRule::builder()
        .msg_type(zbus::message::Type::Signal)
        .sender("org.freedesktop.timedate1")
        .interface("org.freedesktop.DBus.Properties")
        .member("PropertiesChanged")
        .build()
        .map_err(|e| e.to_string())?;
    let a = MessageStream::for_match_rule(portal, session, None)
        .await
        .map_err(|e| e.to_string())?;
    let b = MessageStream::for_match_rule(timedate, system, None)
        .await
        .map_err(|e| e.to_string())?;
    let mut merged = futures_util::stream::select(a, b);
    while merged.next().await.is_some() {
        wake.notify_one();
    }
    Err("settings signal stream ended".into())
}

pub async fn run(hub: Arc<Hub>) -> Result<(), String> {
    let session = Connection::session().await.map_err(|e| e.to_string())?;
    let system = Connection::system().await.map_err(|e| e.to_string())?;
    let wake = Notify::new();
    let watch = while_subscribed_notified(&hub, TOPICS, PERIOD, &wake, || {
        let (session, system) = (session.clone(), system.clone());
        async move { fetch(&session, &system).await }
    });
    tokio::select! {
        r = watch => r,
        r = listen(&session, &system, &wake) => r,
    }
}

/// Tracks the screen lock for the whole engine: while locked, sampling drops to the Idle rate
/// and nothing is pushed to the layer (brief §5.4).
pub async fn track_lock(hub: Arc<Hub>) -> Result<(), String> {
    let session = Connection::session().await.map_err(|e| e.to_string())?;
    let rule = MatchRule::builder()
        .msg_type(zbus::message::Type::Signal)
        .interface("org.gnome.ScreenSaver")
        .member("ActiveChanged")
        .build()
        .map_err(|e| e.to_string())?;
    let mut stream = MessageStream::for_match_rule(rule, &session, None)
        .await
        .map_err(|e| e.to_string())?;
    let initial = session
        .call_method(
            Some("org.gnome.ScreenSaver"),
            "/org/gnome/ScreenSaver",
            Some("org.gnome.ScreenSaver"),
            "GetActive",
            &(),
        )
        .await
        .ok()
        .and_then(|m| m.body().deserialize::<bool>().ok())
        .unwrap_or(false);
    let set = |locked: bool| {
        hub.set_locked(locked);
        hub.publish(vec![update(LOCKED, locked)]);
    };
    set(initial);
    while let Some(Ok(msg)) = stream.next().await {
        if let Ok(locked) = msg.body().deserialize::<bool>() {
            tracing::info!(locked, "screen lock changed");
            set(locked);
        }
    }
    Err("screen-lock signal stream ended".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appearance_defaults_and_ranges() {
        let Value::Map(m) = appearance_value(&Appearance::default()) else {
            return;
        };
        assert_eq!(m["colorScheme"], Value::from("default"));
        assert_eq!(m["animations"], Value::Bool(true));
        assert_eq!(m["textScale"], Value::Num(1.0));
        let Value::Map(m) = appearance_value(&Appearance {
            color_scheme: Some(1),
            accent_rgb: Some((0.93, 0.36, 0.0)),
            ..Appearance::default()
        }) else {
            return;
        };
        assert_eq!(m["colorScheme"], Value::from("dark"));
        assert_eq!(m["accentRgb"], Value::Nums(vec![0.93, 0.36, 0.0]));
    }

    #[test]
    fn week_starts() {
        assert_eq!(week_start("2\n"), Some(1), "de_DE: Monday");
        assert_eq!(week_start("1"), Some(0), "en_US: Sunday");
        assert_eq!(week_start("7"), Some(6), "Saturday");
        assert_eq!(week_start("0"), None);
    }

    #[test]
    fn clock_defaults_to_24h_unless_12h() {
        let v = clock_value(Some("12h"), None, Some("Europe/Berlin"), Some(1));
        let Value::Map(m) = v else { return };
        assert_eq!(m["format24h"], Value::Bool(false));
        assert_eq!(m["timezone"], Value::from("Europe/Berlin"));
        let Value::Map(m) = clock_value(None, None, None, None) else {
            return;
        };
        assert_eq!(m["format24h"], Value::Bool(true));
    }
}

//! GNOME settings through the Settings portal (`org.freedesktop.portal.Settings`): clock format,
//! and (Phase 1.15) appearance. The time zone comes from `org.freedesktop.timedate1`, the week
//! start from the locale. Event-driven: `SettingChanged` and `PropertiesChanged` wake a fetch.

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
pub const TOPICS: &[&str] = &[CLOCK];

const PERIOD: Duration = Duration::from_secs(3600);
const PORTAL: &str = "org.freedesktop.portal.Desktop";
const PORTAL_PATH: &str = "/org/freedesktop/portal/desktop";
const SETTINGS: &str = "org.freedesktop.portal.Settings";
const INTERFACE_NS: &str = "org.gnome.desktop.interface";

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
    Ok(vec![update(
        CLOCK,
        clock_value(clock_format, show_seconds, tz.as_deref(), week),
    )])
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

#[cfg(test)]
mod tests {
    use super::*;

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

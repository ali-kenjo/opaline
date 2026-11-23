//! `opaline --diagnose`: a redacted JSON inventory for bug reports (brief §5.9).
//!
//! System, session and displays, then every provider: its probe (what exists here, with
//! redacted details), its health and cost after a short run, and each topic's availability.
//! Topic *values* are left out on purpose: they can be personal (SSIDs, calendar entries,
//! song titles, process names).

use std::collections::BTreeMap;

use opaline_ipc::{Availability, Value};
use serde::Serialize;
use zbus::Connection;

use crate::displays;
use crate::engine::{Cost, Health};

/// Shell helper bus name (ARCHITECTURE §4).
pub const HELPER_BUS_NAME: &str = "io.github.ali_kenjo.Opaline.Shell1";

#[derive(Debug, Serialize)]
pub struct Report {
    pub opaline_version: &'static str,
    pub os: Os,
    pub session: Session,
    pub displays: Result<Vec<Display>, String>,
    pub desktop_integration: DesktopIntegration,
    pub providers: BTreeMap<String, ProviderReport>,
    /// Topic → `ok`, `no-data`, `unavailable: <reason>`, `asleep` or `needs-permission: <fix>`.
    pub topics: BTreeMap<String, String>,
}

#[derive(Debug, Serialize)]
pub struct ProviderReport {
    pub cost: Option<Cost>,
    pub health: Health,
    pub sample_us: Option<u64>,
    /// Probe facts (polled providers): sensor sources, device counts, drivers.
    pub details: BTreeMap<String, String>,
}

/// A topic's availability without its value.
pub fn status(value: Option<&Value>) -> String {
    match value {
        None => "no-data".into(),
        Some(Value::Missing(Availability::Unavailable { reason })) => {
            format!("unavailable: {reason}")
        }
        Some(Value::Missing(Availability::Asleep)) => "asleep".into(),
        Some(Value::Missing(Availability::NeedsPermission { fix })) => {
            format!("needs-permission: {fix}")
        }
        Some(_) => "ok".into(),
    }
}

#[derive(Debug, Serialize)]
pub struct Os {
    pub pretty_name: Option<String>,
    pub kernel: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Session {
    pub session_type: Option<String>,
    pub current_desktop: Option<String>,
    pub gnome_shell: Option<String>,
}

/// A monitor without its serial number, which is a stable hardware identifier.
#[derive(Debug, Serialize)]
pub struct Display {
    pub connector: String,
    pub vendor: String,
    pub product: String,
    pub serial_present: bool,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
    pub primary: bool,
    pub builtin: bool,
}

#[derive(Debug, Serialize)]
pub struct DesktopIntegration {
    pub helper_running: Option<bool>,
}

/// Reads `/etc/os-release`'s `PRETTY_NAME`.
pub fn parse_pretty_name(os_release: &str) -> Option<String> {
    os_release.lines().find_map(|line| {
        let value = line.strip_prefix("PRETTY_NAME=")?;
        Some(value.trim().trim_matches('"').to_owned())
    })
}

fn env(var: &str) -> Option<String> {
    std::env::var(var).ok().filter(|v| !v.is_empty())
}

/// Collects the report. Never fails: anything that can't be read is reported as such.
pub async fn collect() -> Report {
    let conn = Connection::session().await;

    let displays = match &conn {
        Ok(conn) => displays::current_monitors(conn)
            .await
            .map(|monitors| {
                monitors
                    .into_iter()
                    .map(|m| Display {
                        serial_present: !m.serial.is_empty()
                            && m.serial.trim_start_matches("0x").chars().any(|c| c != '0'),
                        connector: m.connector,
                        vendor: m.vendor,
                        product: m.product,
                        x: m.x,
                        y: m.y,
                        width: m.width,
                        height: m.height,
                        scale: m.scale,
                        primary: m.primary,
                        builtin: m.builtin,
                    })
                    .collect()
            })
            .map_err(|e| e.to_string()),
        Err(e) => Err(format!("no session bus: {e}")),
    };

    let (gnome_shell, helper_running) = match &conn {
        Ok(conn) => (shell_version(conn).await, helper_running(conn).await),
        Err(_) => (None, None),
    };

    let probes: BTreeMap<String, BTreeMap<String, String>> = tokio::task::spawn_blocking(|| {
        crate::providers::polled()
            .into_iter()
            .map(|mut p| (p.id().to_owned(), p.probe().details.into_iter().collect()))
            .collect()
    })
    .await
    .unwrap_or_default();
    let (hub, topics) = crate::dump::run_engine(None, |_| {}).await;
    let topics = topics
        .iter()
        .map(|t| (t.0.clone(), status(hub.latest(t).as_ref())))
        .collect();
    let providers = hub
        .provider_statuses()
        .into_iter()
        .map(|(id, s)| {
            let details = probes.get(&id).cloned().unwrap_or_default();
            (
                id,
                ProviderReport {
                    cost: s.cost,
                    health: s.health,
                    sample_us: s.sample_us,
                    details,
                },
            )
        })
        .collect();

    Report {
        opaline_version: env!("CARGO_PKG_VERSION"),
        os: Os {
            pretty_name: std::fs::read_to_string("/etc/os-release")
                .ok()
                .as_deref()
                .and_then(parse_pretty_name),
            kernel: std::fs::read_to_string("/proc/sys/kernel/osrelease")
                .ok()
                .map(|s| s.trim().to_owned()),
        },
        session: Session {
            session_type: env("XDG_SESSION_TYPE"),
            current_desktop: env("XDG_CURRENT_DESKTOP"),
            gnome_shell,
        },
        displays,
        desktop_integration: DesktopIntegration { helper_running },
        providers,
        topics,
    }
}

async fn shell_version(conn: &Connection) -> Option<String> {
    let proxy = zbus::Proxy::new(
        conn,
        "org.gnome.Shell.Extensions",
        "/org/gnome/Shell/Extensions",
        "org.gnome.Shell.Extensions",
    )
    .await
    .ok()?;
    proxy.get_property::<String>("ShellVersion").await.ok()
}

async fn helper_running(conn: &Connection) -> Option<bool> {
    let dbus = zbus::fdo::DBusProxy::new(conn).await.ok()?;
    let name = zbus::names::BusName::try_from(HELPER_BUS_NAME).ok()?;
    dbus.name_has_owner(name).await.ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn statuses_hide_values() {
        assert_eq!(status(None), "no-data");
        assert_eq!(status(Some(&Value::from("my-home-wifi"))), "ok");
        assert_eq!(
            status(Some(&Value::unavailable("no-battery"))),
            "unavailable: no-battery"
        );
        assert_eq!(
            status(Some(&Value::Missing(Availability::Asleep))),
            "asleep"
        );
    }

    #[test]
    fn reads_pretty_name() {
        let sample = "NAME=\"Ubuntu\"\nPRETTY_NAME=\"Ubuntu 26.04.1 LTS\"\nVERSION_ID=\"26.04\"\n";
        assert_eq!(
            parse_pretty_name(sample).as_deref(),
            Some("Ubuntu 26.04.1 LTS")
        );
        assert_eq!(parse_pretty_name("NAME=x\n"), None);
    }
}

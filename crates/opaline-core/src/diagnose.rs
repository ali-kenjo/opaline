//! `opaline --diagnose`: a redacted JSON inventory for bug reports (brief §5.9).
//!
//! Phase 0 covers the system, the session and the displays. Phase 1 adds every provider's
//! probe result.

use serde::Serialize;
use zbus::Connection;

use crate::displays;

/// Shell helper bus name (ARCHITECTURE §4).
pub const HELPER_BUS_NAME: &str = "io.github.ali_kenjo.Opaline.Shell1";

#[derive(Debug, Serialize)]
pub struct Report {
    pub opaline_version: &'static str,
    pub os: Os,
    pub session: Session,
    pub displays: Result<Vec<Display>, String>,
    pub desktop_integration: DesktopIntegration,
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
    fn reads_pretty_name() {
        let sample = "NAME=\"Ubuntu\"\nPRETTY_NAME=\"Ubuntu 26.04.1 LTS\"\nVERSION_ID=\"26.04\"\n";
        assert_eq!(
            parse_pretty_name(sample).as_deref(),
            Some("Ubuntu 26.04.1 LTS")
        );
        assert_eq!(parse_pretty_name("NAME=x\n"), None);
    }
}

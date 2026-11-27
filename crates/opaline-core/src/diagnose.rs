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
    /// Redacted custom-source inventory (kind, state, cost — never commands, URLs, or secrets).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub custom_sources: BTreeMap<String, crate::sources::SourceDiagnoseEntry>,
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
    pub helper_installed: bool,
    pub helper_running: Option<bool>,
    pub helper_api_version: Option<u32>,
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

    let (gnome_shell, helper_running, helper_api_version) = match &conn {
        Ok(conn) => {
            let running = helper_running(conn).await;
            let version = if running == Some(true) {
                helper_api_version(conn).await
            } else {
                None
            };
            (shell_version(conn).await, running, version)
        }
        Err(_) => (None, None, None),
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

    let custom_sources = crate::paths::config_dir()
        .map(|d| crate::sources::SourceManager::new(d).diagnose_entries())
        .unwrap_or_default();

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
        desktop_integration: DesktopIntegration {
            helper_installed: crate::desktop::helper_installed().is_some(),
            helper_running,
            helper_api_version,
        },
        providers,
        custom_sources,
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

async fn helper_api_version(conn: &Connection) -> Option<u32> {
    let shell = crate::desktop::Shell1Proxy::new(conn).await.ok()?;
    shell.api_version().await.ok()
}

/// Live diagnostics snapshot for Settings → Diagnostics (brief §5.9).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveDiagnostics {
    pub opaline_version: &'static str,
    pub backend: opaline_ipc::BackendKind,
    pub helper_installed: bool,
    pub helper_running: bool,
    pub helper_api_version: Option<u32>,
    pub core_pss_mb: f64,
    pub total_pss_mb: f64,
    pub process_cpu_jiffies: u64,
    pub total_cpu_jiffies: u64,
    pub process_count: usize,
    pub providers: BTreeMap<String, ProviderReport>,
    #[serde(default)]
    pub custom_sources: BTreeMap<String, crate::sources::SourceDiagnoseEntry>,
    pub topics: BTreeMap<String, String>,
    pub recent_logs: Vec<String>,
    pub debug_report_json: String,
}

fn read_pss_kb(pid: u32) -> Option<u64> {
    let text = std::fs::read_to_string(format!("/proc/{pid}/smaps_rollup")).ok()?;
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("Pss:") {
            return rest.split_whitespace().next()?.parse().ok();
        }
    }
    None
}

fn read_proc_jiffies(pid: u32) -> Option<u64> {
    let text = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let after = text.rsplit_once(") ")?.1;
    let mut fields = after.split_whitespace();
    let utime: u64 = fields.nth(11)?.parse().ok()?;
    let stime: u64 = fields.next()?.parse().ok()?;
    Some(utime.saturating_add(stime))
}

fn read_total_cpu_jiffies() -> u64 {
    let Ok(text) = std::fs::read_to_string("/proc/stat") else {
        return 0;
    };
    let Some(line) = text.lines().next() else {
        return 0;
    };
    line.split_whitespace()
        .skip(1)
        .filter_map(|s| s.parse::<u64>().ok())
        .sum()
}

/// Finds all Opaline processes (core, layer, and layer's WebKit children) owned by this UID.
fn opaline_pids() -> Vec<u32> {
    let own_uid = rustix::process::getuid().as_raw();
    let self_pid = std::process::id();
    let mut roots = vec![self_pid];
    let mut children_by_ppid: std::collections::HashMap<u32, Vec<u32>> =
        std::collections::HashMap::new();
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return roots;
    };
    for entry in entries.flatten() {
        let Some(pid) = entry
            .file_name()
            .to_str()
            .and_then(|s| s.parse::<u32>().ok())
        else {
            continue;
        };
        let Ok(status) = std::fs::read_to_string(format!("/proc/{pid}/status")) else {
            continue;
        };
        let mut uid_match = false;
        let mut ppid = 0u32;
        for line in status.lines() {
            if let Some(rest) = line.strip_prefix("Uid:") {
                uid_match = rest
                    .split_whitespace()
                    .next()
                    .and_then(|s| s.parse::<u32>().ok())
                    == Some(own_uid);
            } else if let Some(rest) = line.strip_prefix("PPid:") {
                ppid = rest.trim().parse().unwrap_or(0);
            }
        }
        if !uid_match {
            continue;
        }
        children_by_ppid.entry(ppid).or_default().push(pid);
        if pid != self_pid
            && let Ok(cmd) = std::fs::read_to_string(format!("/proc/{pid}/cmdline"))
            && cmd.contains("opaline")
            && cmd.contains("--layer")
        {
            roots.push(pid);
        }
    }
    let mut visited = std::collections::HashSet::new();
    let mut stack = roots;
    let mut out = Vec::new();
    while let Some(pid) = stack.pop() {
        if visited.insert(pid) {
            out.push(pid);
            if let Some(kids) = children_by_ppid.get(&pid) {
                stack.extend(kids.iter().copied());
            }
        }
    }
    out
}

fn read_recent_logs(max_lines: usize) -> Vec<String> {
    let Ok(dir) = crate::paths::state_dir().map(|d| d.join("logs")) else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut files: Vec<std::path::PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "log"))
        .collect();
    files.sort();
    let Some(newest) = files.last() else {
        return Vec::new();
    };
    let Ok(text) = std::fs::read_to_string(newest) else {
        return Vec::new();
    };
    let lines: Vec<String> = text.lines().map(str::to_owned).collect();
    let start = lines.len().saturating_sub(max_lines);
    lines[start..].to_vec()
}

/// Collects live diagnostics from the running hub (fast, no extra sampler run).
pub async fn live_snapshot(hub: &crate::hub::Hub) -> LiveDiagnostics {
    let desktop = crate::desktop::status(hub).await;
    let pids = tokio::task::spawn_blocking(opaline_pids)
        .await
        .unwrap_or_else(|_| vec![std::process::id()]);
    let process_count = pids.len();
    let self_pid = std::process::id();
    let (core_pss_kb, total_pss_kb, proc_jiffies, total_jiffies, recent_logs) =
        tokio::task::spawn_blocking(move || {
            let core_pss = read_pss_kb(self_pid).unwrap_or(0);
            let mut total_pss = 0u64;
            let mut jiffies = 0u64;
            for &pid in &pids {
                total_pss = total_pss.saturating_add(read_pss_kb(pid).unwrap_or(0));
                jiffies = jiffies.saturating_add(read_proc_jiffies(pid).unwrap_or(0));
            }
            (
                core_pss,
                total_pss,
                jiffies,
                read_total_cpu_jiffies(),
                read_recent_logs(60),
            )
        })
        .await
        .unwrap_or((0, 0, 0, 0, Vec::new()));

    let providers: BTreeMap<String, ProviderReport> = hub
        .provider_statuses()
        .into_iter()
        .map(|(id, s)| {
            (
                id,
                ProviderReport {
                    cost: s.cost,
                    health: s.health,
                    sample_us: s.sample_us,
                    details: BTreeMap::new(),
                },
            )
        })
        .collect();
    let topics: BTreeMap<String, String> = hub
        .all_latest()
        .iter()
        .map(|(k, v)| (k.clone(), status(Some(v))))
        .collect();

    let displays: Vec<Display> = hub
        .monitors()
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
        .collect();

    let custom_sources = hub
        .sources()
        .map(|m| m.diagnose_entries())
        .unwrap_or_default();

    let report = Report {
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
            gnome_shell: None,
        },
        displays: Ok(displays),
        desktop_integration: DesktopIntegration {
            helper_installed: desktop.helper_installed,
            helper_running: Some(desktop.helper_running),
            helper_api_version: desktop.helper_api_version,
        },
        providers: providers
            .iter()
            .map(|(k, v)| {
                (
                    k.clone(),
                    ProviderReport {
                        cost: v.cost,
                        health: v.health.clone(),
                        sample_us: v.sample_us,
                        details: v.details.clone(),
                    },
                )
            })
            .collect(),
        custom_sources: custom_sources.clone(),
        topics: topics.clone(),
    };
    let debug_report_json = serde_json::to_string_pretty(&report).unwrap_or_default();

    LiveDiagnostics {
        opaline_version: env!("CARGO_PKG_VERSION"),
        backend: desktop.backend,
        helper_installed: desktop.helper_installed,
        helper_running: desktop.helper_running,
        helper_api_version: desktop.helper_api_version,
        core_pss_mb: (core_pss_kb as f64 / 1024.0 * 10.0).round() / 10.0,
        total_pss_mb: (total_pss_kb as f64 / 1024.0 * 10.0).round() / 10.0,
        process_cpu_jiffies: proc_jiffies,
        total_cpu_jiffies: total_jiffies,
        process_count,
        providers,
        custom_sources,
        topics,
        recent_logs,
        debug_report_json,
    }
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

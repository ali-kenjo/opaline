//! Desktop integration (brief §5.2): picks Native mode when the GNOME Shell helper answers on
//! `io.github.ali_kenjo.Opaline.Shell1` with a compatible `ApiVersion`, else Instant mode, and
//! switches live when the helper appears (after a re-login) or goes away. In Native mode it
//! passes the helper's signals on: desktop focus (Automatic appearance), covered monitors
//! (sampling), shortcuts (Peek/Edit), and raises the layer for Peek/Edit.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

use futures_util::StreamExt;
use opaline_ipc::{BackendKind, CoreEvent};
use tokio::sync::mpsc;
use zbus::{Connection, proxy};

use crate::app_service::AppRequest;
use crate::hub::Hub;

pub const HELPER_UUID: &str = "opaline-desktop@ali-kenjo.github.io";
pub const SHELL1_NAME: &str = "io.github.ali_kenjo.Opaline.Shell1";
/// The helper API this core speaks; N−1 is supported too (version skew after updates).
pub const API_VERSION: u32 = 1;

#[proxy(
    interface = "io.github.ali_kenjo.Opaline.Shell1",
    default_service = "io.github.ali_kenjo.Opaline.Shell1",
    default_path = "/io/github/ali_kenjo/Opaline/Shell1"
)]
pub trait Shell1 {
    #[zbus(property)]
    fn api_version(&self) -> zbus::Result<u32>;
    #[zbus(property)]
    fn desktop_focused(&self) -> zbus::Result<bool>;
    fn get_work_areas(&self) -> zbus::Result<Vec<(String, i32, i32, i32, i32)>>;
    fn set_raised(&self, raised: bool) -> zbus::Result<()>;
    #[zbus(signal)]
    fn work_areas_changed(&self) -> zbus::Result<()>;
    #[zbus(signal)]
    fn desktop_focus_changed(&self, focused: bool) -> zbus::Result<()>;
    #[zbus(signal)]
    fn layer_covered(&self, connector: String, covered: bool) -> zbus::Result<()>;
    #[zbus(signal)]
    fn shortcut_activated(&self, name: String) -> zbus::Result<()>;
}

#[proxy(
    interface = "org.gnome.Shell.Extensions",
    default_service = "org.gnome.Shell.Extensions",
    default_path = "/org/gnome/Shell/Extensions"
)]
trait ShellExtensions {
    fn enable_extension(&self, uuid: &str) -> zbus::Result<bool>;
    fn disable_extension(&self, uuid: &str) -> zbus::Result<bool>;
}

/// Whether a helper with this API version can be used.
pub fn compatible(version: u32) -> bool {
    version == API_VERSION || version.saturating_add(1) == API_VERSION
}

/// Where the helper is installed (the `.deb` puts it in /usr/share; a dev install in ~/.local).
pub fn helper_installed() -> Option<PathBuf> {
    let user = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
        .map(|d| d.join("gnome-shell/extensions").join(HELPER_UUID));
    let system = PathBuf::from("/usr/share/gnome-shell/extensions").join(HELPER_UUID);
    [user, Some(system)]
        .into_iter()
        .flatten()
        .find(|p| p.join("metadata.json").is_file())
}

/// Turns the helper on for this user if it's installed (brief §5.2 "Helper install"): through
/// the shell's Extensions API, else by adding it to `enabled-extensions` (the running shell
/// doesn't know a freshly installed helper until the next login).
pub async fn ensure_enabled(conn: &Connection) {
    let Some(path) = helper_installed() else {
        tracing::info!("desktop integration helper not installed; Instant mode");
        return;
    };
    tracing::info!(path = %path.display(), "desktop integration helper installed");
    let enabled = match ShellExtensionsProxy::new(conn).await {
        Ok(p) => p.enable_extension(HELPER_UUID).await.unwrap_or(false),
        Err(_) => false,
    };
    if enabled {
        return;
    }
    match add_to_enabled_extensions().await {
        Ok(true) => {
            tracing::info!("helper added to enabled-extensions; it starts after the next login")
        }
        Ok(false) => {}
        Err(error) => tracing::warn!(%error, "could not enable the desktop integration helper"),
    }
}

/// Parses `gsettings get org.gnome.shell enabled-extensions` output (`['a', 'b']` or `@as []`).
pub fn parse_string_list(text: &str) -> Vec<String> {
    let t = text.trim().trim_start_matches("@as").trim();
    let inner = t.trim_start_matches('[').trim_end_matches(']');
    inner
        .split(',')
        .map(|s| s.trim().trim_matches('\'').trim_matches('"').to_owned())
        .filter(|s| !s.is_empty())
        .collect()
}

/// Adds or removes the helper from `org.gnome.shell enabled-extensions`.
async fn set_in_enabled_extensions(enable: bool) -> std::io::Result<bool> {
    let out = tokio::process::Command::new("gsettings")
        .args(["get", "org.gnome.shell", "enabled-extensions"])
        .output()
        .await?;
    let mut list = parse_string_list(&String::from_utf8_lossy(&out.stdout));
    let has = list.iter().any(|u| u == HELPER_UUID);
    if enable == has {
        return Ok(false);
    }
    if enable {
        list.push(HELPER_UUID.to_owned());
    } else {
        list.retain(|u| u != HELPER_UUID);
    }
    let value = format!(
        "[{}]",
        list.iter()
            .map(|u| format!("'{}'", u.replace('\'', "")))
            .collect::<Vec<_>>()
            .join(", ")
    );
    let status = tokio::process::Command::new("gsettings")
        .args(["set", "org.gnome.shell", "enabled-extensions", &value])
        .status()
        .await?;
    Ok(status.success())
}

async fn add_to_enabled_extensions() -> std::io::Result<bool> {
    set_in_enabled_extensions(true).await
}

/// Live desktop integration status shown in Settings → Desktop integration and Onboarding.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopStatus {
    pub backend: BackendKind,
    pub helper_installed: bool,
    pub helper_enabled: bool,
    pub helper_running: bool,
    pub helper_api_version: Option<u32>,
    pub helper_path: Option<String>,
}

/// Inspects current desktop integration state for Settings / Onboarding.
pub async fn status(hub: &Hub) -> DesktopStatus {
    let path = helper_installed();
    let helper_installed = path.is_some();
    let helper_enabled = match tokio::process::Command::new("gsettings")
        .args(["get", "org.gnome.shell", "enabled-extensions"])
        .output()
        .await
    {
        Ok(out) => parse_string_list(&String::from_utf8_lossy(&out.stdout))
            .iter()
            .any(|u| u == HELPER_UUID),
        Err(_) => false,
    };
    let (helper_running, helper_api_version) = match BUS.get() {
        Some(conn) => match Shell1Proxy::new(conn).await {
            Ok(shell) => match shell.api_version().await {
                Ok(v) => (true, Some(v)),
                Err(_) => (false, None),
            },
            Err(_) => (false, None),
        },
        None => (false, None),
    };
    DesktopStatus {
        backend: hub.backend(),
        helper_installed,
        helper_enabled,
        helper_running,
        helper_api_version,
        helper_path: path.map(|p| p.display().to_string()),
    }
}

/// Enables or disables the GNOME Shell desktop-integration helper via `org.gnome.Shell.Extensions`
/// with `gsettings enabled-extensions` fallback (brief §5.2).
pub async fn set_helper_enabled(enabled: bool) -> Result<(), String> {
    if let Some(conn) = BUS.get()
        && let Ok(proxy) = ShellExtensionsProxy::new(conn).await
    {
        let ok = if enabled {
            proxy.enable_extension(HELPER_UUID).await.unwrap_or(false)
        } else {
            proxy.disable_extension(HELPER_UUID).await.unwrap_or(false)
        };
        if ok {
            return Ok(());
        }
    }
    set_in_enabled_extensions(enabled)
        .await
        .map(|_| ())
        .map_err(|e| format!("gsettings-failed: {e}"))
}

/// The session bus connection `run` uses, for commands (SetRaised) that reach the helper.
static BUS: OnceLock<Connection> = OnceLock::new();

/// Asks the helper to raise or lower the layer (Peek/Edit). A no-op in Instant mode.
pub async fn set_raised(hub: &Hub, raised: bool) -> Result<(), String> {
    if hub.backend() != BackendKind::Native {
        return Ok(());
    }
    let conn = BUS.get().ok_or("no-session-bus")?;
    let shell = Shell1Proxy::new(conn).await.map_err(|e| e.to_string())?;
    shell.set_raised(raised).await.map_err(|e| e.to_string())
}

/// The backend to start in: Native if a compatible helper answers right now.
pub async fn initial_backend(conn: &Connection) -> BackendKind {
    let Ok(shell) = Shell1Proxy::new(conn).await else {
        return BackendKind::Instant;
    };
    match shell.api_version().await {
        Ok(v) if compatible(v) => BackendKind::Native,
        _ => BackendKind::Instant,
    }
}

/// Reads per-connector work areas from the helper (for Native mode at startup and on change).
pub async fn read_work_areas(conn: &Connection) -> HashMap<String, (i32, i32, u32, u32)> {
    let Ok(shell) = Shell1Proxy::new(conn).await else {
        return HashMap::new();
    };
    parse_work_areas(shell.get_work_areas().await.unwrap_or_default())
}

fn parse_work_areas(
    raw: Vec<(String, i32, i32, i32, i32)>,
) -> HashMap<String, (i32, i32, u32, u32)> {
    raw.into_iter()
        .filter_map(|(connector, x, y, w, h)| {
            let (w, h) = (u32::try_from(w).ok()?, u32::try_from(h).ok()?);
            (w > 0 && h > 0).then_some((connector, (x, y, w, h)))
        })
        .collect()
}

/// Watches the helper for as long as core runs and keeps the hub's backend in step.
pub async fn run(conn: Connection, hub: Arc<Hub>, requests: mpsc::UnboundedSender<AppRequest>) {
    let _ = BUS.set(conn.clone());
    let dbus = match zbus::fdo::DBusProxy::new(&conn).await {
        Ok(p) => p,
        Err(error) => {
            tracing::warn!(%error, "no D-Bus daemon proxy; staying in Instant mode");
            return;
        }
    };
    let mut owners = match dbus.receive_name_owner_changed().await {
        Ok(s) => s,
        Err(error) => {
            tracing::warn!(%error, "cannot watch the helper; staying in Instant mode");
            return;
        }
    };
    loop {
        let present = match zbus::names::BusName::try_from(SHELL1_NAME) {
            Ok(name) => dbus.name_has_owner(name).await.unwrap_or(false),
            Err(_) => false,
        };
        let session = if present {
            Some(native_session(&conn, &hub, &requests))
        } else {
            hub.clear_covered();
            hub.clear_work_areas();
            hub.set_backend(BackendKind::Instant);
            None
        };
        // Wait until the helper's name changes owner, while serving its signals.
        let changed = async {
            while let Some(signal) = owners.next().await {
                if signal
                    .args()
                    .is_ok_and(|a| a.name().as_str() == SHELL1_NAME)
                {
                    return;
                }
            }
        };
        match session {
            Some(session) => {
                tokio::select! {
                    () = changed => {}
                    () = session => {
                        // The session ended on its own (incompatible helper); wait for a change.
                        let again = async {
                            while let Some(signal) = owners.next().await {
                                if signal.args().is_ok_and(|a| a.name().as_str() == SHELL1_NAME) {
                                    return;
                                }
                            }
                        };
                        again.await;
                    }
                }
            }
            None => changed.await,
        }
        tracing::info!("desktop integration helper changed; re-checking");
    }
}

/// Native mode while the helper is compatible: forwards its signals until they end.
async fn native_session(
    conn: &Connection,
    hub: &Arc<Hub>,
    requests: &mpsc::UnboundedSender<AppRequest>,
) {
    let shell = match Shell1Proxy::new(conn).await {
        Ok(p) => p,
        Err(error) => {
            tracing::warn!(%error, "helper present but not reachable; Instant mode");
            hub.set_backend(BackendKind::Instant);
            return;
        }
    };
    let version = shell.api_version().await.unwrap_or(0);
    if !compatible(version) {
        tracing::warn!(
            version,
            supported = API_VERSION,
            "helper API not compatible; Instant mode until it's updated (log out and back in)"
        );
        hub.set_backend(BackendKind::Instant);
        return;
    }
    tracing::info!(version, "desktop integration helper found; Native mode");
    if let Ok(raw) = shell.get_work_areas().await {
        hub.set_work_areas(parse_work_areas(raw));
    }
    hub.set_backend(BackendKind::Native);
    if let Ok(focused) = shell.desktop_focused().await {
        hub.emit(CoreEvent::DesktopFocusChanged { focused });
    }
    let (Ok(mut focus), Ok(mut covered), Ok(mut shortcuts), Ok(mut work_areas)) = (
        shell.receive_desktop_focus_changed().await,
        shell.receive_layer_covered().await,
        shell.receive_shortcut_activated().await,
        shell.receive_work_areas_changed().await,
    ) else {
        tracing::warn!("could not subscribe to the helper's signals");
        return;
    };
    loop {
        tokio::select! {
            Some(s) = focus.next() => {
                if let Ok(a) = s.args() {
                    hub.emit(CoreEvent::DesktopFocusChanged { focused: a.focused });
                }
            }
            Some(s) = covered.next() => {
                if let Ok(a) = s.args() {
                    hub.set_covered(&a.connector, a.covered);
                }
            }
            Some(_) = work_areas.next() => {
                if let Ok(raw) = shell.get_work_areas().await {
                    hub.set_work_areas(parse_work_areas(raw));
                }
            }
            Some(s) = shortcuts.next() => {
                if let Ok(a) = s.args() {
                    let request = match a.name.as_str() {
                        "peek" => Some(AppRequest::Peek),
                        "edit" => Some(AppRequest::Edit),
                        _ => None,
                    };
                    if let Some(r) = request {
                        let _ = requests.send(r);
                    }
                }
            }
            else => break,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_n_and_n_minus_one() {
        assert!(compatible(API_VERSION));
        assert!(compatible(API_VERSION - 1) || API_VERSION == 1);
        assert!(!compatible(API_VERSION + 1));
        assert!(!compatible(API_VERSION + 5));
    }

    #[test]
    fn gsettings_lists() {
        assert_eq!(parse_string_list("@as []"), Vec::<String>::new());
        assert_eq!(
            parse_string_list("['ding@rastersoft.com', 'ubuntu-dock@ubuntu.com']\n"),
            ["ding@rastersoft.com", "ubuntu-dock@ubuntu.com"]
        );
    }
}

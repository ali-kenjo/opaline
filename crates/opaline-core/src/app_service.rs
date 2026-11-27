//! Session D-Bus service `io.github.ali_kenjo.Opaline` (`io.github.ali_kenjo.Opaline1`, API v2)
//! and single-instance handling (PLAN-2 8.5, `docs/DBUS.md`).
//!
//! The first core owns the bus name. Any later `opaline` invocation forwards its request to the
//! running core and exits. `opaline ctl …` and external automation scripts call the validated
//! v2 methods and listen to `ProfileChanged`, `ThemeChanged`, `VariableChanged`, and
//! `WidgetAction` signals.

use std::sync::{Arc, OnceLock};

use opaline_ipc::BackendKind;
use serde_json::{Value as Json, json};
use tokio::sync::{mpsc, watch};
use zbus::fdo::{Error as FdoError, RequestNameFlags, RequestNameReply};
use zbus::object_server::SignalEmitter;
use zbus::{Connection, connection, interface, proxy};

use crate::hub::{DbusSignal, Hub};
use crate::layouts::LayoutItem;
use crate::store::DesktopLook;

pub const BUS_NAME: &str = "io.github.ali_kenjo.Opaline";
pub const OBJECT_PATH: &str = "/io/github/ali_kenjo/Opaline";
pub const DBUS_API_VERSION: u32 = 2;

/// A request from the tray, a desktop-file action, a shortcut, a second launch, or D-Bus.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppRequest {
    Peek,
    PeekMonitor(String),
    Edit,
    OpenSettings,
    OpenOnboarding,
    NextProfile,
    CycleLook,
    Quit,
}

struct AppService {
    requests: mpsc::UnboundedSender<AppRequest>,
    backend: watch::Receiver<BackendKind>,
    layer: LayerLaunch,
    hub: Arc<OnceLock<Arc<Hub>>>,
}

/// How the shell helper should start the layer in Native mode: this very binary (so dev
/// builds work) and a few environment variables (the helper accepts only an allow-list).
#[derive(Debug, Clone, Default)]
pub struct LayerLaunch {
    pub executable: String,
    pub environment: std::collections::HashMap<String, String>,
}

impl AppService {
    fn forward(&self, request: AppRequest) {
        if let Err(err) = self.requests.send(request) {
            tracing::warn!(request = ?err.0, "core is shutting down; request dropped");
        }
    }

    fn require_hub(&self) -> Result<Arc<Hub>, FdoError> {
        self.hub
            .get()
            .cloned()
            .ok_or_else(|| FdoError::Failed("core-initializing".into()))
    }
}

#[interface(name = "io.github.ali_kenjo.Opaline1")]
impl AppService {
    // ── v1 methods (preserved unchanged) ────────────────────────────────────────────────────

    fn peek(&self) {
        self.forward(AppRequest::Peek);
    }

    fn edit(&self) {
        self.forward(AppRequest::Edit);
    }

    fn open_settings(&self) {
        self.forward(AppRequest::OpenSettings);
    }

    fn open_onboarding(&self) {
        self.forward(AppRequest::OpenOnboarding);
    }

    fn quit(&self) {
        self.forward(AppRequest::Quit);
    }

    // ── v1 + v2 properties ──────────────────────────────────────────────────────────────────

    #[zbus(property)]
    fn api_version(&self) -> u32 {
        DBUS_API_VERSION
    }

    #[zbus(property)]
    fn backend_mode(&self) -> String {
        match *self.backend.borrow() {
            BackendKind::Native => "native",
            BackendKind::Instant => "instant",
        }
        .to_owned()
    }

    #[zbus(property)]
    fn layer_executable(&self) -> String {
        self.layer.executable.clone()
    }

    #[zbus(property)]
    fn layer_environment(&self) -> std::collections::HashMap<String, String> {
        self.layer.environment.clone()
    }

    // ── v2 methods (PLAN-2 8.5, validated JSON API for `opaline ctl` & scripts) ─────────────

    fn get_status(&self) -> Result<String, FdoError> {
        let hub = self.require_hub()?;
        let settings = hub.settings();
        let layouts = hub.layouts();
        let monitors = hub.monitors();
        let active_profile = hub.profiles().and_then(|p| p.active_id());
        let widget_count: usize = layouts.monitors.values().map(|m| m.items.len()).sum();
        let payload = json!({
            "apiVersion": DBUS_API_VERSION,
            "version": env!("CARGO_PKG_VERSION"),
            "backend": match hub.backend() {
                BackendKind::Native => "native",
                BackendKind::Instant => "instant",
            },
            "theme": settings.theme,
            "look": settings.appearance.look,
            "appearanceState": settings.appearance.state,
            "performanceMode": settings.performance.mode,
            "activeProfile": active_profile,
            "paused": hub.paused(),
            "safeMode": hub.safe_mode(),
            "monitorCount": monitors.len(),
            "monitors": monitors.iter().map(|m| &m.connector).collect::<Vec<_>>(),
            "widgetCount": widget_count,
        });
        serde_json::to_string(&payload).map_err(|e| FdoError::Failed(e.to_string()))
    }

    fn get_setting(&self, path: &str) -> Result<String, FdoError> {
        let hub = self.require_hub()?;
        let root =
            serde_json::to_value(&*hub.settings()).map_err(|e| FdoError::Failed(e.to_string()))?;
        let val = json_path_get(&root, path)
            .ok_or_else(|| FdoError::InvalidArgs(format!("path-not-found: {path}")))?;
        serde_json::to_string(val).map_err(|e| FdoError::Failed(e.to_string()))
    }

    async fn set_setting(&self, path: &str, value_json: &str) -> Result<String, FdoError> {
        let hub = self.require_hub()?;
        let val: Json = serde_json::from_str(value_json)
            .map_err(|e| FdoError::InvalidArgs(format!("invalid-json: {e}")))?;
        let patch = json_path_patch(path, val).map_err(FdoError::InvalidArgs)?;
        let prev_theme = hub.settings().theme.clone();
        crate::store::update(&hub, patch)
            .await
            .map_err(FdoError::InvalidArgs)?;
        let next_theme = hub.settings().theme.clone();
        if next_theme != prev_theme {
            hub.emit_dbus(DbusSignal::ThemeChanged {
                theme_id: next_theme,
            });
        }
        Ok(json!({ "ok": true, "path": path }).to_string())
    }

    fn list_widgets(&self) -> Result<String, FdoError> {
        let hub = self.require_hub()?;
        let layouts = hub.layouts();
        let mut out = Vec::new();
        for (monitor_key, mon) in &layouts.monitors {
            for item in &mon.items {
                if let LayoutItem::Widget {
                    id,
                    kind,
                    x,
                    y,
                    w,
                    h,
                    ..
                } = item
                {
                    out.push(json!({
                        "id": id,
                        "kind": kind,
                        "monitor": monitor_key,
                        "x": x,
                        "y": y,
                        "w": w,
                        "h": h,
                    }));
                }
            }
        }
        serde_json::to_string(&out).map_err(|e| FdoError::Failed(e.to_string()))
    }

    #[allow(clippy::too_many_arguments)]
    async fn add_widget(
        &self,
        kind: &str,
        monitor: &str,
        x: i32,
        y: i32,
        w: i32,
        h: i32,
    ) -> Result<String, FdoError> {
        let hub = self.require_hub()?;
        if kind.trim().is_empty() || kind.len() > 64 {
            return Err(FdoError::InvalidArgs("invalid-widget-kind".into()));
        }
        let x = u32::try_from(x).map_err(|_| FdoError::InvalidArgs("negative-x".into()))?;
        let y = u32::try_from(y).map_err(|_| FdoError::InvalidArgs("negative-y".into()))?;
        let w = u32::try_from(w)
            .ok()
            .filter(|v| (1..=16).contains(v))
            .ok_or_else(|| FdoError::InvalidArgs("invalid-width".into()))?;
        let h = u32::try_from(h)
            .ok()
            .filter(|v| (1..=16).contains(v))
            .ok_or_else(|| FdoError::InvalidArgs("invalid-height".into()))?;

        let mut layouts = (*hub.layouts()).clone();
        let mon_key = resolve_monitor_key(&hub, &layouts, monitor)
            .ok_or_else(|| FdoError::InvalidArgs("monitor-not-found".into()))?;
        let id = format!(
            "w-{}-{}",
            kind.replace(':', "-"),
            crate::hub::now_ms() % 100_000
        );
        let entry = layouts.monitors.entry(mon_key.clone()).or_default();
        entry.items.push(LayoutItem::Widget {
            id: id.clone(),
            kind: kind.to_owned(),
            x,
            y,
            w,
            h,
            free: None,
            z: 0,
            locked: false,
            group_id: None,
        });
        let raw = serde_json::to_value(&layouts).map_err(|e| FdoError::Failed(e.to_string()))?;
        crate::layouts::update(&hub, raw)
            .await
            .map_err(FdoError::InvalidArgs)?;
        Ok(json!({ "ok": true, "id": id, "monitor": mon_key }).to_string())
    }

    async fn remove_widget(&self, id: &str) -> Result<String, FdoError> {
        let hub = self.require_hub()?;
        let mut layouts = (*hub.layouts()).clone();
        let mut removed = false;
        for mon in layouts.monitors.values_mut() {
            let before = mon.items.len();
            mon.items.retain(|item| match item {
                LayoutItem::Widget { id: wid, .. } => wid != id,
                LayoutItem::Stack { id: sid, .. } => sid != id,
            });
            if mon.items.len() != before {
                removed = true;
            }
        }
        if !removed {
            return Err(FdoError::InvalidArgs(format!("widget-not-found: {id}")));
        }
        let raw = serde_json::to_value(&layouts).map_err(|e| FdoError::Failed(e.to_string()))?;
        crate::layouts::update(&hub, raw)
            .await
            .map_err(FdoError::Failed)?;
        Ok(json!({ "ok": true, "removed": id }).to_string())
    }

    #[allow(clippy::too_many_arguments)]
    async fn move_widget(
        &self,
        id: &str,
        monitor: &str,
        x: i32,
        y: i32,
        w: i32,
        h: i32,
    ) -> Result<String, FdoError> {
        let hub = self.require_hub()?;
        let x = u32::try_from(x).map_err(|_| FdoError::InvalidArgs("negative-x".into()))?;
        let y = u32::try_from(y).map_err(|_| FdoError::InvalidArgs("negative-y".into()))?;
        let w = u32::try_from(w)
            .ok()
            .filter(|v| (1..=16).contains(v))
            .ok_or_else(|| FdoError::InvalidArgs("invalid-width".into()))?;
        let h = u32::try_from(h)
            .ok()
            .filter(|v| (1..=16).contains(v))
            .ok_or_else(|| FdoError::InvalidArgs("invalid-height".into()))?;

        let mut layouts = (*hub.layouts()).clone();
        let mut found: Option<(String, LayoutItem)> = None;
        for (k, mon) in &mut layouts.monitors {
            if let Some(pos) = mon.items.iter().position(|it| match it {
                LayoutItem::Widget { id: wid, .. } => wid == id,
                LayoutItem::Stack { id: sid, .. } => sid == id,
            }) {
                found = Some((k.clone(), mon.items.remove(pos)));
                break;
            }
        }
        let Some((orig_mon, mut item)) = found else {
            return Err(FdoError::InvalidArgs(format!("widget-not-found: {id}")));
        };
        let target_mon = if monitor.trim().is_empty() {
            orig_mon
        } else {
            resolve_monitor_key(&hub, &layouts, monitor)
                .ok_or_else(|| FdoError::InvalidArgs("monitor-not-found".into()))?
        };
        match &mut item {
            LayoutItem::Widget {
                x: ix,
                y: iy,
                w: iw,
                h: ih,
                ..
            }
            | LayoutItem::Stack {
                x: ix,
                y: iy,
                w: iw,
                h: ih,
                ..
            } => {
                *ix = x;
                *iy = y;
                *iw = w;
                *ih = h;
            }
        }
        layouts
            .monitors
            .entry(target_mon.clone())
            .or_default()
            .items
            .push(item);
        let raw = serde_json::to_value(&layouts).map_err(|e| FdoError::Failed(e.to_string()))?;
        crate::layouts::update(&hub, raw)
            .await
            .map_err(FdoError::InvalidArgs)?;
        Ok(json!({ "ok": true, "id": id, "monitor": target_mon }).to_string())
    }

    fn toggle_widget(&self, id: &str) -> Result<String, FdoError> {
        let hub = self.require_hub()?;
        let profiles = hub
            .profiles()
            .ok_or_else(|| FdoError::Failed("profiles-unavailable".into()))?;
        let visible = profiles
            .toggle_widget_visibility(&hub, id)
            .map_err(FdoError::InvalidArgs)?;
        Ok(json!({ "ok": true, "id": id, "visible": visible }).to_string())
    }

    fn list_profiles(&self) -> Result<String, FdoError> {
        let hub = self.require_hub()?;
        let profiles = hub
            .profiles()
            .ok_or_else(|| FdoError::Failed("profiles-unavailable".into()))?;
        serde_json::to_string(&profiles.snapshot()).map_err(|e| FdoError::Failed(e.to_string()))
    }

    async fn set_profile(&self, id: &str) -> Result<String, FdoError> {
        let hub = self.require_hub()?;
        let profiles = hub
            .profiles()
            .ok_or_else(|| FdoError::Failed("profiles-unavailable".into()))?;
        let p = profiles
            .activate(&hub, id, true)
            .await
            .map_err(FdoError::InvalidArgs)?;
        serde_json::to_string(&p).map_err(|e| FdoError::Failed(e.to_string()))
    }

    fn save_profile(&self, id: &str, name: &str) -> Result<String, FdoError> {
        let hub = self.require_hub()?;
        let profiles = hub
            .profiles()
            .ok_or_else(|| FdoError::Failed("profiles-unavailable".into()))?;
        let p = profiles
            .snapshot_current(&hub, id, name)
            .map_err(FdoError::InvalidArgs)?;
        serde_json::to_string(&p).map_err(|e| FdoError::Failed(e.to_string()))
    }

    fn delete_profile(&self, id: &str) -> Result<String, FdoError> {
        let hub = self.require_hub()?;
        let profiles = hub
            .profiles()
            .ok_or_else(|| FdoError::Failed("profiles-unavailable".into()))?;
        let removed = profiles.delete(&hub, id).map_err(FdoError::InvalidArgs)?;
        Ok(json!({ "ok": true, "removed": removed }).to_string())
    }

    async fn set_theme(&self, id: &str) -> Result<String, FdoError> {
        let hub = self.require_hub()?;
        let trimmed = id.trim();
        if trimmed.is_empty() || trimmed.len() > 64 {
            return Err(FdoError::InvalidArgs("invalid-theme-id".into()));
        }
        crate::store::update(&hub, json!({ "theme": trimmed }))
            .await
            .map_err(FdoError::InvalidArgs)?;
        hub.emit_dbus(DbusSignal::ThemeChanged {
            theme_id: trimmed.to_owned(),
        });
        Ok(json!({ "ok": true, "theme": trimmed }).to_string())
    }

    async fn set_look(&self, look: &str) -> Result<String, FdoError> {
        let hub = self.require_hub()?;
        let parsed: DesktopLook = serde_json::from_value(Json::String(look.trim().to_owned()))
            .map_err(|_| FdoError::InvalidArgs(format!("unknown-look: {look}")))?;
        let val = serde_json::to_value(parsed).map_err(|e| FdoError::Failed(e.to_string()))?;
        crate::store::update(&hub, json!({ "appearance": { "look": val } }))
            .await
            .map_err(FdoError::InvalidArgs)?;
        if let Some(auto) = hub.automation() {
            auto.set_manual_override(&hub, Some(format!("Manual look switch to '{look}'")));
        }
        Ok(json!({ "ok": true, "look": look }).to_string())
    }

    fn set_variable(&self, name: &str, value_json: &str) -> Result<String, FdoError> {
        let hub = self.require_hub()?;
        let sources = hub
            .sources()
            .ok_or_else(|| FdoError::Failed("sources-unavailable".into()))?;
        let val: Json = serde_json::from_str(value_json)
            .map_err(|e| FdoError::InvalidArgs(format!("invalid-json: {e}")))?;
        sources
            .set_variable(name, val, &hub)
            .map_err(FdoError::InvalidArgs)?;
        hub.emit_dbus(DbusSignal::VariableChanged {
            name: name.to_owned(),
            value_json: value_json.to_owned(),
        });
        Ok(json!({ "ok": true, "name": name }).to_string())
    }

    fn run_widget_action(&self, widget_id: &str, action: &str) -> Result<String, FdoError> {
        let hub = self.require_hub()?;
        if widget_id.trim().is_empty() || action.trim().is_empty() {
            return Err(FdoError::InvalidArgs(
                "widget_id and action required".into(),
            ));
        }
        hub.emit_dbus(DbusSignal::WidgetAction {
            widget_id: widget_id.to_owned(),
            action: action.to_owned(),
        });
        Ok(json!({ "ok": true, "widgetId": widget_id, "action": action }).to_string())
    }

    fn peek_monitor(&self, connector: &str) -> Result<(), FdoError> {
        if connector.trim().is_empty() {
            self.forward(AppRequest::Peek);
        } else {
            self.forward(AppRequest::PeekMonitor(connector.trim().to_owned()));
        }
        Ok(())
    }

    fn export_backup(&self) -> Result<String, FdoError> {
        let hub = self.require_hub()?;
        crate::backup::export_json(&hub).map_err(FdoError::Failed)
    }

    async fn import_backup(&self, json_str: &str) -> Result<String, FdoError> {
        let hub = self.require_hub()?;
        crate::backup::import_json(&hub, json_str)
            .await
            .map_err(FdoError::InvalidArgs)?;
        Ok(json!({ "ok": true }).to_string())
    }

    fn automation_status(&self) -> Result<String, FdoError> {
        let hub = self.require_hub()?;
        let auto = hub
            .automation()
            .ok_or_else(|| FdoError::Failed("automation-unavailable".into()))?;
        serde_json::to_string(&auto.status()).map_err(|e| FdoError::Failed(e.to_string()))
    }

    fn resume_automation(&self) -> Result<String, FdoError> {
        let hub = self.require_hub()?;
        let auto = hub
            .automation()
            .ok_or_else(|| FdoError::Failed("automation-unavailable".into()))?;
        auto.resume(&hub);
        Ok(json!({ "ok": true, "manualOverride": false }).to_string())
    }

    // ── v2 signals ──────────────────────────────────────────────────────────────────────────

    #[zbus(signal)]
    async fn profile_changed(emitter: &SignalEmitter<'_>, profile_id: &str) -> zbus::Result<()>;

    #[zbus(signal)]
    async fn theme_changed(emitter: &SignalEmitter<'_>, theme_id: &str) -> zbus::Result<()>;

    #[zbus(signal)]
    async fn variable_changed(
        emitter: &SignalEmitter<'_>,
        name: &str,
        value_json: &str,
    ) -> zbus::Result<()>;

    #[zbus(signal)]
    async fn widget_action(
        emitter: &SignalEmitter<'_>,
        widget_id: &str,
        action: &str,
    ) -> zbus::Result<()>;
}

#[proxy(
    interface = "io.github.ali_kenjo.Opaline1",
    default_service = "io.github.ali_kenjo.Opaline",
    default_path = "/io/github/ali_kenjo/Opaline"
)]
pub trait Opaline {
    fn peek(&self) -> zbus::Result<()>;
    fn edit(&self) -> zbus::Result<()>;
    fn open_settings(&self) -> zbus::Result<()>;
    fn open_onboarding(&self) -> zbus::Result<()>;
    fn quit(&self) -> zbus::Result<()>;
    #[zbus(property)]
    fn api_version(&self) -> zbus::Result<u32>;
    fn get_status(&self) -> zbus::Result<String>;
    fn get_setting(&self, path: &str) -> zbus::Result<String>;
    fn set_setting(&self, path: &str, value_json: &str) -> zbus::Result<String>;
    fn list_widgets(&self) -> zbus::Result<String>;
    fn add_widget(
        &self,
        kind: &str,
        monitor: &str,
        x: i32,
        y: i32,
        w: i32,
        h: i32,
    ) -> zbus::Result<String>;
    fn remove_widget(&self, id: &str) -> zbus::Result<String>;
    fn move_widget(
        &self,
        id: &str,
        monitor: &str,
        x: i32,
        y: i32,
        w: i32,
        h: i32,
    ) -> zbus::Result<String>;
    fn toggle_widget(&self, id: &str) -> zbus::Result<String>;
    fn list_profiles(&self) -> zbus::Result<String>;
    fn set_profile(&self, id: &str) -> zbus::Result<String>;
    fn save_profile(&self, id: &str, name: &str) -> zbus::Result<String>;
    fn delete_profile(&self, id: &str) -> zbus::Result<String>;
    fn set_theme(&self, id: &str) -> zbus::Result<String>;
    fn set_look(&self, look: &str) -> zbus::Result<String>;
    fn set_variable(&self, name: &str, value_json: &str) -> zbus::Result<String>;
    fn run_widget_action(&self, widget_id: &str, action: &str) -> zbus::Result<String>;
    fn peek_monitor(&self, connector: &str) -> zbus::Result<()>;
    fn export_backup(&self) -> zbus::Result<String>;
    fn import_backup(&self, json_str: &str) -> zbus::Result<String>;
    fn automation_status(&self) -> zbus::Result<String>;
    fn resume_automation(&self) -> zbus::Result<String>;
}

/// Resolves a dotted or `/`-separated path into a JSON object.
pub fn json_path_get<'a>(root: &'a Json, path: &str) -> Option<&'a Json> {
    let trimmed = path.trim().trim_start_matches('/').trim_start_matches('.');
    if trimmed.is_empty() {
        return Some(root);
    }
    let mut cur = root;
    let sep = if trimmed.contains('/') { '/' } else { '.' };
    for seg in trimmed.split(sep).filter(|s| !s.is_empty()) {
        cur = match cur {
            Json::Object(map) => map.get(seg)?,
            Json::Array(arr) => arr.get(seg.parse::<usize>().ok()?)?,
            _ => return None,
        };
    }
    Some(cur)
}

/// Builds a nested JSON merge patch setting `path` to `value`.
pub fn json_path_patch(path: &str, value: Json) -> Result<Json, String> {
    let trimmed = path.trim().trim_start_matches('/').trim_start_matches('.');
    let sep = if trimmed.contains('/') { '/' } else { '.' };
    let segs: Vec<&str> = trimmed.split(sep).filter(|s| !s.is_empty()).collect();
    if segs.is_empty() || segs.len() > 8 {
        return Err("invalid-path".into());
    }
    if segs.iter().any(|s| s.len() > 64 || s.contains('\0')) {
        return Err("invalid-path-segment".into());
    }
    let mut cur = value;
    for seg in segs.into_iter().rev() {
        let mut obj = serde_json::Map::new();
        obj.insert(seg.to_owned(), cur);
        cur = Json::Object(obj);
    }
    Ok(cur)
}

fn resolve_monitor_key(
    hub: &Hub,
    layouts: &crate::layouts::Layouts,
    query: &str,
) -> Option<String> {
    let q = query.trim();
    let monitors = hub.monitors();
    if q.is_empty() {
        return monitors
            .iter()
            .find(|m| m.primary)
            .or_else(|| monitors.first())
            .map(|m| m.key.clone())
            .or_else(|| layouts.monitors.keys().next().cloned());
    }
    if layouts.monitors.contains_key(q) {
        return Some(q.to_owned());
    }
    monitors
        .iter()
        .find(|m| m.key == q || m.connector.eq_ignore_ascii_case(q))
        .map(|m| m.key.clone())
}

/// Outcome of trying to become the running core.
#[derive(Debug)]
pub enum Claim {
    /// We own the name. Keep the connection alive for as long as core runs.
    Primary {
        conn: Connection,
        hub_slot: Arc<OnceLock<Arc<Hub>>>,
    },
    /// Another core owns it.
    AlreadyRunning,
}

/// Serves the interface and asks for the bus name without queueing.
pub async fn claim(
    requests: mpsc::UnboundedSender<AppRequest>,
    backend: watch::Receiver<BackendKind>,
    layer: LayerLaunch,
) -> zbus::Result<Claim> {
    let hub_slot = Arc::new(OnceLock::new());
    let service = AppService {
        requests,
        backend,
        layer,
        hub: hub_slot.clone(),
    };
    let conn = connection::Builder::session()
        .serve_at(OBJECT_PATH, service)
        .build()
        .await?;
    // zbus 6 reports `Exists` as `Error::NameTaken` rather than as a reply.
    match conn
        .request_name_with_flags(BUS_NAME, RequestNameFlags::DO_NOT_QUEUE)
        .await
    {
        Ok(RequestNameReply::PrimaryOwner | RequestNameReply::AlreadyOwner) => {
            Ok(Claim::Primary { conn, hub_slot })
        }
        Ok(RequestNameReply::Exists | RequestNameReply::InQueue) | Err(zbus::Error::NameTaken) => {
            Ok(Claim::AlreadyRunning)
        }
        Err(error) => Err(error),
    }
}

/// Keeps the `BackendMode` D-Bus property in sync as core switches between Instant and Native.
pub async fn sync_backend(
    conn: Connection,
    mut hub_backend: watch::Receiver<BackendKind>,
    tx: watch::Sender<BackendKind>,
) {
    loop {
        let current = *hub_backend.borrow_and_update();
        if tx.send(current).is_err() {
            return;
        }
        if let Ok(iface) = conn
            .object_server()
            .interface::<_, AppService>(OBJECT_PATH)
            .await
        {
            let _ = iface
                .get()
                .await
                .backend_mode_changed(iface.signal_emitter())
                .await;
        }
        if hub_backend.changed().await.is_err() {
            return;
        }
    }
}

/// Forwards `Hub` D-Bus v2 signals onto `io.github.ali_kenjo.Opaline1`.
pub async fn forward_signals(conn: Connection, hub: Arc<Hub>) {
    let mut rx = hub.dbus_signals();
    loop {
        match rx.recv().await {
            Ok(sig) => {
                if let Ok(iface) = conn
                    .object_server()
                    .interface::<_, AppService>(OBJECT_PATH)
                    .await
                {
                    let emitter = iface.signal_emitter();
                    match sig {
                        DbusSignal::ProfileChanged { profile_id } => {
                            let _ = AppService::profile_changed(emitter, &profile_id).await;
                        }
                        DbusSignal::ThemeChanged { theme_id } => {
                            let _ = AppService::theme_changed(emitter, &theme_id).await;
                        }
                        DbusSignal::VariableChanged { name, value_json } => {
                            let _ = AppService::variable_changed(emitter, &name, &value_json).await;
                        }
                        DbusSignal::WidgetAction { widget_id, action } => {
                            let _ = AppService::widget_action(emitter, &widget_id, &action).await;
                        }
                    }
                }
            }
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
            Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
        }
    }
}

/// Sends `request` to the running core.
pub async fn forward(request: AppRequest) -> zbus::Result<()> {
    let conn = Connection::session().await?;
    let proxy = OpalineProxy::new(&conn).await?;
    match request {
        AppRequest::Peek => proxy.peek().await,
        AppRequest::PeekMonitor(c) => proxy.peek_monitor(&c).await,
        AppRequest::Edit => proxy.edit().await,
        AppRequest::OpenSettings => proxy.open_settings().await,
        AppRequest::OpenOnboarding => proxy.open_onboarding().await,
        AppRequest::Quit => proxy.quit().await,
        AppRequest::NextProfile | AppRequest::CycleLook => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    #[test]
    fn json_path_get_and_patch_round_trip() {
        let doc = json!({
            "theme": "opaline",
            "appearance": { "look": "glass", "glass": 45 }
        });
        assert_eq!(json_path_get(&doc, "theme"), Some(&json!("opaline")));
        assert_eq!(
            json_path_get(&doc, "appearance.look"),
            Some(&json!("glass"))
        );
        assert_eq!(json_path_get(&doc, "/appearance/glass"), Some(&json!(45)));
        assert_eq!(json_path_get(&doc, "appearance.missing"), None);

        let patch = json_path_patch("appearance.look", json!("clear")).unwrap();
        assert_eq!(patch, json!({ "appearance": { "look": "clear" } }));
        assert!(json_path_patch("", json!(1)).is_err());
    }
}

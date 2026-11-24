//! Core-owned Wayland-native windows: Settings (`settings.html`) and Onboarding
//! (`onboarding.html`), plus their least-privilege Tauri commands (brief §2.8, §2.9, §5.1).

use std::sync::Arc;

use opaline_core::app_service::AppRequest;
use opaline_core::desktop::DesktopStatus;
use opaline_core::diagnose::LiveDiagnostics;
use opaline_core::hub::Hub;
use opaline_core::shortcuts::ShortcutsState;
use opaline_core::updates::UpdateInfo;
use opaline_ipc::{MonitorInfo, Topic};
use serde::Serialize;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const SETTINGS_LABEL: &str = "settings";
pub const ONBOARDING_LABEL: &str = "onboarding";

/// Opens (or focuses if already open) the Settings window.
pub fn open_settings(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(SETTINGS_LABEL) {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }
    let res =
        WebviewWindowBuilder::new(app, SETTINGS_LABEL, WebviewUrl::App("settings.html".into()))
            .title("Opaline Settings")
            .inner_size(960.0, 680.0)
            .min_inner_size(760.0, 540.0)
            .resizable(true)
            .decorations(true)
            .build();
    if let Err(error) = res {
        tracing::error!(%error, "could not open Settings window");
    }
}

/// Opens (or focuses if already open) the first-run Onboarding window.
pub fn open_onboarding(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(ONBOARDING_LABEL) {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }
    let res = WebviewWindowBuilder::new(
        app,
        ONBOARDING_LABEL,
        WebviewUrl::App("onboarding.html".into()),
    )
    .title("Welcome to Opaline")
    .inner_size(840.0, 660.0)
    .min_inner_size(720.0, 560.0)
    .resizable(true)
    .decorations(true)
    .build();
    if let Err(error) = res {
        tracing::error!(%error, "could not open Onboarding window");
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellState {
    pub version: &'static str,
    pub settings: serde_json::Value,
    pub layouts: serde_json::Value,
    pub monitors: Vec<MonitorInfo>,
    pub appearance: serde_json::Value,
    pub wallpapers: serde_json::Value,
    pub autostart: bool,
    pub paused: bool,
    pub desktop: DesktopStatus,
    pub shortcuts: ShortcutsState,
    pub latest_update: Option<UpdateInfo>,
}

fn topic_json(hub: &Hub, name: &str) -> serde_json::Value {
    hub.latest(&Topic::new(name))
        .map(|v| opaline_core::json::to_json(&v))
        .unwrap_or(serde_json::Value::Null)
}

#[tauri::command]
pub async fn shell_get_state(hub: State<'_, Arc<Hub>>) -> Result<ShellState, String> {
    let settings = serde_json::to_value(&*hub.settings()).map_err(|e| e.to_string())?;
    let layouts = serde_json::to_value(&*hub.layouts()).map_err(|e| e.to_string())?;
    let desktop = opaline_core::desktop::status(&hub).await;
    let shortcuts = opaline_core::shortcuts::read_state(desktop.backend).await;
    Ok(ShellState {
        version: env!("CARGO_PKG_VERSION"),
        settings,
        layouts,
        monitors: hub.monitors(),
        appearance: topic_json(&hub, "appearance.settings"),
        wallpapers: topic_json(&hub, "wallpaper.monitors"),
        autostart: opaline_core::autostart::is_enabled(),
        paused: hub.paused(),
        desktop,
        shortcuts,
        latest_update: hub.latest_update(),
    })
}

#[tauri::command]
pub async fn shell_update_settings(
    patch: serde_json::Value,
    hub: State<'_, Arc<Hub>>,
) -> Result<(), String> {
    opaline_core::store::update(&hub, patch).await
}

#[tauri::command]
pub async fn shell_reset_settings(hub: State<'_, Arc<Hub>>) -> Result<(), String> {
    let fresh = opaline_core::store::Settings {
        onboarding_done: true,
        ..Default::default()
    };
    let raw = serde_json::to_value(&fresh).map_err(|e| e.to_string())?;
    opaline_core::store::replace(&hub, raw).await
}

#[tauri::command]
pub async fn shell_update_layouts(
    layouts: serde_json::Value,
    hub: State<'_, Arc<Hub>>,
) -> Result<(), String> {
    opaline_core::layouts::update(&hub, layouts).await
}

#[tauri::command]
pub async fn shell_set_autostart(enabled: bool) -> Result<(), String> {
    tokio::task::spawn_blocking(move || opaline_core::autostart::set_enabled(enabled))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn shell_set_helper_enabled(enabled: bool) -> Result<(), String> {
    opaline_core::desktop::set_helper_enabled(enabled).await
}

#[tauri::command]
pub async fn shell_set_shortcuts(peek: String, edit: String) -> Result<(), String> {
    opaline_core::shortcuts::set_native_shortcuts(&peek, &edit).await
}

#[tauri::command]
pub fn shell_export_backup(hub: State<'_, Arc<Hub>>) -> Result<String, String> {
    opaline_core::backup::export_json(&hub)
}

#[tauri::command]
pub async fn shell_import_backup(json: String, hub: State<'_, Arc<Hub>>) -> Result<(), String> {
    opaline_core::backup::import_json(&hub, &json).await
}

#[tauri::command]
pub async fn shell_diagnostics(hub: State<'_, Arc<Hub>>) -> Result<LiveDiagnostics, String> {
    Ok(opaline_core::diagnose::live_snapshot(&hub).await)
}

#[tauri::command]
pub async fn shell_check_updates(hub: State<'_, Arc<Hub>>) -> Result<UpdateInfo, String> {
    let info = opaline_core::updates::check_latest().await?;
    hub.set_latest_update(Some(info.clone()));
    Ok(info)
}

#[tauri::command]
pub async fn shell_install_update(hub: State<'_, Arc<Hub>>) -> Result<String, String> {
    let info = hub
        .latest_update()
        .ok_or_else(|| "no-update-checked".to_owned())?;
    if !info.update_available {
        return Err("already-up-to-date".into());
    }
    let path = opaline_core::updates::download_and_install(&info).await?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub async fn shell_trigger_action(action: String, hub: State<'_, Arc<Hub>>) -> Result<(), String> {
    match action.as_str() {
        "peek" => hub.request(AppRequest::Peek),
        "edit" => hub.request(AppRequest::Edit),
        "pause" => hub.set_paused(true),
        "resume" => hub.set_paused(false),
        "open-settings" => hub.request(AppRequest::OpenSettings),
        "open-onboarding" => hub.request(AppRequest::OpenOnboarding),
        "quit" => hub.request(AppRequest::Quit),
        "test-alert" => opaline_core::alerts::send_test_notification().await?,
        other => return Err(format!("unknown-action: {other}")),
    }
    Ok(())
}

#[tauri::command]
pub async fn shell_geocode(query: String, language: String) -> Result<serde_json::Value, String> {
    let value = opaline_core::providers::weather::geocode(&query, &language).await?;
    Ok(opaline_core::json::to_json(&value))
}

#[tauri::command]
pub async fn shell_list_fonts() -> Result<Vec<String>, String> {
    let value = opaline_core::fonts::list().await?;
    let json = opaline_core::json::to_json(&value);
    Ok(json
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default())
}

#[tauri::command]
pub fn shell_wallpaper_asset(url: String) -> Result<tauri::ipc::Response, String> {
    crate::layer::assets::read_url(&url)
        .map(tauri::ipc::Response::new)
        .ok_or_else(|| "not-found".to_owned())
}

#[tauri::command]
pub fn shell_close(window: WebviewWindow) {
    let _ = window.close();
}

//! `opaline` (core): no window, tray, D-Bus service, IPC server, samplers, and the layer
//! supervisor (Instant mode in Phase 0).

use std::process::ExitCode;
use std::sync::Arc;

use opaline_core::app_service::{self, AppRequest, Claim};
use opaline_core::engine::Sampler;
use opaline_core::hub::Hub;
use opaline_core::{displays, ipc_server, providers};
use opaline_ipc::{BackendKind, CoreEvent};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, RunEvent};
use tokio::sync::{mpsc, watch};

use crate::instant;

pub fn run(request: Option<AppRequest>, safe_mode_flag: bool) -> ExitCode {
    let Some(rt) = crate::runtime::install() else {
        return ExitCode::FAILURE;
    };

    let (requests_tx, requests_rx) = mpsc::unbounded_channel();
    let (backend_prop_tx, backend_prop_rx) = watch::channel(BackendKind::Instant);
    let started = rt.block_on(async {
        match app_service::claim(
            requests_tx.clone(),
            backend_prop_rx,
            instant::layer_launch(),
        )
        .await
        {
            Ok(Claim::Primary(conn)) => Ok(Some(conn)),
            Ok(Claim::AlreadyRunning) => {
                // A second launch (app grid, desktop action, CLI) talks to the running core.
                let request = request.unwrap_or(AppRequest::Edit);
                match app_service::forward(request).await {
                    Ok(()) => Ok(None),
                    Err(error) => Err(format!("Opaline is running but didn't answer: {error}")),
                }
            }
            Err(error) => Err(format!("could not reach the session bus: {error}")),
        }
    });
    let bus = match started {
        Ok(Some(bus)) => bus,
        Ok(None) => return ExitCode::SUCCESS,
        Err(message) => {
            tracing::error!("{message}");
            eprintln!("opaline: {message}");
            return ExitCode::FAILURE;
        }
    };
    if request == Some(AppRequest::Quit) {
        // `--quit` with nothing running: nothing to do.
        return ExitCode::SUCCESS;
    }

    let monitors = rt
        .block_on(displays::current_monitors(&bus))
        .unwrap_or_else(|error| {
            tracing::warn!(%error, "could not read monitors; waiting for the first change");
            Vec::new()
        });
    tracing::info!(count = monitors.len(), "monitors");
    // Start in the right mode at once, so no Instant layer flashes up before the helper's.
    let backend = rt.block_on(opaline_core::desktop::initial_backend(&bus));
    tracing::info!(?backend, "desktop integration");
    let hub = Hub::new(backend, monitors);
    if backend == BackendKind::Native {
        let areas = rt.block_on(opaline_core::desktop::read_work_areas(&bus));
        hub.set_work_areas(areas);
    }
    rt.spawn(app_service::sync_backend(
        bus.clone(),
        hub.watch_backend(),
        backend_prop_tx,
    ));
    let (settings, writable) = opaline_core::store::load();
    let needs_onboarding = !settings.onboarding_done;
    let safe_mode = safe_mode_flag || bump_crash_counter() >= 2;
    if safe_mode {
        tracing::warn!(
            explicit = safe_mode_flag,
            "starting in safe mode (user CSS, theme CSS, custom sources and plugins disabled)"
        );
    }
    hub.set_safe_mode(safe_mode);
    hub.init_settings(settings, writable);
    let (layouts, layouts_writable) = opaline_core::layouts::load();
    hub.init_layouts(layouts, layouts_writable);
    hub.set_request_sender(requests_tx.clone());
    rt.spawn(opaline_core::watcher::run(hub.clone()));

    let listener = match rt.block_on(ipc_server::bind_default()) {
        Ok(listener) => listener,
        Err(error) => {
            tracing::error!(%error, "IPC socket unavailable");
            return ExitCode::FAILURE;
        }
    };
    rt.spawn(ipc_server::serve(hub.clone(), listener));
    rt.spawn(Sampler::new(hub.clone(), providers::polled()).run());
    rt.spawn(providers::run_async(hub.clone()));
    {
        let hub = hub.clone();
        rt.spawn(async move {
            if let Err(error) = opaline_core::history::run(hub.clone(), hub.history()).await {
                tracing::error!(%error, "history stopped");
            }
        });
    }
    rt.spawn(opaline_core::engine::supervise(hub.clone(), "alerts", {
        let hub = hub.clone();
        move || opaline_core::alerts::run(hub.clone())
    }));
    {
        let hub = hub.clone();
        let bus = bus.clone();
        rt.spawn(async move {
            let result = displays::watch_monitors(&bus, |monitors| {
                tracing::info!(count = monitors.len(), "monitors changed");
                hub.set_monitors(monitors);
            })
            .await;
            if let Err(error) = result {
                tracing::warn!(%error, "stopped watching monitors");
            }
        });
    }

    {
        let bus = bus.clone();
        rt.spawn(async move { opaline_core::desktop::ensure_enabled(&bus).await });
    }
    rt.spawn(opaline_core::desktop::run(
        bus.clone(),
        hub.clone(),
        requests_tx.clone(),
    ));
    rt.spawn(opaline_core::shortcuts::run(
        hub.clone(),
        requests_tx.clone(),
    ));
    rt.spawn(opaline_core::updates::run_daily_check(hub.clone()));

    let (stop_tx, stop_rx) = watch::channel(false);
    let (layer_done_tx, layer_done_rx) = std::sync::mpsc::channel::<()>();
    let backend_rx = hub_backend(&hub);
    rt.spawn(async move {
        instant::control_layer(backend_rx, stop_rx).await;
        let _ = layer_done_tx.send(());
    });

    let initial_request = request.or(if needs_onboarding {
        Some(AppRequest::OpenOnboarding)
    } else {
        None
    });

    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            crate::shell::shell_get_state,
            crate::shell::shell_update_settings,
            crate::shell::shell_reset_settings,
            crate::shell::shell_update_layouts,
            crate::shell::shell_set_autostart,
            crate::shell::shell_set_helper_enabled,
            crate::shell::shell_set_shortcuts,
            crate::shell::shell_export_backup,
            crate::shell::shell_import_backup,
            crate::shell::shell_diagnostics,
            crate::shell::shell_check_updates,
            crate::shell::shell_install_update,
            crate::shell::shell_trigger_action,
            crate::shell::shell_geocode,
            crate::shell::shell_list_fonts,
            crate::shell::shell_wallpaper_asset,
            crate::shell::shell_close,
        ])
        .setup({
            let hub = hub.clone();
            move |app| {
                build_tray(app.handle())?;
                app.manage(hub.clone());
                if let Some(req) = initial_request {
                    handle_request(app.handle(), &hub, req);
                }
                tauri::async_runtime::spawn(handle_requests(
                    app.handle().clone(),
                    hub,
                    requests_rx,
                ));
                Ok(())
            }
        })
        .build(tauri::generate_context!());
    let app = match app {
        Ok(app) => app,
        Err(error) => {
            tracing::error!(%error, "could not start the core app");
            return ExitCode::FAILURE;
        }
    };

    app.run(move |_app, event| match event {
        // Core has no windows by default; closing Settings must not quit it.
        RunEvent::ExitRequested {
            api, code: None, ..
        } => api.prevent_exit(),
        RunEvent::Exit => {
            clear_crash_counter();
            // Tauri ends the process right after this event, so wait here until the supervisor
            // has stopped the layer; otherwise the layer can outlive core.
            let _ = stop_tx.send(true);
            if layer_done_rx.recv_timeout(LAYER_STOP_TIMEOUT).is_err() {
                tracing::warn!("the layer did not stop in time");
            }
        }
        _ => {}
    });
    drop(bus);
    ExitCode::SUCCESS
}

/// Counts consecutive unclean starts; cleared on clean exit so two crashes in a row automatically
/// activate safe mode (PLAN-2 §2).
fn crash_marker_path() -> Option<std::path::PathBuf> {
    opaline_core::paths::state_dir()
        .ok()
        .map(|d| d.join("startup-crashes"))
}

fn bump_crash_counter() -> u32 {
    let Some(path) = crash_marker_path() else {
        return 0;
    };
    let prev = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| s.trim().parse::<u32>().ok())
        .unwrap_or(0);
    let next = prev.saturating_add(1);
    let _ = opaline_core::paths::write_atomic(&path, next.to_string().as_bytes());
    prev
}

fn clear_crash_counter() {
    if let Some(path) = crash_marker_path() {
        let _ = std::fs::remove_file(path);
    }
}

fn hub_backend(hub: &Arc<Hub>) -> watch::Receiver<BackendKind> {
    hub.watch_backend()
}

const PAUSE_ID: &str = "pause";
/// How long quitting waits for the layer process to be stopped.
const LAYER_STOP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let peek = MenuItem::with_id(app, "peek", "Peek", true, None::<&str>)?;
    let edit = MenuItem::with_id(app, "edit", "Edit widgets", true, None::<&str>)?;
    let pause = CheckMenuItem::with_id(app, PAUSE_ID, "Pause updates", true, false, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Opaline", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&peek, &edit, &pause, &settings, &separator, &quit])?;

    let mut tray = TrayIconBuilder::with_id("opaline")
        .tooltip("Opaline")
        .menu(&menu)
        .on_menu_event(move |app, event| {
            let hub = app.state::<Arc<Hub>>();
            match event.id().as_ref() {
                "peek" => handle_request(app, &hub, AppRequest::Peek),
                "edit" => handle_request(app, &hub, AppRequest::Edit),
                "settings" => handle_request(app, &hub, AppRequest::OpenSettings),
                "quit" => handle_request(app, &hub, AppRequest::Quit),
                PAUSE_ID => {
                    let paused = pause.is_checked().unwrap_or(false);
                    hub.set_paused(paused);
                }
                _ => {}
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

async fn handle_requests(
    app: AppHandle,
    hub: Arc<Hub>,
    mut requests: mpsc::UnboundedReceiver<AppRequest>,
) {
    while let Some(request) = requests.recv().await {
        handle_request(&app, &hub, request);
    }
}

fn handle_request(app: &AppHandle, hub: &Hub, request: AppRequest) {
    tracing::info!(?request, "request");
    match request {
        AppRequest::Peek => hub.emit(CoreEvent::PeekRequested),
        AppRequest::Edit => hub.emit(CoreEvent::EditRequested),
        AppRequest::OpenSettings => crate::shell::open_settings(app),
        AppRequest::OpenOnboarding => crate::shell::open_onboarding(app),
        AppRequest::Quit => app.exit(0),
    }
}

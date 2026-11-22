//! `opaline` (core): no window, tray, D-Bus service, IPC server, samplers, and the layer
//! supervisor (Instant mode in Phase 0).

use std::process::ExitCode;
use std::sync::Arc;

use opaline_core::app_service::{self, AppRequest, Claim};
use opaline_core::hub::Hub;
use opaline_core::{displays, ipc_server, loadavg};
use opaline_ipc::{BackendKind, CoreEvent};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, RunEvent};
use tokio::sync::{mpsc, watch};

use crate::instant;

pub fn run(request: Option<AppRequest>) -> ExitCode {
    let Some(rt) = crate::runtime::install() else {
        return ExitCode::FAILURE;
    };

    let (requests_tx, requests_rx) = mpsc::unbounded_channel();
    let started = rt.block_on(async {
        match app_service::claim(requests_tx.clone(), "instant").await {
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
    let hub = Hub::new(BackendKind::Instant, monitors);

    let listener = match rt.block_on(ipc_server::bind_default()) {
        Ok(listener) => listener,
        Err(error) => {
            tracing::error!(%error, "IPC socket unavailable");
            return ExitCode::FAILURE;
        }
    };
    rt.spawn(ipc_server::serve(hub.clone(), listener));
    rt.spawn(loadavg::run(hub.clone()));
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

    let (stop_tx, stop_rx) = watch::channel(false);
    rt.spawn(instant::supervise_layer(stop_rx));

    let app = tauri::Builder::default()
        .setup({
            let hub = hub.clone();
            move |app| {
                build_tray(app.handle())?;
                app.manage(hub.clone());
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
            let _ = stop_tx.send(true);
        }
        _ => {}
    });
    drop(bus);
    ExitCode::SUCCESS
}

const PAUSE_ID: &str = "pause";

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
                    hub.emit(CoreEvent::UpdatesPaused { paused });
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
        // The Settings window is built in Phase 6 (docs/PLAN.md 6.2).
        AppRequest::OpenSettings => tracing::info!("Settings window arrives in Phase 6"),
        AppRequest::Quit => app.exit(0),
    }
}

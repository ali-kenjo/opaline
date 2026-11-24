//! `opaline --layer`: one transparent webview window per monitor, fed by core over IPC.

pub(crate) mod assets;
mod bridge;
mod client;
mod windows;

use std::process::ExitCode;
use std::sync::Arc;

use tauri::{Manager, RunEvent};
use tokio::sync::mpsc;

use crate::Backend;
use bridge::Bridge;

pub fn run(backend: Backend) -> ExitCode {
    let Some(_rt) = crate::runtime::install() else {
        return ExitCode::FAILURE;
    };
    tracing::info!(?backend, gdk_backend = ?std::env::var("GDK_BACKEND").ok(), "layer starting");

    let (outgoing_tx, outgoing_rx) = mpsc::unbounded_channel();
    let bridge = Arc::new(Bridge::new(outgoing_tx));

    let app = tauri::Builder::default()
        .register_uri_scheme_protocol("opaline-asset", |_ctx, request| assets::handle(&request))
        .manage(bridge.clone())
        .manage(windows::Pins::default())
        .manage(match backend {
            Backend::Native => opaline_ipc::BackendKind::Native,
            Backend::Instant => opaline_ipc::BackendKind::Instant,
        })
        .invoke_handler(tauri::generate_handler![
            bridge::layer_attach,
            bridge::layer_subscribe,
            bridge::layer_command,
            bridge::layer_set_raised,
            bridge::layer_set_peek,
            bridge::layer_set_edit,
            assets::layer_asset,
            bridge::layer_set_input_region,
            bridge::layer_report,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            let bridge = app.state::<Arc<Bridge>>().inner().clone();
            if backend == Backend::Instant {
                windows::watch_work_areas(&handle);
            }
            tauri::async_runtime::spawn(client::run(handle, bridge, outgoing_rx));
            Ok(())
        })
        .build(tauri::generate_context!());
    let app = match app {
        Ok(app) => app,
        Err(error) => {
            tracing::error!(%error, "could not start the layer app");
            return ExitCode::FAILURE;
        }
    };
    app.run(|_app, event| {
        // Windows come and go with monitors; the layer lives until core or the helper stops it.
        if let RunEvent::ExitRequested {
            api, code: None, ..
        } = event
        {
            api.prevent_exit();
        }
    });
    ExitCode::SUCCESS
}

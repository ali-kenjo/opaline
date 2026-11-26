//! Spike S5 (PLAN-2 §4, ADR 0014), debug builds only: the `opaline-plugin://spike/` scheme that
//! serves the Lab's hostile probe files with their own Content-Security-Policy header. (A
//! dead-proxy network block was tried too and didn't stop worker requests; see the ADR.)

use std::borrow::Cow;

use tauri::http::{Request, Response, StatusCode, header};
use tauri::{AppHandle, Runtime};

/// The policy every plugin-host response carries: scripts and workers from its own origin only,
/// no network, and only the layer may frame it.
pub const PLUGIN_CSP: &str = "default-src 'none'; script-src 'self'; worker-src 'self' blob:; \
                              connect-src 'self'; frame-ancestors tauri://localhost";

fn respond(status: StatusCode, content_type: &str, body: Vec<u8>) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header("Content-Security-Policy", PLUGIN_CSP)
        .body(Cow::<'static, [u8]>::Owned(body))
        .unwrap_or_else(|_| Response::new(Cow::<'static, [u8]>::Borrowed(&[])))
}

/// `opaline-plugin://spike/<file>` → the embedded Lab asset `plugin-spike/<file>`.
pub fn plugin_scheme<R: Runtime>(
    app: &AppHandle<R>,
    request: &Request<Vec<u8>>,
) -> Response<Cow<'static, [u8]>> {
    let uri = request.uri();
    let name = uri.path().trim_start_matches('/');
    let plain = !name.is_empty()
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
    let content_type = match name.rsplit_once('.').map(|(_, ext)| ext) {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        _ => "",
    };
    if uri.host() != Some("spike") || !plain || content_type.is_empty() {
        return respond(StatusCode::NOT_FOUND, "text/plain", Vec::new());
    }
    match app.asset_resolver().get(format!("plugin-spike/{name}")) {
        Some(asset) => respond(StatusCode::OK, content_type, asset.bytes),
        None => respond(StatusCode::NOT_FOUND, "text/plain", Vec::new()),
    }
}

/// Spike S3: logs the button presses and focus changes the GTK widgets themselves receive, to see
/// where a click on the layer ends up.
pub fn log_input(webview: &webkit2gtk::WebView) {
    use gtk::prelude::*;
    webview.connect_button_press_event(|_, e| {
        let (x, y) = e.position();
        tracing::info!(x, y, "spike focus: webview button press");
        gtk::glib::Propagation::Proceed
    });
    webview.connect_focus_in_event(|_, _| {
        tracing::info!("spike focus: webview focus in");
        gtk::glib::Propagation::Proceed
    });
    if let Some(toplevel) = webview.toplevel() {
        toplevel.connect_button_press_event(|w, e| {
            let (x, y) = e.position();
            tracing::info!(
                x,
                y,
                width = w.allocated_width(),
                height = w.allocated_height(),
                "spike focus: window button press"
            );
            gtk::glib::Propagation::Proceed
        });
        toplevel.connect_focus_in_event(|_, _| {
            tracing::info!("spike focus: window focus in");
            gtk::glib::Propagation::Proceed
        });
        toplevel.connect_focus_out_event(|_, _| {
            tracing::info!("spike focus: window focus out");
            gtk::glib::Propagation::Proceed
        });
    }
}

//! Production `opaline-plugin://<plugin-id>/` URI scheme (ADR 0014, PLAN-2 9.1).
//!
//! Every response carries the strict ADR 0014 Content-Security-Policy so plugin workers have zero
//! network, zero `eval`/`new Function`, zero Tauri IPC, and their own per-plugin origin.
//! Only Opaline's `host.html` / `host.js` and files belonging to an APPROVED plugin are served.

use std::borrow::Cow;

use tauri::http::{Request, Response, StatusCode, header};
use tauri::{AppHandle, Runtime};

/// The policy every plugin-host response carries (ADR 0014): scripts and workers from its own
/// origin only, no network, no `eval`, and only the layer may frame it.
pub const PLUGIN_CSP: &str = "default-src 'none'; script-src 'self'; worker-src 'self' blob:; \
                              connect-src 'self'; frame-ancestors tauri://localhost";

const HOST_HTML: &str = r#"<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Opaline Plugin Host</title></head>
<body><script src="/host.js"></script></body>
</html>"#;

/// Opaline-owned host page relay script (ADR 0014): spawns the plugin's dedicated Web Worker,
/// forwards ONLY structured messages between the layer parent and worker, and terminates the
/// worker on watchdog request. Never runs plugin code on the host page thread.
const HOST_JS: &str = r#"(function () {
  "use strict";
  let worker = null;
  let parentOrigin = "*";

  function sendParent(msg) {
    window.parent.postMessage(msg, parentOrigin);
  }

  function stopWorker() {
    if (worker) {
      try { worker.terminate(); } catch {}
      worker = null;
    }
  }

  function startWorker() {
    stopWorker();
    worker = new Worker("/entry.js");
    worker.onmessage = function (ev) {
      sendParent({ kind: "plugin-msg", payload: ev.data });
    };
    worker.onerror = function (err) {
      sendParent({ kind: "plugin-error", message: String(err.message || "worker-error") });
    };
    sendParent({ kind: "host-ready" });
  }

  window.addEventListener("message", function (ev) {
    if (ev.source !== window.parent) return;
    if (ev.origin !== "tauri://localhost" && !ev.origin.startsWith("http://localhost:")) return;
    parentOrigin = ev.origin;
    const data = ev.data;
    if (!data || typeof data !== "object") return;
    if (data.kind === "start") {
      startWorker();
    } else if (data.kind === "terminate") {
      stopWorker();
      sendParent({ kind: "terminated" });
    } else if (data.kind === "to-worker" && worker) {
      worker.postMessage(data.payload);
    }
  });
})();"#;

fn respond(status: StatusCode, content_type: &str, body: Vec<u8>) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header("Content-Security-Policy", PLUGIN_CSP)
        .header("X-Content-Type-Options", "nosniff")
        .body(Cow::<'static, [u8]>::Owned(body))
        .unwrap_or_else(|_| Response::new(Cow::<'static, [u8]>::Borrowed(&[])))
}

/// Handles `opaline-plugin://<plugin-id>/<file>`.
pub fn handle<R: Runtime>(
    app: &AppHandle<R>,
    request: &Request<Vec<u8>>,
) -> Response<Cow<'static, [u8]>> {
    let uri = request.uri();
    let Some(host) = uri.host() else {
        return respond(StatusCode::NOT_FOUND, "text/plain", Vec::new());
    };

    // Keep Spike S5 probe scheme reachable in debug builds for WebKitGTK regression checks.
    #[cfg(debug_assertions)]
    if host == "spike" {
        return super::spike::plugin_scheme(app, request);
    }
    #[cfg(not(debug_assertions))]
    let _ = app;

    let path = uri.path().trim_start_matches('/');
    serve_plugin_request(host, path, None)
}

/// Pure testable handler core (allows unit tests to point at a temporary plugins manager).
pub fn serve_plugin_request(
    plugin_id: &str,
    rel_path: &str,
    override_mgr: Option<&opaline_core::plugins::PluginsManager>,
) -> Response<Cow<'static, [u8]>> {
    if opaline_core::plugins::validate_id(plugin_id).is_err() {
        return respond(StatusCode::NOT_FOUND, "text/plain", Vec::new());
    }
    match rel_path {
        "host.html" => {
            return respond(StatusCode::OK, "text/html; charset=utf-8", HOST_HTML.into());
        }
        "host.js" => {
            return respond(
                StatusCode::OK,
                "text/javascript; charset=utf-8",
                HOST_JS.into(),
            );
        }
        _ => {}
    }

    let owned_mgr;
    let mgr = match override_mgr {
        Some(m) => m,
        None => {
            let (Ok(data_dir), Ok(cfg_dir)) = (
                opaline_core::paths::data_dir(),
                opaline_core::paths::config_dir(),
            ) else {
                return respond(StatusCode::NOT_FOUND, "text/plain", Vec::new());
            };
            owned_mgr = opaline_core::plugins::PluginsManager::new(data_dir, cfg_dir);
            &owned_mgr
        }
    };

    // Resolve `/entry.js` to the manifest's declared entry file for approved plugins only.
    let target_file = if rel_path == "entry.js" {
        let Some(status) = mgr.list(false).into_iter().find(|p| p.id == plugin_id) else {
            return respond(StatusCode::FORBIDDEN, "text/plain", Vec::new());
        };
        status.entry
    } else if rel_path.ends_with(".js") {
        rel_path.to_owned()
    } else {
        return respond(StatusCode::NOT_FOUND, "text/plain", Vec::new());
    };

    match mgr.read_approved_file(plugin_id, &target_file, false) {
        Some(bytes) => respond(StatusCode::OK, "text/javascript; charset=utf-8", bytes),
        None => respond(StatusCode::FORBIDDEN, "text/plain", Vec::new()),
    }
}

/// Defense-in-depth main-frame navigation guard for layer windows (ADR 0014 item 6).
/// Only allows loading Opaline's own layer origin or `about:blank`.
pub fn is_allowed_layer_navigation(url: &str) -> bool {
    url == "about:blank"
        || url.starts_with("tauri://localhost/")
        || url.starts_with("http://localhost:")
        || url.starts_with("http://127.0.0.1:")
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;
    use opaline_core::hub::Hub;
    use opaline_core::plugins::PluginsManager;
    use opaline_ipc::BackendKind;

    #[test]
    fn serves_host_with_adr0014_csp_and_blocks_unapproved_plugins() {
        let base =
            std::env::temp_dir().join(format!("opaline-plugin-scheme-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let mgr = PluginsManager::new(base.join("data"), base.join("cfg"));
        let hub = Hub::new(BackendKind::Instant, Vec::new());

        let src = base.join("pkg");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(
            src.join("plugin.json"),
            r#"{"version":1,"id":"hello-plg","name":"Hello","pluginVersion":"1.0.0","author":"A","license":"MIT","kind":"code-widget","entry":"worker.js","permissions":{"topics":["cpu.load"],"sources":[],"actions":[]}}"#,
        )
        .unwrap();
        std::fs::write(src.join("worker.js"), "self.onmessage = () => {};").unwrap();
        let archive = base.join("hello.opaline-plugin");
        opaline_core::plugins::pack_dir(&src, Some(&archive)).unwrap();
        mgr.install_zip(&hub, &std::fs::read(&archive).unwrap())
            .unwrap();

        // Host HTML has strict CSP.
        let host = serve_plugin_request("hello-plg", "host.html", Some(&mgr));
        assert_eq!(host.status(), StatusCode::OK);
        assert_eq!(
            host.headers()
                .get("Content-Security-Policy")
                .and_then(|v| v.to_str().ok()),
            Some(PLUGIN_CSP)
        );

        // Unapproved plugin entry is refused with 403.
        let unapproved = serve_plugin_request("hello-plg", "entry.js", Some(&mgr));
        assert_eq!(unapproved.status(), StatusCode::FORBIDDEN);

        // Approved plugin entry is served with CSP.
        mgr.approve(&hub, "hello-plg").unwrap();
        let approved = serve_plugin_request("hello-plg", "entry.js", Some(&mgr));
        assert_eq!(approved.status(), StatusCode::OK);

        // Path traversal refused.
        let traversal = serve_plugin_request("hello-plg", "../etc/passwd", Some(&mgr));
        assert_eq!(traversal.status(), StatusCode::NOT_FOUND);

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn navigation_guard_allows_only_layer_origins() {
        assert!(is_allowed_layer_navigation("tauri://localhost/layer.html"));
        assert!(is_allowed_layer_navigation(
            "http://localhost:5173/layer.html"
        ));
        assert!(is_allowed_layer_navigation("about:blank"));
        assert!(!is_allowed_layer_navigation("https://evil.example/"));
        assert!(!is_allowed_layer_navigation(
            "opaline-plugin://demo/host.html"
        ));
        assert!(!is_allowed_layer_navigation("file:///etc/passwd"));
    }
}

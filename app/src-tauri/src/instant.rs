//! Instant backend: core spawns and supervises the layer process through Xwayland, but only
//! while Native mode (the shell helper starts the layer itself) isn't active.

use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, Instant};

use opaline_ipc::BackendKind;
use tokio::process::Command;
use tokio::sync::watch;

const MIN_BACKOFF: Duration = Duration::from_millis(500);
const MAX_BACKOFF: Duration = Duration::from_secs(30);
/// A layer that ran this long is considered healthy; the backoff starts over.
const HEALTHY_RUN: Duration = Duration::from_secs(60);

/// Runs the Instant layer whenever the backend is Instant, and stops it when Native takes
/// over (the helper then starts its own layer), until `stop` turns true.
pub async fn control_layer(mut backend: watch::Receiver<BackendKind>, stop: watch::Receiver<bool>) {
    loop {
        if *stop.borrow() {
            return;
        }
        let current = *backend.borrow_and_update();
        if current == BackendKind::Instant {
            let (layer_stop_tx, layer_stop_rx) = watch::channel(false);
            let mut stop_for_select = stop.clone();
            let supervise = supervise_layer(layer_stop_rx);
            tokio::pin!(supervise);
            tokio::select! {
                () = &mut supervise => return,
                changed = backend.changed() => {
                    let _ = layer_stop_tx.send(true);
                    supervise.await;
                    if changed.is_err() {
                        return;
                    }
                    tracing::info!("leaving Instant mode; the shell helper starts the layer");
                }
                () = stopped(&mut stop_for_select) => {
                    let _ = layer_stop_tx.send(true);
                    supervise.await;
                    return;
                }
            }
        } else {
            let mut stop_for_select = stop.clone();
            tokio::select! {
                changed = backend.changed() => {
                    if changed.is_err() {
                        return;
                    }
                    tracing::info!("back to Instant mode");
                }
                () = stopped(&mut stop_for_select) => return,
            }
        }
    }
}

/// What the shell helper needs to start the layer the same way (Native mode).
pub fn layer_launch() -> opaline_core::app_service::LayerLaunch {
    let mut environment = std::collections::HashMap::new();
    if let Some(file) = mesa_egl_vendor_file() {
        environment.insert(EGL_VENDOR_ENV.to_owned(), file.to_owned());
    }
    for key in ["OPALINE_LOG", "RUST_BACKTRACE"] {
        if let Ok(v) = std::env::var(key) {
            environment.insert(key.to_owned(), v);
        }
    }
    #[cfg(debug_assertions)]
    if let Ok(v) = std::env::var("OPALINE_LAYER_PAGE") {
        environment.insert("OPALINE_LAYER_PAGE".to_owned(), v);
    }
    opaline_core::app_service::LayerLaunch {
        executable: std::env::current_exe()
            .map(|p| p.display().to_string())
            .unwrap_or_default(),
        environment,
    }
}

/// Keeps one `opaline --layer --backend instant` alive until `stop` turns true.
pub async fn supervise_layer(mut stop: watch::Receiver<bool>) {
    let exe = match std::env::current_exe() {
        Ok(exe) => exe,
        Err(error) => {
            tracing::error!(%error, "cannot find our own executable; the layer won't start");
            return;
        }
    };
    let mut backoff = MIN_BACKOFF;
    loop {
        if *stop.borrow() {
            return;
        }
        let started = Instant::now();
        let mut command = Command::new(&exe);
        command
            .args(["--layer", "--backend", "instant"])
            // Instant mode needs X11 window hints (keep-below, skip-taskbar, sticky) that GNOME
            // only honours for Xwayland clients.
            .env("GDK_BACKEND", "x11")
            .stdin(Stdio::null())
            .kill_on_drop(true);
        if let Some(vendor_file) = mesa_egl_vendor_file() {
            command.env(EGL_VENDOR_ENV, vendor_file);
        }
        let child = command.spawn();
        let mut child = match child {
            Ok(child) => child,
            Err(error) => {
                tracing::error!(%error, "could not start the layer");
                tokio::time::sleep(backoff).await;
                backoff = (backoff * 2).min(MAX_BACKOFF);
                continue;
            }
        };
        tracing::info!(pid = child.id(), "layer started (instant)");
        tokio::select! {
            status = child.wait() => {
                match status {
                    Ok(status) => tracing::warn!(%status, "layer exited"),
                    Err(error) => tracing::warn!(%error, "lost track of the layer"),
                }
            }
            () = stopped(&mut stop) => {
                if let Err(error) = child.kill().await {
                    tracing::warn!(%error, "could not stop the layer");
                }
                return;
            }
        }
        if started.elapsed() >= HEALTHY_RUN {
            backoff = MIN_BACKOFF;
        }
        tracing::info!(?backoff, "restarting the layer");
        tokio::select! {
            () = tokio::time::sleep(backoff) => {}
            () = stopped(&mut stop) => return,
        }
        backoff = (backoff * 2).min(MAX_BACKOFF);
    }
}

const EGL_VENDOR_ENV: &str = "__EGL_VENDOR_LIBRARY_FILENAMES";
const MESA_EGL_VENDOR_FILE: &str = "/usr/share/glvnd/egl_vendor.d/50_mesa.json";
/// PCI vendor IDs of GPUs driven by Mesa: Intel, AMD.
const MESA_GPU_VENDORS: [&str; 2] = ["0x8086", "0x1002"];

/// On hybrid laptops glvnd loads both NVIDIA's and Mesa's EGL into the layer and its WebKit web
/// process; restricting it to Mesa saves about 20 MB (ADR 0009). Only done when an Intel or AMD
/// GPU is present (so an NVIDIA-only machine keeps hardware rendering) and the user hasn't chosen
/// a vendor themselves.
fn mesa_egl_vendor_file() -> Option<&'static str> {
    let user_choice = std::env::var_os(EGL_VENDOR_ENV).is_some();
    let mesa_installed = Path::new(MESA_EGL_VENDOR_FILE).exists();
    let vendors = drm_gpu_vendors();
    use_mesa_only(user_choice, mesa_installed, &vendors).then_some(MESA_EGL_VENDOR_FILE)
}

fn use_mesa_only(user_choice: bool, mesa_installed: bool, gpu_vendors: &[String]) -> bool {
    !user_choice
        && mesa_installed
        && gpu_vendors
            .iter()
            .any(|v| MESA_GPU_VENDORS.contains(&v.trim()))
}

/// PCI vendor IDs of the DRM cards (`/sys/class/drm/cardN/device/vendor`).
fn drm_gpu_vendors() -> Vec<String> {
    let Ok(entries) = std::fs::read_dir("/sys/class/drm") else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter(|e| {
            let name = e.file_name();
            let name = name.to_string_lossy();
            name.strip_prefix("card")
                .is_some_and(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()))
        })
        .filter_map(|e| std::fs::read_to_string(e.path().join("device/vendor")).ok())
        .collect()
}

/// Resolves once `stop` is true (or its sender is gone).
async fn stopped(stop: &mut watch::Receiver<bool>) {
    let _ = stop.wait_for(|stop| *stop).await;
}

#[cfg(test)]
mod tests {
    use super::use_mesa_only;

    fn v(ids: &[&str]) -> Vec<String> {
        ids.iter().map(|s| format!("{s}\n")).collect()
    }

    #[test]
    fn hybrid_intel_nvidia_uses_mesa() {
        assert!(use_mesa_only(false, true, &v(&["0x8086", "0x10de"])));
    }

    #[test]
    fn nvidia_only_keeps_the_default() {
        assert!(!use_mesa_only(false, true, &v(&["0x10de"])));
    }

    #[test]
    fn user_choice_and_missing_mesa_win() {
        assert!(!use_mesa_only(true, true, &v(&["0x8086"])));
        assert!(!use_mesa_only(false, false, &v(&["0x1002"])));
    }
}

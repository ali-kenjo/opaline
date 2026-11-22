//! Instant backend, Phase 0 part: core spawns and supervises the layer process through
//! Xwayland. Placement checks, Show Desktop recovery and Peek follow in Phase 4.

use std::process::Stdio;
use std::time::{Duration, Instant};

use tokio::process::Command;
use tokio::sync::watch;

const MIN_BACKOFF: Duration = Duration::from_millis(500);
const MAX_BACKOFF: Duration = Duration::from_secs(30);
/// A layer that ran this long is considered healthy; the backoff starts over.
const HEALTHY_RUN: Duration = Duration::from_secs(60);

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
        let child = Command::new(&exe)
            .args(["--layer", "--backend", "instant"])
            // Instant mode needs X11 window hints (keep-below, skip-taskbar, sticky) that GNOME
            // only honours for Xwayland clients.
            .env("GDK_BACKEND", "x11")
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .spawn();
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

/// Resolves once `stop` is true (or its sender is gone).
async fn stopped(stop: &mut watch::Receiver<bool>) {
    let _ = stop.wait_for(|stop| *stop).await;
}

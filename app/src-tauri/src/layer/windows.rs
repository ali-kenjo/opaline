//! One transparent, undecorated window per monitor.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use gtk::prelude::*;
use opaline_ipc::{BackendKind, MonitorInfo};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};

use super::bridge::{Bridge, Rect};

const LABEL_PREFIX: &str = "layer-";

/// Window labels may only contain `a-zA-Z0-9-/:_`; connectors like `eDP-1` already do, but
/// anything else is replaced to be safe.
fn label_for(connector: &str) -> String {
    let safe: String = connector
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    format!("{LABEL_PREFIX}{safe}")
}

/// Where a layer window goes, in logical pixels.
///
/// Instant mode covers the monitor's **work area** (without the top bar and the dock): Mutter
/// constrains normal X11 windows that overlap panels and moved a full-monitor window onto
/// the wrong monitor in the Phase 0 spike. The widget grid only uses the work area anyway.
/// Native mode covers the whole monitor; the helper places it.
fn target_geometry(
    app: &AppHandle,
    monitor: &MonitorInfo,
    backend: BackendKind,
) -> (LogicalPosition<f64>, LogicalSize<f64>) {
    let full = (
        LogicalPosition::new(f64::from(monitor.x), f64::from(monitor.y)),
        LogicalSize::new(f64::from(monitor.width), f64::from(monitor.height)),
    );
    if backend == BackendKind::Native {
        return full;
    }
    let work_area = app.available_monitors().ok().and_then(|monitors| {
        let m = monitors
            .into_iter()
            .find(|m| m.name().is_some_and(|n| *n == monitor.connector))?;
        let scale = m.scale_factor();
        let area = m.work_area();
        (scale > 0.0).then(|| {
            (
                LogicalPosition::new(
                    f64::from(area.position.x) / scale,
                    f64::from(area.position.y) / scale,
                ),
                LogicalSize::new(
                    f64::from(area.size.width) / scale,
                    f64::from(area.size.height) / scale,
                ),
            )
        })
    });
    work_area.unwrap_or_else(|| {
        tracing::warn!(connector = %monitor.connector, "no work area for monitor; using its full size");
        full
    })
}

/// Moves and sizes a window to its target. Called at creation and again once the page has
/// loaded, because Mutter may ignore the position of a window that isn't mapped yet.
pub fn place(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    monitor: &MonitorInfo,
    backend: BackendKind,
) {
    let (position, size) = target_geometry(app, monitor, backend);
    if let Err(error) = window.set_size(size) {
        tracing::warn!(%error, label = window.label(), "could not size layer window");
    }
    pin(app, window, (to_int(position.x), to_int(position.y)));
    tracing::info!(
        label = window.label(),
        x = position.x,
        y = position.y,
        width = size.width,
        height = size.height,
        "layer window placed"
    );
}

/// Desired positions of the layer windows, enforced against window-manager placement.
#[derive(Debug, Default)]
pub struct Pins(Mutex<HashMap<String, Arc<Mutex<Pin>>>>);

#[derive(Debug)]
pub struct Pin {
    target: (i32, i32),
    burst_start: Instant,
    corrections: u32,
}

/// More corrections than this per second means something else is moving the window on
/// purpose; we stop fighting and log it.
const MAX_CORRECTIONS_PER_SECOND: u32 = 4;

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Moves the window to `target` and keeps it there.
///
/// Mutter places a newly mapped X11 window on the monitor under the pointer and ignores the
/// position GTK requested before mapping (seen in the Phase 0 spike: the eDP-1 window landed on
/// HDMI-2). A move after mapping is honoured, so we watch `configure-event` and move the GDK
/// surface back whenever it isn't where it belongs, the same way DING keeps its window in
/// place. `gtk_window_move` isn't used because GTK skips it when it thinks nothing changed.
fn pin(app: &AppHandle, window: &tauri::WebviewWindow, target: (i32, i32)) {
    let pins = app.state::<Pins>();
    let (entry, is_new) = {
        let mut map = lock(&pins.0);
        match map.get(window.label()) {
            Some(pin) => (pin.clone(), false),
            None => {
                let pin = Arc::new(Mutex::new(Pin {
                    target,
                    burst_start: Instant::now(),
                    corrections: 0,
                }));
                map.insert(window.label().to_owned(), pin.clone());
                (pin, true)
            }
        }
    };
    lock(&entry).target = target;

    let tauri_window = window.clone();
    let label = window.label().to_owned();
    let result = window.run_on_main_thread(move || {
        let Ok(gtk_window) = tauri_window.gtk_window() else {
            tracing::warn!(label, "no GTK window to place");
            return;
        };
        if is_new {
            let pin = entry.clone();
            let label = label.clone();
            gtk_window.connect_configure_event(move |w, event| {
                let (x, y) = event.position();
                let mut pin = lock(&pin);
                if (x, y) != pin.target {
                    if pin.burst_start.elapsed() > Duration::from_secs(1) {
                        pin.burst_start = Instant::now();
                        pin.corrections = 0;
                    }
                    if pin.corrections < MAX_CORRECTIONS_PER_SECOND {
                        pin.corrections += 1;
                        tracing::debug!(label, from = ?(x, y), to = ?pin.target, "moving layer window back");
                        if let Some(gdk_window) = w.window() {
                            gdk_window.move_(pin.target.0, pin.target.1);
                        }
                    } else if pin.corrections == MAX_CORRECTIONS_PER_SECOND {
                        pin.corrections += 1;
                        tracing::warn!(label, "layer window keeps being moved; not fighting it");
                    }
                }
                false // let GTK handle the event too
            });
        }
        if let Some(gdk_window) = gtk_window.window() {
            let target = lock(&entry).target;
            gdk_window.move_(target.0, target.1);
        }
    });
    if let Err(error) = result {
        tracing::warn!(%error, "could not schedule layer window placement");
    }
}

/// Creates, moves or closes windows so there is exactly one per monitor.
pub fn sync(app: &AppHandle, bridge: &Bridge, monitors: &[MonitorInfo], backend: BackendKind) {
    let mut wanted = HashMap::new();
    for monitor in monitors {
        let label = label_for(&monitor.connector);
        if let Some(window) = app.get_webview_window(&label) {
            place(app, &window, monitor, backend);
        } else {
            create_sharing_process(app, &label, monitor, backend);
        }
        wanted.insert(label, monitor.clone());
    }
    for (label, window) in app.webview_windows() {
        if label.starts_with(LABEL_PREFIX) && !wanted.contains_key(&label) {
            tracing::info!(label, "monitor gone; closing its layer window");
            lock(&app.state::<Pins>().0).remove(&label);
            if let Err(error) = window.destroy() {
                tracing::warn!(%error, label, "could not close layer window");
            }
        }
    }
    bridge.set_window_monitors(wanted);
}

/// Creates the window for `monitor`. Every layer window after the first is created as a
/// WebKit *related view* of an existing one, so all of them share one web process instead of
/// one each (about 80 MB per extra monitor; Phase 0 spike B, ADR 0009).
fn create_sharing_process(
    app: &AppHandle,
    label: &str,
    monitor: &MonitorInfo,
    backend: BackendKind,
) {
    let existing = app
        .webview_windows()
        .into_iter()
        .find(|(l, _)| l.starts_with(LABEL_PREFIX))
        .map(|(_, w)| w);
    let Some(existing) = existing else {
        let (position, size) = target_geometry(app, monitor, backend);
        create(app, label, monitor, position, size, backend, None);
        return;
    };
    // The WebKit view isn't `Send`, so the new window is built on the main thread, inside the
    // callback that has access to the existing view.
    let app_handle = app.clone();
    let label_owned = label.to_owned();
    let monitor_owned = monitor.clone();
    let result = existing.with_webview(move |platform| {
        let (position, size) = target_geometry(&app_handle, &monitor_owned, backend);
        create(
            &app_handle,
            &label_owned,
            &monitor_owned,
            position,
            size,
            backend,
            Some(platform.inner()),
        );
    });
    if let Err(error) = result {
        tracing::warn!(%error, label, "could not share the web process; creating a separate one");
        let (position, size) = target_geometry(app, monitor, backend);
        create(app, label, monitor, position, size, backend, None);
    }
}

fn create(
    app: &AppHandle,
    label: &str,
    monitor: &MonitorInfo,
    position: LogicalPosition<f64>,
    size: LogicalSize<f64>,
    backend: BackendKind,
    related: Option<webkit2gtk::WebView>,
) {
    // The helper (Native) finds our windows by this title.
    let title = format!("opaline-layer:{}", monitor.connector);
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("layer.html".into()))
        .title(title)
        .transparent(true)
        .decorations(false)
        .resizable(false)
        .shadow(false)
        .focused(false)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        // Shown after the position hint is set (see `show_at`).
        .visible(false)
        .position(position.x, position.y)
        .inner_size(size.width, size.height);
    let related_used = related.is_some();
    let builder = match related {
        Some(view) => builder.with_related_view(view),
        None => builder,
    };
    let builder = match backend {
        // GNOME honours keep-below only for X11 clients (Instant mode runs through Xwayland).
        BackendKind::Instant => builder.always_on_bottom(true),
        // The shell helper does the stacking in Native mode.
        BackendKind::Native => builder,
    };
    match builder.build() {
        Ok(window) => {
            tracing::info!(label, connector = %monitor.connector, x = position.x, y = position.y,
                width = size.width, height = size.height, scale = monitor.scale, shared_process = related_used, "layer window created");
            show_at(&window, position, size);
            pin(app, &window, (to_int(position.x), to_int(position.y)));
            // Click-through until the frontend reports where its widgets are.
            set_input_region(&window, &[]);
        }
        Err(error) => tracing::error!(%error, label, "could not create layer window"),
    }
}

/// Maps the window at `position`.
///
/// Mutter places a new X11 window on the monitor under the pointer unless the window says its
/// position was chosen on purpose (`USPosition` in `WM_NORMAL_HINTS`). GTK only sets that hint
/// through geometry hints, so we set it (with the fixed size) before the window is mapped.
fn show_at(window: &tauri::WebviewWindow, position: LogicalPosition<f64>, size: LogicalSize<f64>) {
    let target = window.clone();
    let (x, y) = (to_int(position.x), to_int(position.y));
    let (w, h) = (to_int(size.width), to_int(size.height));
    let result = window.run_on_main_thread(move || {
        let Ok(gtk_window) = target.gtk_window() else {
            tracing::warn!(label = target.label(), "no GTK window to show");
            return;
        };
        let geometry = gtk::gdk::Geometry::new(
            w,
            h,
            w,
            h,
            0,
            0,
            0,
            0,
            0.0,
            0.0,
            gtk::gdk::Gravity::NorthWest,
        );
        gtk_window.set_geometry_hints(
            None::<&gtk::Widget>,
            Some(&geometry),
            gtk::gdk::WindowHints::USER_POS
                | gtk::gdk::WindowHints::POS
                | gtk::gdk::WindowHints::MIN_SIZE
                | gtk::gdk::WindowHints::MAX_SIZE,
        );
        gtk_window.move_(x, y);
        gtk_window.show();
    });
    if let Err(error) = result {
        tracing::warn!(%error, "could not schedule showing the layer window");
    }
}

#[allow(clippy::cast_possible_truncation)]
fn to_int(v: f64) -> i32 {
    v.round().clamp(f64::from(i32::MIN), f64::from(i32::MAX)) as i32
}

/// Sets the input shape of the window's GDK surface to the union of `rects`.
pub fn set_input_region(window: &tauri::WebviewWindow, rects: &[Rect]) {
    let target = window.clone();
    let rects = rects.to_vec();
    let result = window.run_on_main_thread(move || {
        let gtk_window = match target.gtk_window() {
            Ok(w) => w,
            Err(error) => {
                tracing::warn!(%error, "no GTK window for the input region");
                return;
            }
        };
        let Some(gdk_window) = gtk_window.window() else {
            tracing::debug!("GTK window not realized yet; input region skipped");
            return;
        };
        let region = gtk::cairo::Region::create();
        for r in &rects {
            let rect = gtk::cairo::RectangleInt::new(
                to_int(r.x),
                to_int(r.y),
                to_int(r.width),
                to_int(r.height),
            );
            if let Err(error) = region.union_rectangle(&rect) {
                tracing::warn!(%error, "could not build the input region");
                return;
            }
        }
        gdk_window.input_shape_combine_region(&region, 0, 0);
    });
    if let Err(error) = result {
        tracing::warn!(%error, "could not schedule the input region update");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_are_tauri_safe() {
        assert_eq!(label_for("eDP-1"), "layer-eDP-1");
        assert_eq!(label_for("HDMI 2"), "layer-HDMI_2");
    }
}

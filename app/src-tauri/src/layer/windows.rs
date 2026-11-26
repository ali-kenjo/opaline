//! One transparent, undecorated window per monitor.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use gtk::prelude::*;
use opaline_ipc::{BackendKind, MonitorInfo};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};
use webkit2gtk::WebViewExt;

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
/// Both modes cover the monitor's **work area** (without the top bar and the dock): Mutter
/// constrains normal windows away from struts, and the widget grid only uses the work area
/// anyway (ADR 0008). Native mode gets work areas from the shell helper; Instant mode reads
/// them from GDK/X11 `_GTK_WORKAREAS_D*`.
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
        if let Some((x, y, w, h)) = monitor.work_area
            && w > 0
            && h > 0
        {
            return (
                LogicalPosition::new(f64::from(x), f64::from(y)),
                LogicalSize::new(f64::from(w), f64::from(h)),
            );
        }
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
    app.state::<Arc<Bridge>>().set_geometry(
        window.label(),
        (position.x, position.y, size.width, size.height),
    );
    // In Native mode the helper positions the window; Wayland clients can't anyway.
    if backend == BackendKind::Instant {
        pin(
            app,
            window,
            (to_int(position.x), to_int(position.y)),
            (to_int(size.width), to_int(size.height)),
        );
    }
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
    size: (i32, i32),
    burst_start: Instant,
    corrections: u32,
    iconify_burst: Instant,
    deiconifies: u32,
}

/// More corrections than this per second means something else is moving the window on
/// purpose; we stop fighting and log it.
const MAX_CORRECTIONS_PER_SECOND: u32 = 4;
/// Maximum web-process crash recoveries per minute before giving up (ADR 0009).
const MAX_RECOVERIES_PER_MINUTE: u32 = 5;

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

fn apply_geometry_hints(gtk_window: &gtk::ApplicationWindow, (w, h): (i32, i32)) {
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
}

/// Moves the window to `target` and keeps it there (and recovers if Show Desktop minimizes it).
///
/// Mutter places a newly mapped X11 window on the monitor under the pointer and ignores the
/// position GTK requested before mapping (seen in the Phase 0 spike: the eDP-1 window landed on
/// HDMI-2). A move after mapping is honoured, so we watch `configure-event` and move the GDK
/// surface back whenever it isn't where it belongs, the same way DING keeps its window in
/// place. `gtk_window_move` isn't used because GTK skips it when it thinks nothing changed.
fn pin(app: &AppHandle, window: &tauri::WebviewWindow, target: (i32, i32), size: (i32, i32)) {
    let pins = app.state::<Pins>();
    let (entry, is_new) = {
        let mut map = lock(&pins.0);
        match map.get(window.label()) {
            Some(pin) => (pin.clone(), false),
            None => {
                let now = Instant::now();
                let pin = Arc::new(Mutex::new(Pin {
                    target,
                    size,
                    burst_start: now,
                    corrections: 0,
                    iconify_burst: now,
                    deiconifies: 0,
                }));
                map.insert(window.label().to_owned(), pin.clone());
                (pin, true)
            }
        }
    };
    {
        let mut p = lock(&entry);
        p.target = target;
        p.size = size;
    }

    let tauri_window = window.clone();
    let label = window.label().to_owned();
    let result = window.run_on_main_thread(move || {
        let Ok(gtk_window) = tauri_window.gtk_window() else {
            tracing::warn!(label, "no GTK window to place");
            return;
        };
        let (target, size) = {
            let p = lock(&entry);
            (p.target, p.size)
        };
        apply_geometry_hints(&gtk_window, size);
        if is_new {
            let pin = entry.clone();
            let label_pos = label.clone();
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
                        tracing::debug!(label = label_pos, from = ?(x, y), to = ?pin.target, "moving layer window back");
                        if let Some(gdk_window) = w.window() {
                            gdk_window.move_(pin.target.0, pin.target.1);
                        }
                    } else if pin.corrections == MAX_CORRECTIONS_PER_SECOND {
                        pin.corrections += 1;
                        tracing::warn!(label = label_pos, "layer window keeps being moved; not fighting it");
                    }
                }
                false // let GTK handle the event too
            });
            // Show Desktop minimizes X11 windows; undo it so widgets stay on the desktop.
            let pin = entry.clone();
            let label_state = label.clone();
            gtk_window.connect_window_state_event(move |w, event| {
                if event
                    .new_window_state()
                    .contains(gtk::gdk::WindowState::ICONIFIED)
                {
                    let mut pin = lock(&pin);
                    if pin.iconify_burst.elapsed() > Duration::from_secs(1) {
                        pin.iconify_burst = Instant::now();
                        pin.deiconifies = 0;
                    }
                    if pin.deiconifies < MAX_CORRECTIONS_PER_SECOND {
                        pin.deiconifies += 1;
                        tracing::debug!(label = label_state, "undoing layer minimize (Show Desktop)");
                        w.deiconify();
                    }
                }
                gtk::glib::Propagation::Proceed
            });
        }
        if let Some(gdk_window) = gtk_window.window() {
            gdk_window.move_resize(target.0, target.1, size.0, size.1);
        }
    });
    if let Err(error) = result {
        tracing::warn!(%error, "could not schedule layer window placement");
    }
}

/// Watches GDK monitor work-area changes (`_GTK_WORKAREAS_D*` / `_NET_WORKAREA`) in Instant
/// mode so dock auto-hide or top-bar changes re-place the layer windows (ADR 0008).
pub fn watch_work_areas(app: &AppHandle) {
    let handle = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        let Some(display) = gtk::gdk::Display::default() else {
            return;
        };
        let attach_monitor = |monitor: &gtk::gdk::Monitor, app: AppHandle| {
            monitor.connect_workarea_notify(move |_| {
                re_place_all(&app, BackendKind::Instant);
            });
        };
        for i in 0..display.n_monitors() {
            if let Some(monitor) = display.monitor(i) {
                attach_monitor(&monitor, handle.clone());
            }
        }
        let handle_added = handle.clone();
        display.connect_monitor_added(move |_, monitor| {
            attach_monitor(monitor, handle_added.clone());
            re_place_all(&handle_added, BackendKind::Instant);
        });
    }) {
        tracing::warn!(%error, "could not watch Instant-mode work areas");
    }
}

fn re_place_all(app: &AppHandle, backend: BackendKind) {
    let monitors = app.state::<Arc<Bridge>>().window_monitors();
    for (label, monitor) in monitors {
        if let Some(window) = app.get_webview_window(&label) {
            place(app, &window, &monitor, backend);
        }
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

/// The page the layer windows load. Debug builds take `OPALINE_LAYER_PAGE` (e.g. `lab.html?still`
/// from a `LAB=1` build) so the Widget Lab can be checked inside the real WebKitGTK webview.
fn layer_page() -> String {
    #[cfg(debug_assertions)]
    if let Ok(page) = std::env::var("OPALINE_LAYER_PAGE")
        && !page.is_empty()
        && !page.contains("://")
        && !page.starts_with('/')
    {
        return page;
    }
    "layer.html".to_owned()
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
    // Monitor changes can arrive back to back (screen unlock): two `sync` calls may both queue a
    // window for the same monitor before the first is built. This runs on the main thread, in
    // order, so the second sees the first window here and only places it.
    if let Some(window) = app.get_webview_window(label) {
        tracing::debug!(label, "layer window already created; placing it");
        place(app, &window, monitor, backend);
        return;
    }
    // The helper (Native) finds our windows by this title.
    let title = format!("opaline-layer:{}", monitor.connector);
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App(layer_page().into()))
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
            app.state::<Arc<Bridge>>()
                .set_geometry(label, (position.x, position.y, size.width, size.height));
            match backend {
                BackendKind::Instant => {
                    show_at(&window, position, size);
                    pin(
                        app,
                        &window,
                        (to_int(position.x), to_int(position.y)),
                        (to_int(size.width), to_int(size.height)),
                    );
                }
                BackendKind::Native => show_plain(&window),
            }
            attach_crash_recovery(&window);
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
        apply_geometry_hints(&gtk_window, (w, h));
        gtk_window.move_(x, y);
        // `show_all`, not `show`: the window was created hidden, so its children (Tauri's box and the
        // webview) are unmapped too. `show` alone maps an empty toplevel and nothing is ever drawn.
        gtk_window.show_all();
    });
    if let Err(error) = result {
        tracing::warn!(%error, "could not schedule showing the layer window");
    }
}

/// Web-process crash recovery shared by every layer window (ADR 0009).
#[derive(Debug)]
pub struct Recovery(Mutex<RecoveryState>);

#[derive(Debug)]
struct RecoveryState {
    /// A recovery is scheduled or running; further termination signals (one per window, all for
    /// the same crash) are folded into it.
    pending: bool,
    /// When the first recovery of the current minute started (`None` before any crash).
    burst_start: Option<Instant>,
    attempts: u32,
}

impl Default for Recovery {
    fn default() -> Self {
        Self(Mutex::new(RecoveryState {
            pending: false,
            burst_start: None,
            attempts: 0,
        }))
    }
}

/// How long to wait before the `attempt`-th recovery within a minute: 250 ms, then doubling.
fn recovery_delay(attempt: u32) -> Duration {
    Duration::from_millis(250u64 << attempt.saturating_sub(1).min(6))
}

/// Recreates every layer window if the shared WebKit web process crashes or hits its memory
/// limit (ADR 0009), with backoff and a cap so a deterministic crash can't spin.
fn attach_crash_recovery(window: &tauri::WebviewWindow) {
    let label = window.label().to_owned();
    let app = window.app_handle().clone();
    if let Err(error) = window.with_webview(move |platform| {
        let webview = platform.inner();
        // Suppress WebKitGTK's default browser menu (Back/Forward/Stop/Reload) on the desktop layer.
        webview.connect_context_menu(|_, _, _, _| true);
        webview.connect_web_process_terminated(move |_, reason| {
            on_web_process_terminated(&app, &label, reason);
        });
    }) {
        tracing::warn!(%error, "could not attach web-process crash recovery");
    }
}

fn on_web_process_terminated(
    app: &AppHandle,
    label: &str,
    reason: webkit2gtk::WebProcessTerminationReason,
) {
    let attempt = {
        let recovery = app.state::<Recovery>();
        let mut state = lock(&recovery.0);
        if state.pending {
            return;
        }
        if state
            .burst_start
            .is_none_or(|start| start.elapsed() > Duration::from_secs(60))
        {
            state.burst_start = Some(Instant::now());
            state.attempts = 0;
        }
        if state.attempts >= MAX_RECOVERIES_PER_MINUTE {
            tracing::error!(
                label,
                ?reason,
                "shared web process keeps terminating; not recreating the layer windows"
            );
            return;
        }
        state.attempts += 1;
        state.pending = true;
        state.attempts
    };
    let delay = recovery_delay(attempt);
    tracing::warn!(
        label,
        ?reason,
        attempt,
        delay_ms = delay.as_millis(),
        "shared web process terminated; recreating layer windows"
    );
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(delay).await;
        recreate_all(&app).await;
        lock(&app.state::<Recovery>().0).pending = false;
    });
}

/// Destroys every layer window and creates them again, the first one normally and the rest as
/// related views of it, so they share one new web process.
///
/// Reloading in place isn't enough: each reloaded view gets a web process of its own, because a
/// related view only shares its process when it is created (two processes, about +60 MB).
async fn recreate_all(app: &AppHandle) {
    let bridge = app.state::<Arc<Bridge>>().inner().clone();
    let backend = *app.state::<BackendKind>();
    let monitors: Vec<MonitorInfo> = bridge
        .window_monitors()
        .into_iter()
        .map(|(_, monitor)| monitor)
        .collect();
    for (label, window) in layer_windows(app) {
        lock(&app.state::<Pins>().0).remove(&label);
        if let Err(error) = window.destroy() {
            tracing::warn!(%error, label, "could not close layer window");
        }
    }
    // Tauri destroys windows on its event loop; their labels are only free once that ran.
    let deadline = Instant::now() + Duration::from_secs(2);
    while !layer_windows(app).is_empty() {
        if Instant::now() > deadline {
            tracing::warn!("old layer windows are still open; recreating anyway");
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    sync(app, &bridge, &monitors, backend);
    if backend == BackendKind::Instant && bridge.raised() {
        set_raised_instant(app, true);
    }
    tracing::info!(windows = monitors.len(), "layer windows recreated");
}

fn layer_windows(app: &AppHandle) -> Vec<(String, tauri::WebviewWindow)> {
    app.webview_windows()
        .into_iter()
        .filter(|(label, _)| label.starts_with(LABEL_PREFIX))
        .collect()
}

/// Native mode: map the window; the helper sizes, places and stacks it.
fn show_plain(window: &tauri::WebviewWindow) {
    let target = window.clone();
    let result = window.run_on_main_thread(move || {
        if let Ok(gtk_window) = target.gtk_window() {
            gtk_window.show_all();
        }
    });
    if let Err(error) = result {
        tracing::warn!(%error, "could not schedule showing the layer window");
    }
}

/// Peek/Edit in Instant mode: lift every layer window above all windows (and focus one, so
/// Esc reaches it), or put them back below. Native mode asks core, which asks the helper.
pub fn set_raised_instant(app: &AppHandle, raised: bool) {
    let mut first = true;
    for (label, window) in app.webview_windows() {
        if !label.starts_with("layer-") {
            continue;
        }
        let result = if raised {
            window
                .set_always_on_bottom(false)
                .and_then(|()| window.set_always_on_top(true))
        } else {
            window
                .set_always_on_top(false)
                .and_then(|()| window.set_always_on_bottom(true))
        };
        if let Err(error) = result {
            tracing::warn!(%error, label, "could not change the layer's stacking");
        }
        if raised && first {
            first = false;
            let _ = window.set_focus();
        }
    }
}

#[allow(clippy::cast_possible_truncation)]
fn to_int(v: f64) -> i32 {
    v.round().clamp(f64::from(i32::MIN), f64::from(i32::MAX)) as i32
}

/// Sets the input shape of the window to the union of `rects`.
///
/// Applies the region on the `GtkWindow` widget (not only its `GdkWindow`) so GTK3 Wayland
/// commits `wl_surface.set_input_region` and preserves it across realizes, resizes, and
/// configures; `queue_draw` forces a commit even when the layer is static.
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
        gtk_window.input_shape_combine_region(Some(&region));
        if let Some(gdk_window) = gtk_window.window() {
            gdk_window.input_shape_combine_region(&region, 0, 0);
        }
        gtk_window.queue_draw();
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

    #[test]
    fn recovery_backs_off() {
        assert_eq!(recovery_delay(1), Duration::from_millis(250));
        assert_eq!(recovery_delay(2), Duration::from_millis(500));
        assert_eq!(recovery_delay(5), Duration::from_millis(4000));
        assert_eq!(recovery_delay(100), Duration::from_millis(16_000));
    }
}

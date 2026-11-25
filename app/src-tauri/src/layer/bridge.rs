//! Shared state between the IPC client and the layer windows, and the window commands.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use opaline_ipc::{
    ActivityClass, BackendKind, ClientMsg, Command, CommandResult, CoreEvent, MonitorInfo, Topic,
    TopicUpdate,
};
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, State, WebviewWindow};
use tokio::sync::{mpsc, oneshot};

/// How long a widget waits for core to answer a command.
const COMMAND_TIMEOUT: Duration = Duration::from_secs(20);

/// What a window's frontend receives. Mirrored in `app/src/layer/protocol.ts`.
#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum LayerEvent {
    Connecting {
        attempt: u32,
    },
    Connected {
        core_version: String,
        backend: BackendKind,
        monitor: Option<MonitorInfo>,
        monitors: Vec<MonitorInfo>,
    },
    Rejected {
        reason: String,
    },
    Update {
        seq: u64,
        at_ms: u64,
        updates: Vec<TopicUpdate>,
    },
    CoreEvent {
        event: CoreEvent,
    },
    /// Where this window sits, in global logical pixels (for wallpaper alignment).
    Geometry {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    },
    /// Visualizer levels then peaks (`2 × bands`, 0–255), about 60 per second while capturing.
    Spectrum {
        seq: u32,
        levels: Vec<u8>,
    },
    /// Peek mode across every layer window (kept in sync when any window dismisses it).
    Peek {
        active: bool,
    },
    /// Edit mode across every layer window (all displays edit together).
    Edit {
        active: bool,
    },
}

#[derive(Debug, Clone)]
pub enum ConnState {
    Connecting(u32),
    Connected {
        core_version: String,
        backend: BackendKind,
    },
    Rejected(String),
}

struct Inner {
    channels: HashMap<String, Channel<LayerEvent>>,
    monitors_by_label: HashMap<String, MonitorInfo>,
    conn: ConnState,
    topics: HashSet<Topic>,
    /// Commands sent to core, waiting for their result.
    pending: HashMap<u32, oneshot::Sender<CommandResult>>,
    /// Each window's last placement (replayed when its page attaches).
    geometry: HashMap<String, (f64, f64, f64, f64)>,
    /// Latest value of every topic, replayed to a window that attaches after the topic was
    /// subscribed (core sends the latest value only once, to the first subscriber).
    latest: HashMap<Topic, TopicUpdate>,
    /// Shared Peek and Edit states across all monitor windows.
    peek: bool,
    edit: bool,
    /// Per-connector covered state from core, replayed to windows that attach late.
    covered: HashMap<String, bool>,
    /// Last DesktopFocusChanged from core, replayed on attach.
    desktop_focused: Option<bool>,
}

pub struct Bridge {
    inner: Mutex<Inner>,
    outgoing: mpsc::UnboundedSender<ClientMsg>,
    next_command: AtomicU32,
}

impl std::fmt::Debug for Bridge {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let inner = self.lock();
        f.debug_struct("Bridge")
            .field("windows", &inner.channels.keys().collect::<Vec<_>>())
            .field("conn", &inner.conn)
            .finish_non_exhaustive()
    }
}

impl Bridge {
    pub fn new(outgoing: mpsc::UnboundedSender<ClientMsg>) -> Self {
        Self {
            inner: Mutex::new(Inner {
                channels: HashMap::new(),
                monitors_by_label: HashMap::new(),
                conn: ConnState::Connecting(0),
                topics: HashSet::new(),
                pending: HashMap::new(),
                geometry: HashMap::new(),
                latest: HashMap::new(),
                peek: false,
                edit: false,
                covered: HashMap::new(),
                desktop_focused: None,
            }),
            outgoing,
            next_command: AtomicU32::new(1),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        // Every critical section leaves the maps consistent, so a poisoned lock is still usable.
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn connection_event(inner: &Inner, label: &str) -> LayerEvent {
        match &inner.conn {
            ConnState::Connecting(attempt) => LayerEvent::Connecting { attempt: *attempt },
            ConnState::Connected {
                core_version,
                backend,
            } => LayerEvent::Connected {
                core_version: core_version.clone(),
                backend: *backend,
                monitor: inner.monitors_by_label.get(label).cloned(),
                monitors: inner.monitors_by_label.values().cloned().collect(),
            },
            ConnState::Rejected(reason) => LayerEvent::Rejected {
                reason: reason.clone(),
            },
        }
    }

    fn send(label: &str, channel: &Channel<LayerEvent>, event: LayerEvent) {
        if let Err(error) = channel.send(event) {
            tracing::debug!(%error, label, "window channel closed");
        }
    }

    /// Updates the connection state and tells every window.
    pub fn set_connection(&self, conn: ConnState) {
        let mut inner = self.lock();
        inner.conn = conn;
        for (label, channel) in &inner.channels {
            Self::send(label, channel, Self::connection_event(&inner, label));
        }
    }

    /// Records which monitor each window shows.
    pub fn set_window_monitors(&self, monitors: HashMap<String, MonitorInfo>) {
        let mut guard = self.lock();
        let inner = &mut *guard;
        inner.monitors_by_label = monitors;
        let known = &inner.monitors_by_label;
        inner.channels.retain(|label, _| known.contains_key(label));
    }

    /// Snapshot of every known `(window label, monitor)`, for re-placement on work-area changes.
    pub fn window_monitors(&self) -> Vec<(String, MonitorInfo)> {
        self.lock()
            .monitors_by_label
            .iter()
            .map(|(l, m)| (l.clone(), m.clone()))
            .collect()
    }

    /// Whether Peek or Edit holds the layer above other windows.
    pub fn raised(&self) -> bool {
        let inner = self.lock();
        inner.peek || inner.edit
    }

    /// Toggles Peek across every layer window (exiting Edit if open) and returns whether
    /// the layer should be raised.
    pub fn toggle_peek(&self) -> bool {
        let (peek, edit_changed) = {
            let mut inner = self.lock();
            inner.peek = !inner.peek;
            let ec = inner.peek && inner.edit;
            if ec {
                inner.edit = false;
            }
            (inner.peek, ec)
        };
        if edit_changed {
            self.broadcast(&LayerEvent::Edit { active: false });
        }
        self.broadcast(&LayerEvent::Peek { active: peek });
        peek
    }

    /// Sets Peek across every layer window; returns whether the layer should be raised.
    pub fn set_peek(&self, active: bool) -> (bool, bool) {
        let (changed, raised) = {
            let mut inner = self.lock();
            let differs = inner.peek != active;
            inner.peek = active;
            (differs, inner.peek || inner.edit)
        };
        if changed {
            self.broadcast(&LayerEvent::Peek { active });
        }
        (changed, raised)
    }

    /// Toggles Edit mode across every layer window (exiting Peek if open) and returns whether
    /// the layer should be raised.
    pub fn toggle_edit(&self) -> bool {
        let (edit, peek_changed) = {
            let mut inner = self.lock();
            inner.edit = !inner.edit;
            let pc = inner.edit && inner.peek;
            if pc {
                inner.peek = false;
            }
            (inner.edit, pc)
        };
        if peek_changed {
            self.broadcast(&LayerEvent::Peek { active: false });
        }
        self.broadcast(&LayerEvent::Edit { active: edit });
        edit
    }

    /// Sets Edit mode across every layer window; returns `(changed, raised)`.
    pub fn set_edit(&self, active: bool) -> (bool, bool) {
        let (changed, peek_changed, raised) = {
            let mut inner = self.lock();
            let differs = inner.edit != active;
            inner.edit = active;
            let pc = active && inner.peek;
            if pc {
                inner.peek = false;
            }
            (differs, pc, inner.peek || inner.edit)
        };
        if peek_changed {
            self.broadcast(&LayerEvent::Peek { active: false });
        }
        if changed {
            self.broadcast(&LayerEvent::Edit { active });
        }
        (changed, raised)
    }

    pub fn broadcast(&self, event: &LayerEvent) {
        let mut inner = self.lock();
        match event {
            LayerEvent::Update { updates, .. } => {
                for u in updates {
                    inner.latest.insert(u.topic.clone(), u.clone());
                }
            }
            LayerEvent::CoreEvent {
                event: CoreEvent::LayerCovered { connector, covered },
            } => {
                inner.covered.insert(connector.clone(), *covered);
            }
            LayerEvent::CoreEvent {
                event: CoreEvent::DesktopFocusChanged { focused },
            } => {
                inner.desktop_focused = Some(*focused);
            }
            _ => {}
        }
        for (label, channel) in &inner.channels {
            Self::send(label, channel, event.clone());
        }
    }

    /// Records where a window was placed and tells its page.
    pub fn set_geometry(&self, label: &str, rect: (f64, f64, f64, f64)) {
        let mut inner = self.lock();
        inner.geometry.insert(label.to_owned(), rect);
        if let Some(channel) = inner.channels.get(label) {
            Self::send(label, channel, Self::geometry_event(rect));
        }
    }

    fn geometry_event((x, y, width, height): (f64, f64, f64, f64)) -> LayerEvent {
        LayerEvent::Geometry {
            x,
            y,
            width,
            height,
        }
    }

    /// Delivers a command result from core to the widget waiting for it.
    pub fn command_result(&self, id: u32, result: CommandResult) {
        if let Some(tx) = self.lock().pending.remove(&id) {
            // The widget may have stopped waiting (timeout, page reload); nothing to do then.
            let _ = tx.send(result);
        }
    }

    /// Fails every waiting command (the connection to core dropped).
    pub fn fail_pending(&self) {
        for (_, tx) in self.lock().pending.drain() {
            let _ = tx.send(CommandResult::Err {
                reason: "core-disconnected".into(),
            });
        }
    }

    async fn command(&self, command: Command) -> CommandResult {
        let id = self.next_command.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        {
            let mut inner = self.lock();
            // Never queue an action while disconnected: it would run whenever core comes back.
            if !matches!(inner.conn, ConnState::Connected { .. }) {
                return CommandResult::Err {
                    reason: "core-disconnected".into(),
                };
            }
            inner.pending.insert(id, tx);
        }
        if self
            .outgoing
            .send(ClientMsg::Command { id, command })
            .is_err()
        {
            self.lock().pending.remove(&id);
            return CommandResult::Err {
                reason: "core-disconnected".into(),
            };
        }
        match tokio::time::timeout(COMMAND_TIMEOUT, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => CommandResult::Err {
                reason: "core-disconnected".into(),
            },
            Err(_) => {
                self.lock().pending.remove(&id);
                CommandResult::Err {
                    reason: "command-timeout".into(),
                }
            }
        }
    }

    /// Topics to re-subscribe after a reconnect.
    pub fn topics(&self) -> Vec<Topic> {
        self.lock().topics.iter().cloned().collect()
    }

    /// Registers the window's channel and returns its monitor (if core told us about it).
    fn attach(&self, label: String, channel: Channel<LayerEvent>) -> Option<MonitorInfo> {
        let mut inner = self.lock();
        Self::send(&label, &channel, Self::connection_event(&inner, &label));
        if let Some(rect) = inner.geometry.get(&label) {
            Self::send(&label, &channel, Self::geometry_event(*rect));
        }
        if inner.peek {
            Self::send(&label, &channel, LayerEvent::Peek { active: true });
        }
        if inner.edit {
            Self::send(&label, &channel, LayerEvent::Edit { active: true });
        }
        let monitor = inner.monitors_by_label.get(&label).cloned();
        if let Some(ref m) = monitor
            && let Some(&covered) = inner.covered.get(&m.connector)
        {
            Self::send(
                &label,
                &channel,
                LayerEvent::CoreEvent {
                    event: CoreEvent::LayerCovered {
                        connector: m.connector.clone(),
                        covered,
                    },
                },
            );
        }
        if let Some(focused) = inner.desktop_focused {
            Self::send(
                &label,
                &channel,
                LayerEvent::CoreEvent {
                    event: CoreEvent::DesktopFocusChanged { focused },
                },
            );
        }
        if !inner.latest.is_empty() {
            let updates: Vec<TopicUpdate> = inner.latest.values().cloned().collect();
            Self::send(
                &label,
                &channel,
                LayerEvent::Update {
                    seq: 0,
                    at_ms: 0,
                    updates,
                },
            );
        }
        inner.channels.insert(label, channel);
        monitor
    }

    fn subscribe(&self, topic: Topic, class: ActivityClass) {
        let added = self.lock().topics.insert(topic.clone());
        if added
            && self
                .outgoing
                .send(ClientMsg::Subscribe { topic, class })
                .is_err()
        {
            tracing::warn!("IPC client is gone; subscription not sent");
        }
    }
}

#[tauri::command]
pub fn layer_attach(
    app: AppHandle,
    window: WebviewWindow,
    bridge: State<'_, std::sync::Arc<Bridge>>,
    backend: State<'_, BackendKind>,
    on_event: Channel<LayerEvent>,
) {
    if let Some(monitor) = bridge.attach(window.label().to_owned(), on_event) {
        // The page loaded, so the window is mapped: place it again (see `windows::place`).
        super::windows::place(&app, &window, &monitor, *backend);
    }
}

#[tauri::command]
pub fn layer_subscribe(
    topic: String,
    activity: ActivityClass,
    bridge: State<'_, std::sync::Arc<Bridge>>,
) {
    bridge.subscribe(Topic::new(topic), activity);
}

/// Sends a command to core (End task, media, settings, …) and returns its result.
#[tauri::command]
pub async fn layer_command(
    command: Command,
    bridge: State<'_, std::sync::Arc<Bridge>>,
) -> Result<CommandResult, ()> {
    Ok(bridge.command(command).await)
}

/// Applies raised stacking for Peek/Edit in either backend.
pub fn apply_raised(app: &AppHandle, bridge: &Bridge, backend: BackendKind, raised: bool) {
    match backend {
        BackendKind::Instant => super::windows::set_raised_instant(app, raised),
        BackendKind::Native => {
            let id = bridge.next_command.fetch_add(1, Ordering::Relaxed);
            let _ = bridge.outgoing.send(ClientMsg::Command {
                id,
                command: Command::SetRaised { raised },
            });
        }
    }
}

/// Peek/Edit: raise the layer above all windows, or lower it again. Instant mode does it here;
/// Native mode tells core, which asks the shell helper.
#[tauri::command]
pub async fn layer_set_raised(
    app: AppHandle,
    raised: bool,
    backend: State<'_, BackendKind>,
    bridge: State<'_, std::sync::Arc<Bridge>>,
) -> Result<CommandResult, ()> {
    match *backend {
        BackendKind::Instant => {
            super::windows::set_raised_instant(&app, raised);
            Ok(CommandResult::Ok)
        }
        BackendKind::Native => Ok(bridge.command(Command::SetRaised { raised }).await),
    }
}

/// Turns Peek on or off across every monitor window and updates stacking.
#[tauri::command]
pub async fn layer_set_peek(
    app: AppHandle,
    active: bool,
    backend: State<'_, BackendKind>,
    bridge: State<'_, std::sync::Arc<Bridge>>,
) -> Result<CommandResult, ()> {
    let (changed, raised) = bridge.set_peek(active);
    if !changed {
        return Ok(CommandResult::Ok);
    }
    match *backend {
        BackendKind::Instant => {
            super::windows::set_raised_instant(&app, raised);
            Ok(CommandResult::Ok)
        }
        BackendKind::Native => Ok(bridge.command(Command::SetRaised { raised }).await),
    }
}

/// Turns Edit mode on or off across every monitor window and updates stacking.
#[tauri::command]
pub async fn layer_set_edit(
    app: AppHandle,
    active: bool,
    backend: State<'_, BackendKind>,
    bridge: State<'_, std::sync::Arc<Bridge>>,
) -> Result<CommandResult, ()> {
    let (changed, raised) = bridge.set_edit(active);
    if !changed {
        return Ok(CommandResult::Ok);
    }
    match *backend {
        BackendKind::Instant => {
            super::windows::set_raised_instant(&app, raised);
            Ok(CommandResult::Ok)
        }
        BackendKind::Native => Ok(bridge.command(Command::SetRaised { raised }).await),
    }
}

/// A widget rectangle in window (logical) pixels.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Sets the window's input region to the union of `rects`; clicks anywhere else go to the
/// windows below (desktop icons). An empty list makes the whole window click-through.
#[tauri::command]
pub fn layer_set_input_region(window: WebviewWindow, rects: Vec<Rect>) {
    super::windows::set_input_region(&window, &rects);
}

/// Logs a measurement from a Phase 0 spike.
#[tauri::command]
pub fn layer_report(window: WebviewWindow, key: String, value: String) {
    tracing::info!(target: "opaline::spike", window = window.label(), key, value, "spike result");
}

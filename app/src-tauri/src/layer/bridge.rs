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
    /// Visualizer levels then peaks (`2 × bands`, 0–255), about 60 per second while capturing.
    Spectrum {
        seq: u32,
        levels: Vec<u8>,
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

    pub fn broadcast(&self, event: &LayerEvent) {
        let inner = self.lock();
        for (label, channel) in &inner.channels {
            Self::send(label, channel, event.clone());
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
        let monitor = inner.monitors_by_label.get(&label).cloned();
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

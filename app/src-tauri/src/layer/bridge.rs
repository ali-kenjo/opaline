//! Shared state between the IPC client and the layer windows, and the window commands.

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, MutexGuard, PoisonError};

use opaline_ipc::{
    ActivityClass, BackendKind, ClientMsg, CoreEvent, MonitorInfo, Topic, TopicUpdate,
};
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, State, WebviewWindow};
use tokio::sync::mpsc;

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
}

pub struct Bridge {
    inner: Mutex<Inner>,
    outgoing: mpsc::UnboundedSender<ClientMsg>,
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
            }),
            outgoing,
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

//! The topic bus between samplers, the IPC server and the rest of core.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use opaline_ipc::{BackendKind, CoreEvent, MonitorInfo, Topic, UpdateBatch};
use tokio::sync::{broadcast, watch};

/// Capacity of the update/event broadcast channels. A client that falls this far behind skips
/// ahead to the newest data (it's a live view, not a log).
const CHANNEL_CAPACITY: usize = 64;

#[derive(Debug)]
pub struct Hub {
    updates: broadcast::Sender<Arc<UpdateBatch>>,
    events: broadcast::Sender<CoreEvent>,
    monitors: watch::Sender<Vec<MonitorInfo>>,
    backend: watch::Sender<BackendKind>,
    subscriptions: Mutex<HashMap<Topic, usize>>,
    /// Bumped on every subscription change. A `watch` remembers that a change happened even
    /// if nobody was waiting at that moment, so samplers can't miss one.
    subscriptions_version: watch::Sender<u64>,
}

impl Hub {
    pub fn new(backend: BackendKind, monitors: Vec<MonitorInfo>) -> Arc<Self> {
        Arc::new(Self {
            updates: broadcast::channel(CHANNEL_CAPACITY).0,
            events: broadcast::channel(CHANNEL_CAPACITY).0,
            monitors: watch::channel(monitors).0,
            backend: watch::channel(backend).0,
            subscriptions: Mutex::new(HashMap::new()),
            subscriptions_version: watch::channel(0).0,
        })
    }

    pub fn publish(&self, batch: UpdateBatch) {
        // No receivers is fine: nobody is looking.
        let _ = self.updates.send(Arc::new(batch));
    }

    pub fn emit(&self, event: CoreEvent) {
        let _ = self.events.send(event);
    }

    pub fn updates(&self) -> broadcast::Receiver<Arc<UpdateBatch>> {
        self.updates.subscribe()
    }

    pub fn events(&self) -> broadcast::Receiver<CoreEvent> {
        self.events.subscribe()
    }

    pub fn monitors(&self) -> Vec<MonitorInfo> {
        self.monitors.borrow().clone()
    }

    pub fn set_monitors(&self, monitors: Vec<MonitorInfo>) {
        let changed = self.monitors.send_if_modified(|current| {
            if *current == monitors {
                false
            } else {
                current.clone_from(&monitors);
                true
            }
        });
        if changed {
            self.emit(CoreEvent::MonitorsChanged { monitors });
        }
    }

    pub fn backend(&self) -> BackendKind {
        *self.backend.borrow()
    }

    /// Registers interest in a topic. Every call must be paired with [`Hub::unsubscribe`].
    pub fn subscribe(&self, topic: &Topic) {
        {
            let mut subs = self.lock_subscriptions();
            *subs.entry(topic.clone()).or_insert(0) += 1;
        }
        self.subscriptions_version
            .send_modify(|v| *v = v.wrapping_add(1));
    }

    pub fn unsubscribe(&self, topic: &Topic) {
        {
            let mut subs = self.lock_subscriptions();
            if let Some(count) = subs.get_mut(topic) {
                *count = count.saturating_sub(1);
                if *count == 0 {
                    subs.remove(topic);
                }
            }
        }
        self.subscriptions_version
            .send_modify(|v| *v = v.wrapping_add(1));
    }

    pub fn is_subscribed(&self, topic: &str) -> bool {
        self.lock_subscriptions()
            .keys()
            .any(|t| t.as_str() == topic)
    }

    /// A receiver that reports subscription changes (`changed().await`).
    pub fn watch_subscriptions(&self) -> watch::Receiver<u64> {
        self.subscriptions_version.subscribe()
    }

    fn lock_subscriptions(&self) -> std::sync::MutexGuard<'_, HashMap<Topic, usize>> {
        // The map stays consistent even if a holder panicked: every critical section is a
        // single insert/remove.
        self.subscriptions
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subscriptions_are_reference_counted() {
        let hub = Hub::new(BackendKind::Instant, Vec::new());
        let topic = Topic::new("system.loadavg");
        hub.subscribe(&topic);
        hub.subscribe(&topic);
        hub.unsubscribe(&topic);
        assert!(hub.is_subscribed("system.loadavg"));
        hub.unsubscribe(&topic);
        assert!(!hub.is_subscribed("system.loadavg"));
        hub.unsubscribe(&topic);
        assert!(!hub.is_subscribed("system.loadavg"));
    }

    #[test]
    fn unchanged_monitors_emit_nothing() {
        let hub = Hub::new(BackendKind::Instant, Vec::new());
        let mut events = hub.events();
        hub.set_monitors(Vec::new());
        assert!(events.try_recv().is_err());
    }
}

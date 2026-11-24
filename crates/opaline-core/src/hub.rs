//! The topic bus between providers, the sampler, the IPC server and the rest of core.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use opaline_ipc::{
    ActivityClass, BackendKind, CoreEvent, MonitorInfo, SpectrumFrame, Topic, TopicUpdate,
    UpdateBatch, Value,
};
use tokio::sync::{broadcast, watch};

use crate::engine::ProviderStatus;
use crate::store::Settings;

/// Capacity of the update/event broadcast channels. A client that falls this far behind skips
/// ahead to the newest data (it's a live view, not a log).
const CHANNEL_CAPACITY: usize = 64;

const CLASSES: [ActivityClass; 4] = [
    ActivityClass::Idle,
    ActivityClass::Covered,
    ActivityClass::Ambient,
    ActivityClass::Interactive,
];

fn class_index(class: ActivityClass) -> usize {
    match class {
        ActivityClass::Idle => 0,
        ActivityClass::Covered => 1,
        ActivityClass::Ambient => 2,
        ActivityClass::Interactive => 3,
    }
}

/// How many subscribers want a topic, per activity class.
type ClassCounts = [usize; 4];

#[derive(Debug)]
pub struct Hub {
    updates: broadcast::Sender<Arc<UpdateBatch>>,
    events: broadcast::Sender<CoreEvent>,
    monitors: watch::Sender<Vec<MonitorInfo>>,
    backend: watch::Sender<BackendKind>,
    subscriptions: Mutex<HashMap<Topic, ClassCounts>>,
    /// Bumped on every subscription change. A `watch` remembers that a change happened even
    /// if nobody was waiting at that moment, so samplers can't miss one.
    subscriptions_version: watch::Sender<u64>,
    /// The newest value of every topic, so a new subscriber gets data at once.
    latest: Mutex<HashMap<Topic, Value>>,
    seq: Mutex<u64>,
    /// On battery with the power-saver profile: every interval doubles (brief §5.4).
    eco: watch::Sender<bool>,
    providers: Mutex<BTreeMap<String, ProviderStatus>>,
    /// Visualizer frames; a small buffer, a slow client just skips frames.
    spectrum: broadcast::Sender<Arc<SpectrumFrame>>,
    /// Whether any MPRIS player is playing: `None` = no player known.
    media_playing: watch::Sender<Option<bool>>,
    settings: watch::Sender<Arc<Settings>>,
    /// Screen locked: every subscription counts as Idle and nothing is pushed.
    locked: std::sync::atomic::AtomicBool,
    /// Connectors whose layer window is covered by a maximized or fullscreen window (Native
    /// mode reports this). When every monitor is covered, subscriptions count as Covered.
    covered: Mutex<HashSet<String>>,
    /// Per-connector work areas `(x, y, width, height)` reported by the Native shell helper.
    work_areas: Mutex<HashMap<String, (i32, i32, u32, u32)>>,
    history: crate::history::Shared,
    /// False when settings.json comes from a newer Opaline (or is broken): never overwrite it.
    settings_writable: std::sync::atomic::AtomicBool,
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
            latest: Mutex::new(HashMap::new()),
            seq: Mutex::new(0),
            eco: watch::channel(false).0,
            providers: Mutex::new(BTreeMap::new()),
            spectrum: broadcast::channel(4).0,
            media_playing: watch::channel(None).0,
            settings: watch::channel(Arc::new(Settings::default())).0,
            locked: std::sync::atomic::AtomicBool::new(false),
            covered: Mutex::new(HashSet::new()),
            work_areas: Mutex::new(HashMap::new()),
            history: crate::history::Shared::default(),
            settings_writable: std::sync::atomic::AtomicBool::new(true),
        })
    }

    /// Publishes the values that changed since the last publish, as one batch. Unchanged
    /// values are dropped, so a steady sensor costs nothing downstream.
    pub fn publish(&self, updates: Vec<TopicUpdate>) {
        let changed: Vec<TopicUpdate> = {
            let mut latest = lock(&self.latest);
            updates
                .into_iter()
                .filter(|u| {
                    if latest.get(&u.topic) == Some(&u.value) {
                        false
                    } else {
                        latest.insert(u.topic.clone(), u.value.clone());
                        true
                    }
                })
                .collect()
        };
        if changed.is_empty() {
            return;
        }
        let seq = {
            let mut seq = lock(&self.seq);
            *seq += 1;
            *seq
        };
        // No receivers is fine: nobody is looking.
        let _ = self.updates.send(Arc::new(UpdateBatch {
            seq,
            at_ms: now_ms(),
            updates: changed,
        }));
    }

    /// The newest value of `topic`, if any was published.
    pub fn latest(&self, topic: &Topic) -> Option<Value> {
        lock(&self.latest).get(topic).cloned()
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

    pub fn set_monitors(&self, mut monitors: Vec<MonitorInfo>) {
        let areas = lock(&self.work_areas);
        for m in &mut monitors {
            if let Some(&area) = areas.get(&m.connector) {
                m.work_area = Some(area);
            }
        }
        drop(areas);
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

    /// Updates per-connector work areas from the Native shell helper and notifies the layer
    /// when any monitor's work area changed.
    pub fn set_work_areas(&self, areas: HashMap<String, (i32, i32, u32, u32)>) {
        *lock(&self.work_areas) = areas;
        let current = self.monitors();
        self.set_monitors(current);
    }

    /// Clears Native work areas when switching back to Instant mode.
    pub fn clear_work_areas(&self) {
        let had = {
            let mut areas = lock(&self.work_areas);
            let had = !areas.is_empty();
            areas.clear();
            had
        };
        if had {
            let mut monitors = self.monitors();
            for m in &mut monitors {
                m.work_area = None;
            }
            self.set_monitors(monitors);
        }
    }

    /// Connectors currently marked covered, for replaying to a freshly connected layer.
    pub fn covered_connectors(&self) -> Vec<String> {
        lock(&self.covered).iter().cloned().collect()
    }

    pub fn backend(&self) -> BackendKind {
        *self.backend.borrow()
    }

    /// Records which backend places the layer now and tells the layer.
    pub fn set_backend(&self, backend: BackendKind) {
        // Only a real change notifies watchers (the Instant supervisor restarts on change).
        let changed = self.backend.send_if_modified(|current| {
            let differs = *current != backend;
            *current = backend;
            differs
        });
        if changed {
            self.emit(CoreEvent::BackendChanged { backend });
        }
    }

    pub fn watch_backend(&self) -> watch::Receiver<BackendKind> {
        self.backend.subscribe()
    }

    /// One monitor's layer became covered or uncovered (helper's `LayerCovered`).
    pub fn set_covered(&self, connector: &str, covered: bool) {
        let changed = {
            let mut set = lock(&self.covered);
            if covered {
                set.insert(connector.to_owned())
            } else {
                set.remove(connector)
            }
        };
        if changed {
            self.bump();
            self.emit(CoreEvent::LayerCovered {
                connector: connector.to_owned(),
                covered,
            });
        }
    }

    /// Forget coverage (the helper went away; Instant mode can't tell).
    pub fn clear_covered(&self) {
        let cleared: Vec<String> = {
            let mut set = lock(&self.covered);
            set.drain().collect()
        };
        if !cleared.is_empty() {
            self.bump();
            for connector in cleared {
                self.emit(CoreEvent::LayerCovered {
                    connector,
                    covered: false,
                });
            }
        }
    }

    /// Every monitor's layer is covered, so nothing is visible.
    pub fn all_covered(&self) -> bool {
        let monitors = self.monitors.borrow();
        let set = lock(&self.covered);
        !monitors.is_empty() && monitors.iter().all(|m| set.contains(&m.connector))
    }

    /// The class a subscription effectively has: Idle while locked, at most Covered while
    /// every layer window is covered.
    fn effective(&self, class: ActivityClass) -> ActivityClass {
        if self.locked() {
            ActivityClass::Idle
        } else if self.all_covered() {
            class.min(ActivityClass::Covered)
        } else {
            class
        }
    }

    /// Registers interest in a topic at an activity class. Every call must be paired with
    /// [`Hub::unsubscribe`] with the same class.
    pub fn subscribe(&self, topic: &Topic, class: ActivityClass) {
        {
            let mut subs = lock(&self.subscriptions);
            let counts = subs.entry(topic.clone()).or_insert([0; 4]);
            counts[class_index(class)] += 1;
        }
        self.bump();
    }

    pub fn unsubscribe(&self, topic: &Topic, class: ActivityClass) {
        {
            let mut subs = lock(&self.subscriptions);
            if let Some(counts) = subs.get_mut(topic) {
                let slot = &mut counts[class_index(class)];
                *slot = slot.saturating_sub(1);
                if counts.iter().all(|c| *c == 0) {
                    subs.remove(topic);
                }
            }
        }
        self.bump();
    }

    /// The most demanding class anyone subscribed to `topic` with, or `None` if nobody is.
    /// While the screen is locked, every subscription counts as Idle.
    pub fn interest(&self, topic: &str) -> Option<ActivityClass> {
        let subs = lock(&self.subscriptions);
        let counts = subs.iter().find(|(t, _)| t.as_str() == topic)?.1;
        let class = CLASSES
            .iter()
            .rev()
            .find(|class| counts[class_index(**class)] > 0)
            .copied();
        class.map(|c| self.effective(c))
    }

    pub fn history(&self) -> crate::history::Shared {
        self.history.clone()
    }

    pub fn locked(&self) -> bool {
        self.locked.load(std::sync::atomic::Ordering::Relaxed)
    }

    pub fn set_locked(&self, locked: bool) {
        if self
            .locked
            .swap(locked, std::sync::atomic::Ordering::Relaxed)
            != locked
        {
            // Re-plan sampling and pushes.
            self.bump();
        }
    }

    pub fn is_subscribed(&self, topic: &str) -> bool {
        self.interest(topic).is_some()
    }

    /// Every subscribed topic with its most demanding class (Idle for all while locked).
    pub fn interests(&self) -> Vec<(Topic, ActivityClass)> {
        let subs = lock(&self.subscriptions);
        subs.iter()
            .filter_map(|(topic, counts)| {
                CLASSES
                    .iter()
                    .rev()
                    .find(|class| counts[class_index(**class)] > 0)
                    .map(|class| (topic.clone(), self.effective(*class)))
            })
            .collect()
    }

    /// A receiver that reports subscription changes (`changed().await`).
    pub fn watch_subscriptions(&self) -> watch::Receiver<u64> {
        self.subscriptions_version.subscribe()
    }

    pub fn eco(&self) -> bool {
        *self.eco.borrow()
    }

    pub fn set_eco(&self, eco: bool) {
        self.eco.send_if_modified(|current| {
            let changed = *current != eco;
            *current = eco;
            changed
        });
    }

    pub fn publish_spectrum(&self, frame: SpectrumFrame) {
        let _ = self.spectrum.send(Arc::new(frame));
    }

    pub fn spectrum(&self) -> broadcast::Receiver<Arc<SpectrumFrame>> {
        self.spectrum.subscribe()
    }

    pub fn set_media_playing(&self, playing: Option<bool>) {
        self.media_playing.send_if_modified(|current| {
            let changed = *current != playing;
            *current = playing;
            changed
        });
    }

    pub fn watch_media_playing(&self) -> watch::Receiver<Option<bool>> {
        self.media_playing.subscribe()
    }

    pub fn settings(&self) -> Arc<Settings> {
        self.settings.borrow().clone()
    }

    pub fn watch_settings(&self) -> watch::Receiver<Arc<Settings>> {
        self.settings.subscribe()
    }

    pub fn settings_writable(&self) -> bool {
        self.settings_writable
            .load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Installs the settings loaded at startup.
    pub fn init_settings(&self, settings: Settings, writable: bool) {
        self.settings_writable
            .store(writable, std::sync::atomic::Ordering::Relaxed);
        self.set_settings(settings);
    }

    /// Replaces the settings and publishes them as the `settings` topic.
    pub fn set_settings(&self, settings: Settings) {
        let json = serde_json::to_value(&settings).unwrap_or_default();
        self.settings.send_replace(Arc::new(settings));
        self.publish(vec![TopicUpdate {
            topic: Topic::new(crate::store::TOPIC),
            value: crate::json::from_json(&json),
        }]);
    }

    pub fn set_provider_status(&self, id: &str, status: ProviderStatus) {
        lock(&self.providers).insert(id.to_owned(), status);
    }

    pub fn provider_statuses(&self) -> BTreeMap<String, ProviderStatus> {
        lock(&self.providers).clone()
    }

    fn bump(&self) {
        self.subscriptions_version
            .send_modify(|v| *v = v.wrapping_add(1));
    }
}

/// Locks a mutex, recovering the data if a holder panicked: every critical section in this
/// module leaves the data consistent.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    #[test]
    fn subscriptions_are_reference_counted_per_class() {
        let hub = Hub::new(BackendKind::Instant, Vec::new());
        let topic = Topic::new("system.loadavg");
        hub.subscribe(&topic, ActivityClass::Ambient);
        hub.subscribe(&topic, ActivityClass::Interactive);
        assert_eq!(
            hub.interest("system.loadavg"),
            Some(ActivityClass::Interactive)
        );
        hub.unsubscribe(&topic, ActivityClass::Interactive);
        assert_eq!(hub.interest("system.loadavg"), Some(ActivityClass::Ambient));
        hub.unsubscribe(&topic, ActivityClass::Ambient);
        assert!(!hub.is_subscribed("system.loadavg"));
        hub.unsubscribe(&topic, ActivityClass::Ambient);
        assert!(!hub.is_subscribed("system.loadavg"));
    }

    #[test]
    fn a_locked_screen_makes_everything_idle() {
        let hub = Hub::new(BackendKind::Instant, Vec::new());
        let topic = Topic::new("cpu.load");
        hub.subscribe(&topic, ActivityClass::Interactive);
        hub.set_locked(true);
        assert_eq!(hub.interest("cpu.load"), Some(ActivityClass::Idle));
        assert_eq!(hub.interests()[0].1, ActivityClass::Idle);
        hub.set_locked(false);
        assert_eq!(hub.interest("cpu.load"), Some(ActivityClass::Interactive));
    }

    #[test]
    fn covered_tracks_per_monitor_and_all_covered() {
        let monitor = |connector: &str| MonitorInfo {
            key: format!("V-P-S:{connector}"),
            connector: connector.into(),
            vendor: "V".into(),
            product: "P".into(),
            serial: "S".into(),
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            scale: 1.0,
            primary: connector == "eDP-1",
            builtin: connector == "eDP-1",
            work_area: None,
        };
        let hub = Hub::new(
            BackendKind::Native,
            vec![monitor("eDP-1"), monitor("HDMI-2")],
        );
        let topic = Topic::new("cpu.load");
        hub.subscribe(&topic, ActivityClass::Interactive);
        let mut events = hub.events();

        hub.set_covered("eDP-1", true);
        assert!(!hub.all_covered());
        assert_eq!(hub.interest("cpu.load"), Some(ActivityClass::Interactive));
        assert_eq!(
            events.try_recv().unwrap(),
            CoreEvent::LayerCovered {
                connector: "eDP-1".into(),
                covered: true,
            }
        );

        hub.set_covered("HDMI-2", true);
        assert!(hub.all_covered());
        assert_eq!(hub.interest("cpu.load"), Some(ActivityClass::Covered));
        assert_eq!(
            events.try_recv().unwrap(),
            CoreEvent::LayerCovered {
                connector: "HDMI-2".into(),
                covered: true,
            }
        );

        hub.clear_covered();
        assert!(!hub.all_covered());
        assert_eq!(hub.interest("cpu.load"), Some(ActivityClass::Interactive));
        let cleared = [events.try_recv().unwrap(), events.try_recv().unwrap()];
        assert!(cleared.contains(&CoreEvent::LayerCovered {
            connector: "eDP-1".into(),
            covered: false,
        }));
        assert!(cleared.contains(&CoreEvent::LayerCovered {
            connector: "HDMI-2".into(),
            covered: false,
        }));
    }

    #[test]
    fn unchanged_monitors_emit_nothing() {
        let hub = Hub::new(BackendKind::Instant, Vec::new());
        let mut events = hub.events();
        hub.set_monitors(Vec::new());
        assert!(events.try_recv().is_err());
    }

    #[test]
    fn publish_drops_unchanged_values_and_keeps_the_latest() {
        let hub = Hub::new(BackendKind::Instant, Vec::new());
        let mut rx = hub.updates();
        let topic = Topic::new("cpu.load");
        let update = |v: f64| TopicUpdate {
            topic: topic.clone(),
            value: Value::Num(v),
        };
        hub.publish(vec![update(1.0)]);
        hub.publish(vec![update(1.0)]);
        hub.publish(vec![update(2.0)]);
        assert_eq!(rx.try_recv().unwrap().updates, vec![update(1.0)]);
        assert_eq!(rx.try_recv().unwrap().updates, vec![update(2.0)]);
        assert!(rx.try_recv().is_err());
        assert_eq!(hub.latest(&topic), Some(Value::Num(2.0)));
    }
}

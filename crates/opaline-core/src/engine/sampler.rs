//! The sampler: one shared 1 s tick that samples each provider only for the topics someone
//! needs, at the rate the most demanding subscriber needs (ARCHITECTURE §3.3).

use std::collections::HashMap;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::Arc;
use std::time::{Duration, Instant};

use opaline_ipc::{ActivityClass, Topic, TopicUpdate, Value};
use tokio::task::JoinHandle;
use tokio::time::MissedTickBehavior;

use super::supervise::panic_text;
use super::{Health, Provider, ProviderError, ProviderStatus, SampleCx, TopicDesc};
use crate::hub::Hub;

const TICK: Duration = Duration::from_secs(1);
/// How long a tick waits for this tick's samples before publishing what it has.
const GATHER_DEADLINE: Duration = Duration::from_millis(750);
/// A sample running longer than this is reported as stuck.
const STUCK_AFTER: Duration = Duration::from_secs(5);
const MIN_BACKOFF: Duration = Duration::from_secs(5);
const MAX_BACKOFF: Duration = Duration::from_secs(300);

/// Base interval of a class (brief §5.4), doubled in Eco, never below the topic's floor.
pub fn interval_for(class: ActivityClass, eco: bool, floor: Duration) -> Duration {
    let base = match class {
        ActivityClass::Interactive => Duration::from_secs(1),
        ActivityClass::Ambient => Duration::from_secs(2),
        ActivityClass::Covered => Duration::from_secs(5),
        ActivityClass::Idle => Duration::from_secs(10),
    };
    let base = if eco { base * 2 } else { base };
    base.max(floor)
}

fn ticks(interval: Duration) -> u64 {
    interval.as_secs().max(1)
}

/// Whether a topic is due at `tick`. A topic nobody sampled yet is due at once; after that it
/// runs on multiples of its interval, so topics with the same interval wake together.
fn is_due(tick: u64, interval_ticks: u64, last: Option<u64>) -> bool {
    match last {
        None => true,
        Some(last) => last != tick && tick.is_multiple_of(interval_ticks),
    }
}

type Outcome = (
    Box<dyn Provider>,
    Result<Result<Vec<TopicUpdate>, ProviderError>, String>,
    Duration,
);

enum State {
    Ready(Box<dyn Provider>),
    Running {
        handle: JoinHandle<Outcome>,
        since: Instant,
    },
    /// The blocking task was lost (only if the runtime is shutting down).
    Gone,
}

struct Slot {
    id: &'static str,
    topics: Vec<TopicDesc>,
    state: State,
    status: ProviderStatus,
    failures: u32,
    retry_at: Option<Instant>,
    /// Tick of the last sample per topic; cleared when a topic loses its subscribers.
    last: HashMap<&'static str, u64>,
}

pub struct Sampler {
    hub: Arc<Hub>,
    slots: Vec<Slot>,
}

impl std::fmt::Debug for Sampler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Sampler")
            .field(
                "providers",
                &self.slots.iter().map(|s| s.id).collect::<Vec<_>>(),
            )
            .finish_non_exhaustive()
    }
}

impl Sampler {
    pub fn new(hub: Arc<Hub>, providers: Vec<Box<dyn Provider>>) -> Self {
        let slots = providers
            .into_iter()
            .map(|p| {
                let status = ProviderStatus::new(Some(p.cost_hint()));
                hub.set_provider_status(p.id(), status.clone());
                Slot {
                    id: p.id(),
                    topics: p.topics().to_vec(),
                    state: State::Ready(p),
                    status,
                    failures: 0,
                    retry_at: None,
                    last: HashMap::new(),
                }
            })
            .collect();
        Self { hub, slots }
    }

    /// Runs until the hub goes away. Sleeps without any wake-ups while nothing is subscribed.
    pub async fn run(mut self) {
        let mut changes = self.hub.watch_subscriptions();
        let mut interval = tokio::time::interval(TICK);
        interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
        let mut tick = 0u64;
        loop {
            changes.mark_unchanged();
            if self.hub.interests().is_empty() && !self.any_running() {
                for slot in &mut self.slots {
                    slot.last.clear();
                }
                if changes.changed().await.is_err() {
                    return;
                }
                interval.reset_immediately();
            }
            tokio::select! {
                _ = interval.tick() => tick += 1,
                changed = changes.changed() => {
                    if changed.is_err() {
                        return;
                    }
                }
            }
            self.tick(tick).await;
        }
    }

    fn any_running(&self) -> bool {
        self.slots
            .iter()
            .any(|s| matches!(s.state, State::Running { .. }))
    }

    async fn tick(&mut self, tick: u64) {
        let now = Instant::now();
        let interests: HashMap<Topic, ActivityClass> = self.hub.interests().into_iter().collect();
        let eco = self.hub.eco();
        let mut published = Vec::new();

        // Start every provider that has a due topic.
        for slot in &mut self.slots {
            slot.last
                .retain(|topic, _| interests.contains_key(&Topic::new(*topic)));
            if slot.retry_at.is_some_and(|at| now < at) {
                continue;
            }
            let due: Vec<&'static str> = slot
                .topics
                .iter()
                .filter(|desc| {
                    interests.get(&Topic::new(desc.name)).is_some_and(|class| {
                        let k = ticks(interval_for(*class, eco, desc.min_interval));
                        is_due(tick, k, slot.last.get(desc.name).copied())
                    })
                })
                .map(|desc| desc.name)
                .collect();
            if due.is_empty() {
                continue;
            }
            let State::Ready(provider) = std::mem::replace(&mut slot.state, State::Gone) else {
                if let State::Running { since, .. } = slot.state
                    && now.duration_since(since) > STUCK_AFTER
                {
                    slot.status.health = Health::Stuck {
                        running_ms: millis(now.duration_since(since)),
                    };
                }
                continue;
            };
            for topic in &due {
                slot.last.insert(topic, tick);
            }
            slot.state = State::Running {
                handle: tokio::task::spawn_blocking(move || run_sample(provider, &due)),
                since: now,
            };
        }

        // Collect what finishes within the deadline; the rest is collected on a later tick.
        let deadline = tokio::time::Instant::now() + GATHER_DEADLINE;
        for slot in &mut self.slots {
            let State::Running { handle, .. } = &mut slot.state else {
                continue;
            };
            let Ok(joined) = tokio::time::timeout_at(deadline, &mut *handle).await else {
                continue;
            };
            match joined {
                Ok((provider, result, took)) => {
                    slot.state = State::Ready(provider);
                    published.extend(slot.finish(result, took, &interests));
                }
                Err(error) => {
                    tracing::error!(provider = slot.id, %error, "lost a provider's sampling task");
                    slot.state = State::Gone;
                }
            }
        }

        for slot in &self.slots {
            self.hub.set_provider_status(slot.id, slot.status.clone());
        }
        if !published.is_empty() {
            self.hub.publish(published);
        }
    }
}

impl Slot {
    /// Records a finished sample and returns the updates to publish.
    fn finish(
        &mut self,
        result: Result<Result<Vec<TopicUpdate>, ProviderError>, String>,
        took: Duration,
        interests: &HashMap<Topic, ActivityClass>,
    ) -> Vec<TopicUpdate> {
        let error = match result {
            Ok(Ok(updates)) => {
                self.status.record(took);
                self.failures = 0;
                self.retry_at = None;
                return updates
                    .into_iter()
                    .filter(|u| interests.contains_key(&u.topic))
                    .collect();
            }
            Ok(Err(error)) => error.to_string(),
            Err(panic) => format!("panicked: {panic}"),
        };
        self.failures = self.failures.saturating_add(1);
        let backoff = backoff(self.failures);
        tracing::warn!(provider = self.id, %error, ?backoff, "provider failed");
        self.retry_at = Some(Instant::now() + backoff);
        self.status.health = Health::Failed {
            error,
            failures: self.failures,
            retry_in_ms: millis(backoff),
        };
        // Show a state instead of the last numbers, which would otherwise look live.
        self.topics
            .iter()
            .filter(|desc| interests.contains_key(&Topic::new(desc.name)))
            .map(|desc| TopicUpdate {
                topic: Topic::new(desc.name),
                value: Value::unavailable("provider-failed"),
            })
            .collect()
    }
}

/// Runs one sample, turning a panic into an error so it can't take core down.
fn run_sample(mut provider: Box<dyn Provider>, due: &[&'static str]) -> Outcome {
    let started = Instant::now();
    let result = catch_unwind(AssertUnwindSafe(|| {
        provider.sample(&SampleCx { now: started, due })
    }))
    .map_err(panic_text);
    (provider, result, started.elapsed())
}

fn backoff(failures: u32) -> Duration {
    let exp = failures.saturating_sub(1).min(16);
    (MIN_BACKOFF * 2u32.pow(exp)).min(MAX_BACKOFF)
}

fn millis(d: Duration) -> u64 {
    u64::try_from(d.as_millis()).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::panic)]

    use opaline_ipc::BackendKind;

    use super::*;
    use crate::engine::{Probe, update};

    #[test]
    fn intervals_follow_the_class_eco_and_floor() {
        let floor = Duration::from_secs(1);
        assert_eq!(
            interval_for(ActivityClass::Interactive, false, floor).as_secs(),
            1
        );
        assert_eq!(
            interval_for(ActivityClass::Ambient, false, floor).as_secs(),
            2
        );
        assert_eq!(
            interval_for(ActivityClass::Covered, false, floor).as_secs(),
            5
        );
        assert_eq!(
            interval_for(ActivityClass::Idle, false, floor).as_secs(),
            10
        );
        assert_eq!(
            interval_for(ActivityClass::Ambient, true, floor).as_secs(),
            4
        );
        let slow = Duration::from_secs(60);
        assert_eq!(
            interval_for(ActivityClass::Interactive, false, slow).as_secs(),
            60
        );
    }

    #[test]
    fn new_topics_are_due_at_once_then_aligned() {
        assert!(is_due(7, 5, None));
        assert!(!is_due(8, 5, Some(7)));
        assert!(is_due(10, 5, Some(7)));
        assert!(!is_due(10, 5, Some(10)));
    }

    #[test]
    fn backoff_doubles_and_caps() {
        assert_eq!(backoff(1).as_secs(), 5);
        assert_eq!(backoff(2).as_secs(), 10);
        assert_eq!(backoff(7).as_secs(), 300);
        assert_eq!(backoff(40).as_secs(), 300);
    }

    struct Fake {
        mode: &'static str,
    }

    const FAKE_TOPICS: &[TopicDesc] = &[TopicDesc::new("fake.value")];

    impl Provider for Fake {
        fn id(&self) -> &'static str {
            self.mode
        }
        fn topics(&self) -> &[TopicDesc] {
            FAKE_TOPICS
        }
        fn probe(&mut self) -> Probe {
            Probe::default().available("fake.value")
        }
        fn sample(&mut self, _cx: &SampleCx<'_>) -> Result<Vec<TopicUpdate>, ProviderError> {
            match self.mode {
                "panics" => panic!("sensor exploded"),
                "fails" => Err(ProviderError::Other("no such file".into())),
                _ => Ok(vec![update("fake.value", 42.0)]),
            }
        }
    }

    #[test]
    fn a_panic_becomes_an_error() {
        let (_, result, _) = run_sample(Box::new(Fake { mode: "panics" }), &["fake.value"]);
        assert_eq!(result.unwrap_err(), "sensor exploded");
    }

    #[tokio::test]
    async fn a_failing_provider_publishes_a_state_and_backs_off() {
        let hub = Hub::new(BackendKind::Instant, Vec::new());
        hub.subscribe(&Topic::new("fake.value"), ActivityClass::Interactive);
        let mut sampler = Sampler::new(hub.clone(), vec![Box::new(Fake { mode: "fails" })]);
        sampler.tick(1).await;
        assert_eq!(
            hub.latest(&Topic::new("fake.value")),
            Some(Value::unavailable("provider-failed"))
        );
        let status = hub.provider_statuses().remove("fails").unwrap();
        assert!(matches!(status.health, Health::Failed { failures: 1, .. }));
        // Within the backoff the provider isn't sampled again.
        sampler.tick(2).await;
        let status = hub.provider_statuses().remove("fails").unwrap();
        assert!(matches!(status.health, Health::Failed { failures: 1, .. }));
    }

    #[tokio::test]
    async fn only_subscribed_topics_are_sampled() {
        let hub = Hub::new(BackendKind::Instant, Vec::new());
        let mut sampler = Sampler::new(hub.clone(), vec![Box::new(Fake { mode: "works" })]);
        sampler.tick(1).await;
        assert_eq!(hub.latest(&Topic::new("fake.value")), None);
        hub.subscribe(&Topic::new("fake.value"), ActivityClass::Ambient);
        sampler.tick(2).await;
        assert_eq!(
            hub.latest(&Topic::new("fake.value")),
            Some(Value::Num(42.0))
        );
        let status = hub.provider_statuses().remove("works").unwrap();
        assert_eq!(status.samples, 1);
    }
}

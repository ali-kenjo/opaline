//! The provider contract (ARCHITECTURE §3.2).

use std::time::{Duration, Instant};

use opaline_ipc::{Availability, Topic, TopicUpdate, Value};
use serde::Serialize;

/// Describes one topic a provider can produce.
#[derive(Debug, Clone)]
pub struct TopicDesc {
    pub name: &'static str,
    /// The slowest-changing sources (drive health, weather) set a floor on how often they're
    /// sampled, whatever the subscribers ask for.
    pub min_interval: Duration,
}

impl TopicDesc {
    pub const fn new(name: &'static str) -> Self {
        Self {
            name,
            min_interval: Duration::from_secs(1),
        }
    }

    pub const fn every(name: &'static str, min_interval: Duration) -> Self {
        Self { name, min_interval }
    }
}

/// A provider's own estimate of what a sample costs. Diagnostics shows it next to the
/// measured time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Cost {
    /// A few small sysfs/procfs reads.
    Cheap,
    /// Many files or a library call (NVML, statvfs on every mount).
    Moderate,
    /// Walks `/proc` or similar.
    Expensive,
}

/// What a provider found on this machine.
#[derive(Debug, Clone, Default, Serialize)]
pub struct Probe {
    /// Per topic: `None` = available, `Some(..)` = why not.
    pub topics: Vec<(String, Option<Availability>)>,
    /// Free-form, redacted facts for `--diagnose` (sensor names, device counts, drivers).
    pub details: Vec<(String, String)>,
}

impl Probe {
    pub fn available(mut self, topic: &str) -> Self {
        self.topics.push((topic.to_owned(), None));
        self
    }

    pub fn missing(mut self, topic: &str, why: Availability) -> Self {
        self.topics.push((topic.to_owned(), Some(why)));
        self
    }

    pub fn detail(mut self, key: &str, value: impl Into<String>) -> Self {
        self.details.push((key.to_owned(), value.into()));
        self
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Other(String),
}

/// Passed to every [`Provider::sample`] call.
#[derive(Debug)]
pub struct SampleCx<'a> {
    pub now: Instant,
    /// Topics that are due this tick. A provider may skip work for the others.
    pub due: &'a [&'static str],
}

impl SampleCx<'_> {
    pub fn is_due(&self, topic: &str) -> bool {
        self.due.contains(&topic)
    }
}

/// A source of topics that is sampled on the shared tick. `sample` runs on the blocking pool
/// inside `catch_unwind`, so it may do synchronous file I/O, and a panic only disables this
/// provider for a while (ARCHITECTURE §3.2, fault isolation).
pub trait Provider: Send + 'static {
    fn id(&self) -> &'static str;
    fn topics(&self) -> &[TopicDesc];
    fn probe(&mut self) -> Probe;
    fn sample(&mut self, cx: &SampleCx<'_>) -> Result<Vec<TopicUpdate>, ProviderError>;
    fn cost_hint(&self) -> Cost {
        Cost::Cheap
    }
}

/// Shorthand for building an update.
pub fn update(topic: &str, value: impl Into<Value>) -> TopicUpdate {
    TopicUpdate {
        topic: Topic::new(topic),
        value: value.into(),
    }
}

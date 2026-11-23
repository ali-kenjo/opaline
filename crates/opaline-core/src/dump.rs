//! `opaline --dump [prefix]`: runs the sensor engine briefly and prints every topic as plain
//! JSON, to compare against reference tools (`top`, `free`, `sensors`, …; PLAN task 1.18).

use std::collections::BTreeMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use opaline_ipc::{ActivityClass, Availability, BackendKind, Topic, Value};

use crate::engine::Sampler;
use crate::hub::Hub;
use crate::providers;

/// Long enough for two ticks, so delta-based topics (CPU usage, rates) have a value.
const RUN_FOR: Duration = Duration::from_millis(2300);

pub async fn dump(prefix: Option<&str>) -> BTreeMap<String, serde_json::Value> {
    let hub = Hub::new(BackendKind::Instant, Vec::new());
    let polled = providers::polled();
    let topics: Vec<Topic> = polled
        .iter()
        .flat_map(|p| p.topics().iter().map(|t| Topic::new(t.name)))
        .chain(providers::ASYNC_TOPICS.iter().map(|t| Topic::new(*t)))
        .filter(|t| prefix.is_none_or(|p| t.as_str().starts_with(p)))
        .collect();
    for topic in &topics {
        hub.subscribe(topic, ActivityClass::Interactive);
    }
    // The visualizer's frames aren't topic values; count them instead.
    let spectrum_wanted = prefix.is_none_or(|p| providers::audio::SPECTRUM.starts_with(p));
    if spectrum_wanted {
        hub.subscribe(
            &Topic::new(providers::audio::SPECTRUM),
            ActivityClass::Interactive,
        );
    }
    let frames = Arc::new(AtomicU64::new(0));
    let loudest = Arc::new(AtomicU64::new(0));
    let counter = {
        let (frames, loudest) = (frames.clone(), loudest.clone());
        let mut rx = hub.spectrum();
        tokio::spawn(async move {
            while let Ok(f) = rx.recv().await {
                frames.fetch_add(1, Ordering::Relaxed);
                let max = u64::from(f.levels.iter().copied().max().unwrap_or(0));
                loudest.fetch_max(max, Ordering::Relaxed);
            }
        })
    };
    let sampler = tokio::spawn(Sampler::new(hub.clone(), polled).run());
    let event_driven = tokio::spawn(providers::run_async(hub.clone()));
    tokio::time::sleep(RUN_FOR).await;
    sampler.abort();
    event_driven.abort();
    let mut out: BTreeMap<String, serde_json::Value> = topics
        .iter()
        .map(|t| {
            let value = hub.latest(t).map_or(serde_json::Value::Null, |v| plain(&v));
            (t.0.clone(), value)
        })
        .collect();
    counter.abort();
    if spectrum_wanted {
        out.insert(
            providers::audio::SPECTRUM.to_owned(),
            serde_json::json!({
                "frames": frames.load(Ordering::Relaxed),
                "loudest": loudest.load(Ordering::Relaxed),
            }),
        );
    }
    let statuses = hub.provider_statuses();
    if let Ok(status) = serde_json::to_value(statuses) {
        out.insert("_providers".to_owned(), status);
    }
    out
}

/// A value as plain JSON: numbers, strings, arrays, objects; missing values as
/// `"<unavailable: reason>"`.
pub fn plain(value: &Value) -> serde_json::Value {
    use serde_json::Value as J;
    match value {
        Value::Num(n) => serde_json::Number::from_f64(*n).map_or(J::Null, J::Number),
        Value::Nums(v) => J::Array(v.iter().map(|n| plain(&Value::Num(*n))).collect()),
        Value::Text(s) => J::String(s.clone()),
        Value::Bool(b) => J::Bool(*b),
        Value::List(v) => J::Array(v.iter().map(plain).collect()),
        Value::Map(m) => J::Object(m.iter().map(|(k, v)| (k.clone(), plain(v))).collect()),
        Value::Missing(Availability::Unavailable { reason }) => {
            J::String(format!("<unavailable: {reason}>"))
        }
        Value::Missing(Availability::Asleep) => J::String("<asleep>".into()),
        Value::Missing(Availability::NeedsPermission { fix }) => {
            J::String(format!("<needs permission: {fix}>"))
        }
    }
}

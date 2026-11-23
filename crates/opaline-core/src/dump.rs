//! `opaline --dump [prefix]`: runs the sensor engine briefly and prints every topic as plain
//! JSON, to compare against reference tools (`top`, `free`, `sensors`, …; PLAN task 1.18).
//! `--diagnose` uses the same short run to report what is available.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use opaline_ipc::{ActivityClass, BackendKind, Topic};

use crate::engine::Sampler;
use crate::hub::Hub;
use crate::providers;

/// Long enough for two ticks (delta-based topics such as CPU usage need two) and a wallpaper
/// render.
const RUN_FOR: Duration = Duration::from_millis(3000);

/// Every topic name the engine knows (polled and event-driven), optionally under `prefix`.
pub fn all_topics(prefix: Option<&str>) -> Vec<Topic> {
    providers::polled()
        .iter()
        .flat_map(|p| {
            p.topics()
                .iter()
                .map(|t| Topic::new(t.name))
                .collect::<Vec<_>>()
        })
        .chain(providers::ASYNC_TOPICS.iter().map(|t| Topic::new(*t)))
        .filter(|t| prefix.is_none_or(|p| t.as_str().starts_with(p)))
        .collect()
}

/// Runs the whole engine for [`RUN_FOR`] with every topic (optionally under `prefix`)
/// subscribed. `setup` runs once the hub exists, before sampling starts.
pub async fn run_engine(
    prefix: Option<&str>,
    setup: impl FnOnce(&Arc<Hub>),
) -> (Arc<Hub>, Vec<Topic>) {
    let monitors = match zbus::Connection::session().await {
        Ok(conn) => crate::displays::current_monitors(&conn)
            .await
            .unwrap_or_default(),
        Err(_) => Vec::new(),
    };
    let hub = Hub::new(BackendKind::Instant, monitors);
    let (settings, _) = crate::store::load();
    hub.init_settings(settings, false);
    let topics = all_topics(prefix);
    for topic in &topics {
        hub.subscribe(topic, ActivityClass::Interactive);
    }
    setup(&hub);
    let sampler = tokio::spawn(Sampler::new(hub.clone(), providers::polled()).run());
    let event_driven = tokio::spawn(providers::run_async(hub.clone()));
    tokio::time::sleep(RUN_FOR).await;
    sampler.abort();
    event_driven.abort();
    (hub, topics)
}

pub async fn dump(prefix: Option<&str>) -> BTreeMap<String, serde_json::Value> {
    // The visualizer's frames aren't topic values; count them instead.
    let spectrum_wanted = prefix.is_none_or(|p| providers::audio::SPECTRUM.starts_with(p));
    let frames = Arc::new(AtomicU64::new(0));
    let loudest = Arc::new(AtomicU64::new(0));
    let mut counter = None;
    let (hub, topics) = run_engine(prefix, |hub| {
        if !spectrum_wanted {
            return;
        }
        hub.subscribe(
            &Topic::new(providers::audio::SPECTRUM),
            ActivityClass::Interactive,
        );
        let (frames, loudest) = (frames.clone(), loudest.clone());
        let mut rx = hub.spectrum();
        counter = Some(tokio::spawn(async move {
            while let Ok(f) = rx.recv().await {
                frames.fetch_add(1, Ordering::Relaxed);
                let max = u64::from(f.levels.iter().copied().max().unwrap_or(0));
                loudest.fetch_max(max, Ordering::Relaxed);
            }
        }));
    })
    .await;
    if let Some(c) = counter {
        c.abort();
    }
    let mut out: BTreeMap<String, serde_json::Value> = topics
        .iter()
        .map(|t| {
            let value = hub
                .latest(t)
                .map_or(serde_json::Value::Null, |v| crate::json::to_json(&v));
            (t.0.clone(), value)
        })
        .collect();
    if spectrum_wanted {
        out.insert(
            providers::audio::SPECTRUM.to_owned(),
            serde_json::json!({
                "frames": frames.load(Ordering::Relaxed),
                "loudest": loudest.load(Ordering::Relaxed),
            }),
        );
    }
    if let Ok(status) = serde_json::to_value(hub.provider_statuses()) {
        out.insert("_providers".to_owned(), status);
    }
    out
}

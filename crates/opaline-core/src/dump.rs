//! `opaline --dump [prefix]`: runs the sensor engine briefly and prints every topic as plain
//! JSON, to compare against reference tools (`top`, `free`, `sensors`, …; PLAN task 1.18).

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

pub async fn dump(prefix: Option<&str>) -> BTreeMap<String, serde_json::Value> {
    let monitors = match zbus::Connection::session().await {
        Ok(conn) => crate::displays::current_monitors(&conn)
            .await
            .unwrap_or_default(),
        Err(_) => Vec::new(),
    };
    let hub = Hub::new(BackendKind::Instant, monitors);
    let (settings, _) = crate::store::load();
    hub.init_settings(settings, false);
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
            let value = hub
                .latest(t)
                .map_or(serde_json::Value::Null, |v| crate::json::to_json(&v));
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

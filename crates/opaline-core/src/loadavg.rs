//! `system.loadavg`: the 1/5/15-minute load averages from `/proc/loadavg`.
//!
//! This is the first real topic, used to prove the core → layer path in Phase 0. The provider
//! framework of Phase 1 adopts it as part of the CPU provider.

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use opaline_ipc::{Availability, Topic, TopicUpdate, UpdateBatch, Value};

use crate::hub::Hub;

pub const TOPIC: &str = "system.loadavg";
const PATH: &str = "/proc/loadavg";

/// Parses the first three fields of `/proc/loadavg`.
pub fn parse(content: &str) -> Option<[f64; 3]> {
    let mut fields = content.split_ascii_whitespace();
    let mut next = || {
        fields
            .next()?
            .parse::<f64>()
            .ok()
            .filter(|v| v.is_finite() && *v >= 0.0)
    };
    Some([next()?, next()?, next()?])
}

fn sample() -> Value {
    match std::fs::read_to_string(PATH)
        .ok()
        .as_deref()
        .and_then(parse)
    {
        Some(values) => Value::Nums(values.to_vec()),
        None => Value::Missing(Availability::Unavailable {
            reason: "loadavg-unreadable".into(),
        }),
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

/// Samples once per second while someone is subscribed, and sleeps without waking up at all
/// while nobody is.
pub async fn run(hub: Arc<Hub>) {
    let topic = Topic::new(TOPIC);
    let mut seq = 0u64;
    let mut changes = hub.watch_subscriptions();
    loop {
        changes.mark_unchanged();
        if !hub.is_subscribed(TOPIC) {
            if changes.changed().await.is_err() {
                return; // the hub is gone: core is shutting down
            }
            continue;
        }
        seq += 1;
        hub.publish(UpdateBatch {
            seq,
            at_ms: now_ms(),
            updates: vec![TopicUpdate {
                topic: topic.clone(),
                value: sample(),
            }],
        });
        tokio::select! {
            () = tokio::time::sleep(Duration::from_secs(1)) => {}
            _ = changes.changed() => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_proc_loadavg() {
        assert_eq!(
            parse("0.52 0.58 0.59 2/1234 98765\n"),
            Some([0.52, 0.58, 0.59])
        );
    }

    #[test]
    fn rejects_garbage() {
        assert_eq!(parse(""), None);
        assert_eq!(parse("0.1 0.2"), None);
        assert_eq!(parse("a b c"), None);
        assert_eq!(parse("-1 0 0"), None);
        assert_eq!(parse("NaN 0 0"), None);
    }
}

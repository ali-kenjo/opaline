//! CPU package power from the RAPL energy counters, through the optional privileged helper
//! (`opaline-privileged`), only when the user turned on "Show CPU power" (brief §5.6, §6 "CPU").

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use opaline_ipc::{Availability, TopicUpdate, Value};
use zbus::Connection;

use crate::engine::{update, while_subscribed};
use crate::hub::Hub;

pub const POWER: &str = "cpu.power";
pub const PACKAGE_W: &str = "cpu.packagePower";
pub const TOPICS: &[&str] = &[POWER, PACKAGE_W];
const PERIOD: Duration = Duration::from_secs(2);
const SERVICE: &str = "io.github.ali_kenjo.Opaline.Privileged";

/// Joules counters wrap at `max_energy_range_uj`.
pub fn energy_delta(prev: u64, cur: u64, max: u64) -> u64 {
    if cur >= prev {
        cur - prev
    } else {
        cur + max.saturating_sub(prev)
    }
}

/// Watts per domain between two readings. Domains are keyed by name plus position, since
/// `package-0` and `core` repeat across sockets.
pub fn watts(
    prev: &[(String, u64, u64)],
    cur: &[(String, u64, u64)],
    secs: f64,
) -> Vec<(String, f64)> {
    if secs <= 0.0 || prev.len() != cur.len() {
        return Vec::new();
    }
    prev.iter()
        .zip(cur)
        .filter(|(p, c)| p.0 == c.0)
        .map(|(p, c)| (c.0.clone(), energy_delta(p.1, c.1, c.2) as f64 / 1e6 / secs))
        .collect()
}

/// `(domain, energy_uj, max_energy_range_uj)` per zone, as the helper returns them.
type Zones = Vec<(String, u64, u64)>;

#[derive(Debug, Default)]
struct Last {
    reading: Option<(Zones, Instant)>,
}

fn missing(why: Availability) -> Vec<TopicUpdate> {
    TOPICS
        .iter()
        .map(|t| update(t, Value::Missing(why.clone())))
        .collect()
}

async fn fetch(
    conn: &Connection,
    hub: &Hub,
    last: &Mutex<Last>,
) -> Result<Vec<TopicUpdate>, String> {
    if !hub.settings().privacy.privileged_sensors {
        last.lock().unwrap_or_else(PoisonError::into_inner).reading = None;
        return Ok(missing(Availability::NeedsPermission {
            fix: "enable-cpu-power".into(),
        }));
    }
    let reply = conn
        .call_method(
            Some(SERVICE),
            "/io/github/ali_kenjo/Opaline/Privileged",
            Some("io.github.ali_kenjo.Opaline.Privileged1"),
            "GetCpuEnergy",
            &(),
        )
        .await;
    let cur: Zones = match reply {
        Ok(m) => m.body().deserialize().map_err(|e| e.to_string())?,
        Err(error) => {
            // zbus reports D-Bus errors as different variants; the error name is what counts.
            let text = format!("{error:?}");
            if text.contains("ServiceUnknown") || text.contains("NameHasNoOwner") {
                return Ok(missing(Availability::Unavailable {
                    reason: "helper-not-installed".into(),
                }));
            }
            if text.contains("AccessDenied") {
                return Ok(missing(Availability::NeedsPermission {
                    fix: "polkit-denied".into(),
                }));
            }
            return Err(error.to_string());
        }
    };
    let now = Instant::now();
    let mut guard = last.lock().unwrap_or_else(PoisonError::into_inner);
    let result = match &guard.reading {
        Some((prev, at)) => {
            let w = watts(prev, &cur, now.duration_since(*at).as_secs_f64());
            let package: f64 = w
                .iter()
                .filter(|(n, _)| n.starts_with("package"))
                .map(|(_, w)| w)
                .sum();
            let mut by_name: HashMap<String, f64> = HashMap::new();
            for (n, v) in &w {
                *by_name.entry(n.clone()).or_default() += v;
            }
            vec![
                update(
                    POWER,
                    Value::Map(
                        by_name
                            .into_iter()
                            .map(|(k, v)| (k, Value::Num(v)))
                            .collect(),
                    ),
                ),
                update(PACKAGE_W, package),
            ]
        }
        None => Vec::new(),
    };
    guard.reading = Some((cur, now));
    Ok(result)
}

pub async fn run(hub: Arc<Hub>) -> Result<(), String> {
    let conn = Connection::system().await.map_err(|e| e.to_string())?;
    let last = Arc::new(Mutex::new(Last::default()));
    while_subscribed(&hub, TOPICS, PERIOD, || {
        let (conn, hub, last) = (conn.clone(), hub.clone(), last.clone());
        async move { fetch(&conn, &hub, &last).await }
    })
    .await
}

#[cfg(test)]
mod tests {
    #![allow(clippy::float_cmp)]

    use super::*;

    #[test]
    fn wraparound_and_watts() {
        assert_eq!(energy_delta(100, 300, 1000), 200);
        assert_eq!(energy_delta(900, 100, 1000), 200, "counter wrapped");
        let prev = vec![
            ("package-0".to_owned(), 1_000_000, 262_143_328_850),
            ("core".to_owned(), 0, 262_143_328_850),
        ];
        let cur = vec![
            ("package-0".to_owned(), 11_000_000, 262_143_328_850),
            ("core".to_owned(), 4_000_000, 262_143_328_850),
        ];
        assert_eq!(
            watts(&prev, &cur, 2.0),
            vec![("package-0".to_owned(), 5.0), ("core".to_owned(), 2.0)]
        );
        assert!(
            watts(&prev, &cur[..1], 2.0).is_empty(),
            "zones changed: no reading"
        );
    }
}

//! Alerts: rules over numeric series with hysteresis, a minimum duration and a cooldown,
//! desktop notifications with "Open" and "Snooze 1 h", and the active alerts for widgets
//! (ARCHITECTURE §3.5). Rule topics are sampled even without a widget, at the Idle rate.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use opaline_ipc::{ActivityClass, CoreEvent, Topic, Value};
use serde::{Deserialize, Serialize};
use zbus::{Connection, MatchRule, MessageStream, Variant};

use crate::engine::update;
use crate::history::series_names;
use crate::hub::{Hub, now_ms};

pub const ACTIVE: &str = "alerts.active";
const SNOOZE: Duration = Duration::from_secs(3600);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Comparator {
    Above,
    Below,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub id: String,
    /// A numeric series: `cpu.temp`, `memory.percent`, `cpu.perThread#0`.
    pub series: String,
    pub comparator: Comparator,
    pub threshold: f64,
    /// The value that ends the alert (hysteresis). Defaults to 5 % of the threshold back.
    #[serde(default)]
    pub clear: Option<f64>,
    /// How long the condition must hold before firing.
    #[serde(default)]
    pub for_s: u64,
    /// After an alert ends, no new notification for this long.
    #[serde(default = "default_cooldown")]
    pub cooldown_s: u64,
    #[serde(default = "yes")]
    pub enabled: bool,
}

fn default_cooldown() -> u64 {
    900
}

fn yes() -> bool {
    true
}

impl Rule {
    pub fn topic(&self) -> &str {
        self.series.split('#').next().unwrap_or(&self.series)
    }

    fn triggered(&self, v: f64) -> bool {
        match self.comparator {
            Comparator::Above => v >= self.threshold,
            Comparator::Below => v <= self.threshold,
        }
    }

    fn cleared(&self, v: f64) -> bool {
        let margin = self.threshold.abs() * 0.05;
        match self.comparator {
            Comparator::Above => v < self.clear.unwrap_or(self.threshold - margin),
            Comparator::Below => v > self.clear.unwrap_or(self.threshold + margin),
        }
    }
}

/// The rules a fresh install starts with.
pub fn default_rules() -> Vec<Rule> {
    vec![
        Rule {
            id: "cpu-hot".into(),
            series: "cpu.temp".into(),
            comparator: Comparator::Above,
            threshold: 95.0,
            clear: Some(85.0),
            for_s: 30,
            cooldown_s: 900,
            enabled: true,
        },
        Rule {
            id: "battery-low".into(),
            series: "power.batteryPercent".into(),
            comparator: Comparator::Below,
            threshold: 10.0,
            clear: Some(15.0),
            for_s: 0,
            cooldown_s: 1800,
            enabled: true,
        },
    ]
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum State {
    Normal,
    Pending { since_s: u64 },
    Firing { since_s: u64 },
    Cooldown { until_s: u64 },
}

/// What a new value does to a rule's state; `true` = send a notification now.
pub fn step(rule: &Rule, state: State, v: f64, now_s: u64) -> (State, bool) {
    match state {
        State::Normal | State::Cooldown { .. } if !rule.triggered(v) => match state {
            State::Cooldown { until_s } if now_s < until_s => (state, false),
            _ => (State::Normal, false),
        },
        State::Cooldown { until_s } if now_s < until_s => (state, false),
        State::Normal | State::Cooldown { .. } => {
            if rule.for_s == 0 {
                (State::Firing { since_s: now_s }, true)
            } else {
                (State::Pending { since_s: now_s }, false)
            }
        }
        State::Pending { since_s } => {
            if !rule.triggered(v) {
                (State::Normal, false)
            } else if now_s.saturating_sub(since_s) >= rule.for_s {
                (State::Firing { since_s: now_s }, true)
            } else {
                (state, false)
            }
        }
        State::Firing { since_s } => {
            if rule.cleared(v) {
                (
                    State::Cooldown {
                        until_s: now_s + rule.cooldown_s,
                    },
                    false,
                )
            } else {
                (State::Firing { since_s }, false)
            }
        }
    }
}

/// Notification text. Core-side strings are English until the Phase 7 translations.
fn message(rule: &Rule, v: f64) -> (String, String) {
    let what = match rule.topic() {
        "cpu.temp" => "CPU temperature",
        "power.batteryPercent" => "Battery",
        "memory.percent" => "Memory use",
        t if t.starts_with("gpu.") && t.ends_with(".temp") => "GPU temperature",
        t => t,
    };
    let unit = if rule.topic().ends_with("temp") {
        " °C"
    } else if rule.topic().ends_with("ercent") {
        " %"
    } else {
        ""
    };
    let dir = match rule.comparator {
        Comparator::Above => "above",
        Comparator::Below => "below",
    };
    (
        format!("{what} is {v:.0}{unit}"),
        format!("It has been {dir} {:.0}{unit}.", rule.threshold),
    )
}

async fn notify(conn: &Connection, rule: &Rule, v: f64) -> Option<u32> {
    let (summary, body) = message(rule, v);
    let mut hints: HashMap<&str, Variant<'_>> = HashMap::new();
    hints.insert(
        "desktop-entry",
        Variant::from("io.github.ali_kenjo.Opaline"),
    );
    hints.insert("urgency", Variant::from(2u8));
    let actions = vec!["open", "Open", "snooze", "Snooze 1 h"];
    conn.call_method(
        Some("org.freedesktop.Notifications"),
        "/org/freedesktop/Notifications",
        Some("org.freedesktop.Notifications"),
        "Notify",
        &(
            "Opaline",
            0u32,
            "io.github.ali_kenjo.Opaline",
            summary.as_str(),
            body.as_str(),
            actions,
            hints,
            -1i32,
        ),
    )
    .await
    .ok()?
    .body()
    .deserialize::<u32>()
    .ok()
}

struct Engine {
    rules: Vec<Rule>,
    states: HashMap<String, State>,
    values: HashMap<String, f64>,
    snoozed: HashMap<String, u64>,
    /// Notification id → rule id, for the action buttons.
    notifications: HashMap<u32, String>,
    subscribed: HashSet<Topic>,
}

impl Engine {
    fn resubscribe(&mut self, hub: &Hub) {
        let wanted: HashSet<Topic> = self
            .rules
            .iter()
            .filter(|r| r.enabled)
            .map(|r| Topic::new(r.topic()))
            .collect();
        for t in self.subscribed.difference(&wanted) {
            hub.unsubscribe(t, ActivityClass::Idle);
        }
        for t in wanted.difference(&self.subscribed) {
            hub.subscribe(t, ActivityClass::Idle);
        }
        self.subscribed = wanted;
        self.states
            .retain(|id, _| self.rules.iter().any(|r| &r.id == id));
    }

    fn active(&self) -> Value {
        Value::List(
            self.rules
                .iter()
                .filter_map(|r| match self.states.get(&r.id) {
                    Some(State::Firing { since_s }) => Some(Value::map([
                        ("id", Value::from(r.id.as_str())),
                        ("series", Value::from(r.series.as_str())),
                        ("value", Value::from(self.values.get(&r.series).copied())),
                        ("sinceMs", Value::Num((*since_s * 1000) as f64)),
                    ])),
                    _ => None,
                })
                .collect(),
        )
    }
}

pub async fn run(hub: Arc<Hub>) -> Result<(), String> {
    let conn = Connection::session().await.map_err(|e| e.to_string())?;
    let rule = MatchRule::builder()
        .msg_type(zbus::message::Type::Signal)
        .interface("org.freedesktop.Notifications")
        .member("ActionInvoked")
        .build()
        .map_err(|e| e.to_string())?;
    let mut actions = MessageStream::for_match_rule(rule, &conn, None)
        .await
        .map_err(|e| e.to_string())?;
    let mut updates = hub.updates();
    let mut settings = hub.watch_settings();
    let mut engine = Engine {
        rules: hub.settings().alerts.clone(),
        states: HashMap::new(),
        values: HashMap::new(),
        snoozed: HashMap::new(),
        notifications: HashMap::new(),
        subscribed: HashSet::new(),
    };
    engine.resubscribe(&hub);
    loop {
        tokio::select! {
            changed = settings.changed() => {
                changed.map_err(|_| "hub closed".to_owned())?;
                engine.rules = hub.settings().alerts.clone();
                engine.resubscribe(&hub);
            }
            batch = updates.recv() => {
                let batch = match batch {
                    Ok(b) => b,
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => return Ok(()),
                };
                let now_s = batch.at_ms / 1000;
                let mut changed = false;
                for u in &batch.updates {
                    for (series, v) in series_names(u.topic.as_str(), &u.value) {
                        engine.values.insert(series.clone(), f64::from(v));
                        for r in engine.rules.iter().filter(|r| r.enabled && r.series == series) {
                            let before = engine.states.get(&r.id).copied().unwrap_or(State::Normal);
                            let (after, fire) = step(r, before, f64::from(v), now_s);
                            changed |= std::mem::discriminant(&before) != std::mem::discriminant(&after);
                            engine.states.insert(r.id.clone(), after);
                            let snoozed = engine.snoozed.get(&r.id).is_some_and(|until| now_s < *until);
                            if fire && !snoozed {
                                tracing::info!(rule = %r.id, value = v, "alert firing");
                                if let Some(id) = notify(&conn, r, f64::from(v)).await {
                                    engine.notifications.insert(id, r.id.clone());
                                }
                            }
                        }
                    }
                }
                if changed {
                    hub.publish(vec![update(ACTIVE, engine.active())]);
                }
            }
            Some(Ok(msg)) = actions.next() => {
                if let Ok((id, action)) = msg.body().deserialize::<(u32, String)>()
                    && let Some(rule) = engine.notifications.get(&id).cloned()
                {
                    match action.as_str() {
                        "snooze" => {
                            engine.snoozed.insert(rule, now_ms() / 1000 + SNOOZE.as_secs());
                        }
                        "open" | "default" => hub.emit(CoreEvent::AlertOpened { rule }),
                        _ => {}
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hot() -> Rule {
        Rule {
            id: "hot".into(),
            series: "cpu.temp".into(),
            comparator: Comparator::Above,
            threshold: 90.0,
            clear: Some(80.0),
            for_s: 10,
            cooldown_s: 60,
            enabled: true,
        }
    }

    #[test]
    fn needs_duration_then_fires_once() {
        let r = hot();
        let (s, fire) = step(&r, State::Normal, 95.0, 100);
        assert_eq!((s, fire), (State::Pending { since_s: 100 }, false));
        let (s, fire) = step(&r, s, 95.0, 105);
        assert!(!fire, "not held long enough");
        let (s, fire) = step(&r, s, 95.0, 110);
        assert_eq!((s, fire), (State::Firing { since_s: 110 }, true));
        let (s, fire) = step(&r, s, 99.0, 120);
        assert!(!fire, "still firing: no second notification");
        assert!(matches!(s, State::Firing { .. }));
    }

    #[test]
    fn hysteresis_and_cooldown() {
        let r = hot();
        let firing = State::Firing { since_s: 0 };
        let (s, _) = step(&r, firing, 85.0, 10);
        assert!(
            matches!(s, State::Firing { .. }),
            "85 is below 90 but not below the clear value 80"
        );
        let (s, _) = step(&r, s, 79.0, 20);
        assert_eq!(s, State::Cooldown { until_s: 80 });
        let (s, fire) = step(&r, s, 95.0, 30);
        assert_eq!(
            (s, fire),
            (State::Cooldown { until_s: 80 }, false),
            "within the cooldown"
        );
        let (s, _) = step(&r, s, 95.0, 90);
        assert_eq!(
            s,
            State::Pending { since_s: 90 },
            "after the cooldown it can start again"
        );
        let (s, _) = step(&r, State::Pending { since_s: 0 }, 70.0, 5);
        assert_eq!(s, State::Normal, "a dip resets the pending timer");
    }

    #[test]
    fn below_rules_and_immediate_firing() {
        let r = Rule {
            for_s: 0,
            ..default_rules()
                .into_iter()
                .find(|r| r.id == "battery-low")
                .unwrap_or_else(hot)
        };
        assert_eq!(
            step(&r, State::Normal, 9.0, 0),
            (State::Firing { since_s: 0 }, true)
        );
        assert_eq!(
            step(&r, State::Firing { since_s: 0 }, 12.0, 5).0,
            State::Firing { since_s: 0 }
        );
        assert!(matches!(
            step(&r, State::Firing { since_s: 0 }, 16.0, 5).0,
            State::Cooldown { .. }
        ));
    }

    #[test]
    fn messages() {
        let (summary, body) = message(&hot(), 96.4);
        assert_eq!(summary, "CPU temperature is 96 °C");
        assert_eq!(body, "It has been above 90 °C.");
    }
}

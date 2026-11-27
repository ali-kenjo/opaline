//! Core-owned Timers, Stopwatch (with laps), and Pomodoro (with work/break cycles and daily
//! count) that survive layer restarts and send a desktop notification + light event sound on
//! completion (brief §8.3, PLAN-2 task 7.3).

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use opaline_ipc::{Topic, TopicUpdate, Value};
use serde::{Deserialize, Serialize};
use tokio::process::Command;

use crate::hub::Hub;

pub const STATE: &str = "timers.state";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TimerKind {
    Timer,
    Stopwatch,
    Pomodoro,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerEntry {
    pub id: String,
    pub label: String,
    pub kind: TimerKind,
    pub duration_ms: u64,
    pub remaining_ms: u64,
    pub elapsed_ms: u64,
    pub running: bool,
    pub laps_ms: Vec<u64>,
    pub pomo_phase: String,
    pub pomo_work_ms: u64,
    pub pomo_break_ms: u64,
    pub pomo_completed_today: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TimerStore {
    items: Vec<TimerEntry>,
    day_key: String,
}

static STORE: OnceLock<Mutex<TimerStore>> = OnceLock::new();

fn today_key() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn timers_path() -> Option<PathBuf> {
    crate::paths::data_dir().ok().map(|d| d.join("timers.json"))
}

fn default_timers() -> TimerStore {
    TimerStore {
        day_key: today_key(),
        items: vec![
            TimerEntry {
                id: "pomodoro".into(),
                label: "Focus".into(),
                kind: TimerKind::Pomodoro,
                duration_ms: 25 * 60 * 1000,
                remaining_ms: 25 * 60 * 1000,
                elapsed_ms: 0,
                running: false,
                laps_ms: Vec::new(),
                pomo_phase: "work".into(),
                pomo_work_ms: 25 * 60 * 1000,
                pomo_break_ms: 5 * 60 * 1000,
                pomo_completed_today: 0,
            },
            TimerEntry {
                id: "timer-1".into(),
                label: "Tea".into(),
                kind: TimerKind::Timer,
                duration_ms: 5 * 60 * 1000,
                remaining_ms: 5 * 60 * 1000,
                elapsed_ms: 0,
                running: false,
                laps_ms: Vec::new(),
                pomo_phase: "work".into(),
                pomo_work_ms: 25 * 60 * 1000,
                pomo_break_ms: 5 * 60 * 1000,
                pomo_completed_today: 0,
            },
            TimerEntry {
                id: "stopwatch".into(),
                label: "Stopwatch".into(),
                kind: TimerKind::Stopwatch,
                duration_ms: 0,
                remaining_ms: 0,
                elapsed_ms: 0,
                running: false,
                laps_ms: Vec::new(),
                pomo_phase: "work".into(),
                pomo_work_ms: 25 * 60 * 1000,
                pomo_break_ms: 5 * 60 * 1000,
                pomo_completed_today: 0,
            },
        ],
    }
}

fn load_store(path: &Path) -> TimerStore {
    std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice::<TimerStore>(&b).ok())
        .filter(|s| !s.items.is_empty())
        .unwrap_or_else(default_timers)
}

fn save_store(store: &TimerStore) {
    if let Some(path) = timers_path()
        && let Ok(bytes) = serde_json::to_vec_pretty(store)
    {
        let _ = crate::paths::write_atomic(&path, &bytes);
    }
}

fn global_store() -> &'static Mutex<TimerStore> {
    STORE.get_or_init(|| {
        let initial = timers_path()
            .map(|p| load_store(&p))
            .unwrap_or_else(default_timers);
        Mutex::new(initial)
    })
}

fn store_to_value(store: &TimerStore) -> Value {
    let json = serde_json::to_value(store).unwrap_or(serde_json::Value::Null);
    crate::json::from_json(&json)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

/// Applies one validated timer/stopwatch/pomodoro action and publishes the updated `timers.state`.
pub fn apply_action(
    hub: &Hub,
    action: &str,
    id: &str,
    label: Option<&str>,
    duration_s: Option<u64>,
    kind: Option<&str>,
) -> Result<(), String> {
    let snapshot = {
        let mut st = global_store()
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let today = today_key();
        if st.day_key != today {
            st.day_key = today;
            for item in &mut st.items {
                item.pomo_completed_today = 0;
            }
        }

        match action {
            "start" => {
                let item = st
                    .items
                    .iter_mut()
                    .find(|i| i.id == id)
                    .ok_or_else(|| format!("unknown-timer: {id}"))?;
                if item.kind != TimerKind::Stopwatch && item.remaining_ms == 0 {
                    item.remaining_ms = item.duration_ms.max(1000);
                }
                item.running = true;
            }
            "pause" => {
                let item = st
                    .items
                    .iter_mut()
                    .find(|i| i.id == id)
                    .ok_or_else(|| format!("unknown-timer: {id}"))?;
                item.running = false;
            }
            "reset" => {
                let item = st
                    .items
                    .iter_mut()
                    .find(|i| i.id == id)
                    .ok_or_else(|| format!("unknown-timer: {id}"))?;
                item.running = false;
                item.elapsed_ms = 0;
                item.laps_ms.clear();
                item.remaining_ms = if item.kind == TimerKind::Pomodoro {
                    if item.pomo_phase == "break" {
                        item.pomo_break_ms
                    } else {
                        item.pomo_work_ms
                    }
                } else {
                    item.duration_ms
                };
            }
            "lap" => {
                let item = st
                    .items
                    .iter_mut()
                    .find(|i| i.id == id)
                    .ok_or_else(|| format!("unknown-timer: {id}"))?;
                if item.laps_ms.len() < 50 {
                    item.laps_ms.push(item.elapsed_ms);
                }
            }
            "next-phase" => {
                let item = st
                    .items
                    .iter_mut()
                    .find(|i| i.id == id)
                    .ok_or_else(|| format!("unknown-timer: {id}"))?;
                item.running = false;
                if item.pomo_phase == "work" {
                    item.pomo_phase = "break".into();
                    item.duration_ms = item.pomo_break_ms;
                    item.remaining_ms = item.pomo_break_ms;
                } else {
                    item.pomo_phase = "work".into();
                    item.duration_ms = item.pomo_work_ms;
                    item.remaining_ms = item.pomo_work_ms;
                }
            }
            "add" => {
                if st.items.len() >= 12 {
                    return Err("too-many-timers".into());
                }
                let k = match kind.unwrap_or("timer") {
                    "stopwatch" => TimerKind::Stopwatch,
                    "pomodoro" => TimerKind::Pomodoro,
                    _ => TimerKind::Timer,
                };
                let dur_ms = duration_s.unwrap_or(300).clamp(5, 86_400) * 1000;
                let new_id = if id.trim().is_empty() {
                    format!("timer-{}", now_ms() % 100_000)
                } else {
                    id.trim().to_owned()
                };
                st.items.push(TimerEntry {
                    id: new_id,
                    label: label.unwrap_or("Timer").trim().to_owned(),
                    kind: k,
                    duration_ms: dur_ms,
                    remaining_ms: dur_ms,
                    elapsed_ms: 0,
                    running: false,
                    laps_ms: Vec::new(),
                    pomo_phase: "work".into(),
                    pomo_work_ms: 25 * 60 * 1000,
                    pomo_break_ms: 5 * 60 * 1000,
                    pomo_completed_today: 0,
                });
            }
            "delete" => {
                st.items.retain(|i| i.id != id);
            }
            other => return Err(format!("unknown-timer-action: {other}")),
        }
        save_store(&st);
        store_to_value(&st)
    };

    hub.publish(vec![TopicUpdate {
        topic: Topic::new(STATE),
        value: snapshot,
    }]);
    Ok(())
}

/// Advances running timers by `delta_ms` and returns labels of any timers that just finished.
fn tick_store(store: &mut TimerStore, delta_ms: u64) -> (bool, Vec<String>) {
    let mut changed = false;
    let mut finished = Vec::new();
    for item in &mut store.items {
        if !item.running {
            continue;
        }
        changed = true;
        match item.kind {
            TimerKind::Stopwatch => {
                item.elapsed_ms = item.elapsed_ms.saturating_add(delta_ms);
            }
            TimerKind::Timer => {
                item.remaining_ms = item.remaining_ms.saturating_sub(delta_ms);
                if item.remaining_ms == 0 {
                    item.running = false;
                    finished.push(item.label.clone());
                }
            }
            TimerKind::Pomodoro => {
                item.remaining_ms = item.remaining_ms.saturating_sub(delta_ms);
                if item.remaining_ms == 0 {
                    item.running = false;
                    if item.pomo_phase == "work" {
                        item.pomo_completed_today += 1;
                        item.pomo_phase = "break".into();
                        item.duration_ms = item.pomo_break_ms;
                        item.remaining_ms = item.pomo_break_ms;
                        finished.push(format!("{} (Work complete)", item.label));
                    } else {
                        item.pomo_phase = "work".into();
                        item.duration_ms = item.pomo_work_ms;
                        item.remaining_ms = item.pomo_work_ms;
                        finished.push(format!("{} (Break complete)", item.label));
                    }
                }
            }
        }
    }
    (changed, finished)
}

async fn notify_timer_done(label: &str) {
    // Desktop notification via freedesktop Notifications D-Bus interface.
    if let Ok(conn) = zbus::Connection::session().await
        && let Ok(proxy) = zbus::Proxy::new(
            &conn,
            "org.freedesktop.Notifications",
            "/org/freedesktop/Notifications",
            "org.freedesktop.Notifications",
        )
        .await
    {
        let hints: std::collections::HashMap<&str, zbus::Variant<'_>> =
            std::collections::HashMap::new();
        let actions: Vec<&str> = Vec::new();
        let _: Result<u32, _> = proxy
            .call(
                "Notify",
                &(
                    "Opaline",
                    0u32,
                    "alarm-symbolic",
                    "Timer complete",
                    label,
                    actions,
                    hints,
                    8000i32,
                ),
            )
            .await;
    }
    // Lightweight freedesktop event sound (Spike S-sound: non-blocking, silent if unavailable).
    let _ = Command::new("canberra-gtk-play")
        .args(["-i", "complete", "-d", "Opaline timer"])
        .spawn();
}

pub async fn run(hub: Arc<Hub>) -> Result<(), String> {
    // Publish initial state immediately so widgets show persisted timers right away.
    let initial = {
        let st = global_store()
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        store_to_value(&st)
    };
    hub.publish(vec![TopicUpdate {
        topic: Topic::new(STATE),
        value: initial,
    }]);

    let mut tick = tokio::time::interval(Duration::from_secs(1));
    loop {
        tick.tick().await;
        let (changed, finished, val) = {
            let mut st = global_store()
                .lock()
                .unwrap_or_else(PoisonError::into_inner);
            let (changed, finished) = tick_store(&mut st, 1000);
            if !finished.is_empty() {
                save_store(&st);
            }
            (changed, finished, changed.then(|| store_to_value(&st)))
        };
        if changed && let Some(v) = val {
            hub.publish(vec![TopicUpdate {
                topic: Topic::new(STATE),
                value: v,
            }]);
        }
        for label in finished {
            notify_timer_done(&label).await;
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    #[test]
    fn ticks_timer_stopwatch_and_pomodoro_cycles() {
        let mut st = default_timers();
        st.items[0].running = true;
        st.items[0].remaining_ms = 2000;
        st.items[2].running = true;

        let (changed, done1) = tick_store(&mut st, 1000);
        assert!(changed);
        assert!(done1.is_empty());
        assert_eq!(st.items[0].remaining_ms, 1000);
        assert_eq!(st.items[2].elapsed_ms, 1000);

        let (_, done2) = tick_store(&mut st, 1000);
        assert_eq!(done2.len(), 1);
        assert_eq!(st.items[0].pomo_completed_today, 1);
        assert_eq!(st.items[0].pomo_phase, "break");
        assert!(!st.items[0].running);
    }
}

//! Core-owned Timers, Stopwatch (with laps), and Pomodoro (with work/break cycles and daily
//! count) that survive layer restarts and send a desktop notification + light event sound on
//! completion (brief §8.3, PLAN-2 task 7.3).
//!
//! Running entries follow the wall clock: each keeps the time it ends (timer, Pomodoro phase) or
//! the time it would have started (stopwatch) in `timers.json`, and every tick derives
//! `remainingMs`/`elapsedMs` from that. A late tick, a suspended laptop (the monotonic interval
//! stops while asleep) and a core restart therefore lose no time, and a timer that ran out
//! meanwhile finishes once, on the first tick after.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use opaline_ipc::{Topic, TopicUpdate, Value};
use serde::{Deserialize, Serialize};
use tokio::process::Command;

use crate::hub::Hub;

pub const STATE: &str = "timers.state";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TimerKind {
    #[default]
    Timer,
    Stopwatch,
    Pomodoro,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
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
    /// While a timer or Pomodoro phase runs: when it ends (wall clock, ms since the epoch).
    /// Persisted only; `timers.state` doesn't carry it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ends_at_ms: Option<u64>,
    /// While a stopwatch runs: the wall-clock time it would have started at to show
    /// `elapsed_ms` now (re-based on every resume). Persisted only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at_ms: Option<u64>,
}

/// A countdown that ran out by more than this before a tick saw it finished while the machine
/// slept or core wasn't running.
const LATE_MS: u64 = 5_000;

impl TimerEntry {
    fn counts_down(&self) -> bool {
        self.kind != TimerKind::Stopwatch
    }

    /// Starts (or resumes) from `now`: anchors the shown value to the wall clock.
    fn run_from(&mut self, now: u64) {
        self.running = true;
        if self.counts_down() {
            self.ends_at_ms = Some(now.saturating_add(self.remaining_ms));
            self.started_at_ms = None;
        } else {
            self.started_at_ms = Some(now.saturating_sub(self.elapsed_ms));
            self.ends_at_ms = None;
        }
    }

    fn stop(&mut self) {
        self.running = false;
        self.ends_at_ms = None;
        self.started_at_ms = None;
    }

    /// Brings `remaining_ms`/`elapsed_ms` of a running entry up to `now` (finishing is the
    /// tick's job). Returns true when the anchor had to be set again: it was missing (a file
    /// from before anchors) or the wall clock went backwards, which pauses the entry for that
    /// step instead of running it backwards.
    fn sync(&mut self, now: u64) -> bool {
        if !self.running {
            return false;
        }
        if self.counts_down() {
            match self.ends_at_ms {
                Some(end) if end.saturating_sub(now) <= self.remaining_ms => {
                    self.remaining_ms = end.saturating_sub(now);
                    false
                }
                _ => {
                    self.run_from(now);
                    true
                }
            }
        } else {
            match self.started_at_ms {
                Some(start) if now.saturating_sub(start) >= self.elapsed_ms => {
                    self.elapsed_ms = now.saturating_sub(start);
                    false
                }
                _ => {
                    self.run_from(now);
                    true
                }
            }
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TimerStore {
    pub items: Vec<TimerEntry>,
    pub day_key: String,
}

/// A countdown that ran out during a tick.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Finished {
    /// What the notification says.
    pub label: String,
    /// When it ran out (wall clock, ms).
    pub ended_at_ms: u64,
    /// It ran out well before this tick: while the machine slept or core wasn't running.
    pub late: bool,
}

/// What one tick changed.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Tick {
    /// Something runs, so the shown values moved.
    pub changed: bool,
    /// The file is out of date (something finished, or an anchor was set again).
    pub save: bool,
    pub finished: Vec<Finished>,
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
                ..TimerEntry::default()
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
                ..TimerEntry::default()
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
                ..TimerEntry::default()
            },
        ],
    }
}

/// Reads `timers.json` (defaults when it is missing, unreadable or empty). Running entries
/// keep their anchors, so the first tick accounts for the time core was down; an entry from a
/// file written before anchors existed resumes from `now` with its saved value.
pub fn load_store(path: &Path, now: u64) -> TimerStore {
    let mut store = std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice::<TimerStore>(&b).ok())
        .filter(|s| !s.items.is_empty())
        .unwrap_or_else(default_timers);
    for item in &mut store.items {
        let anchored = if item.counts_down() {
            item.ends_at_ms.is_some()
        } else {
            item.started_at_ms.is_some()
        };
        if item.running && !anchored {
            item.run_from(now);
        }
    }
    store
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
            .map(|p| load_store(&p, now_ms()))
            .unwrap_or_else(default_timers);
        Mutex::new(initial)
    })
}

/// `timers.state` as widgets, the SDK and custom widgets know it (without the anchors).
fn store_to_value(store: &TimerStore) -> Value {
    let mut shown = store.clone();
    for item in &mut shown.items {
        item.ends_at_ms = None;
        item.started_at_ms = None;
    }
    let json = serde_json::to_value(&shown).unwrap_or(serde_json::Value::Null);
    crate::json::from_json(&json)
}

/// A new local day resets the Pomodoro counters. Returns whether it did.
fn roll_day(store: &mut TimerStore, today: &str) -> bool {
    if store.day_key == today {
        return false;
    }
    store.day_key = today.to_owned();
    for item in &mut store.items {
        item.pomo_completed_today = 0;
    }
    true
}

/// Local midnight today (ms since the epoch); 0 if the zone has no such instant.
fn day_start_ms() -> u64 {
    chrono::Local::now()
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .and_then(|t| t.and_local_timezone(chrono::Local).earliest())
        .and_then(|t| u64::try_from(t.timestamp_millis()).ok())
        .unwrap_or(0)
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
        let now = now_ms();
        roll_day(&mut st, &today_key());
        // Every action sees (and saves) the values as they are now.
        for item in &mut st.items {
            item.sync(now);
        }

        match action {
            "start" => {
                let item = st
                    .items
                    .iter_mut()
                    .find(|i| i.id == id)
                    .ok_or_else(|| format!("unknown-timer: {id}"))?;
                if item.counts_down() && item.remaining_ms == 0 {
                    item.remaining_ms = item.duration_ms.max(1000);
                }
                if !item.running {
                    item.run_from(now);
                }
            }
            "pause" => {
                let item = st
                    .items
                    .iter_mut()
                    .find(|i| i.id == id)
                    .ok_or_else(|| format!("unknown-timer: {id}"))?;
                item.stop();
            }
            "reset" => {
                let item = st
                    .items
                    .iter_mut()
                    .find(|i| i.id == id)
                    .ok_or_else(|| format!("unknown-timer: {id}"))?;
                item.stop();
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
                item.stop();
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
                    ..TimerEntry::default()
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

/// Brings running entries up to `now` (wall clock, ms) and finishes the countdowns that ran
/// out, each exactly once: it stops, so the next tick doesn't see it again. A Pomodoro moves on
/// by one phase and waits; a work phase counts towards today only if it ended after
/// `day_start_ms` (local midnight).
pub fn tick_store(store: &mut TimerStore, now: u64, day_start_ms: u64) -> Tick {
    let mut tick = Tick::default();
    for item in &mut store.items {
        if !item.running {
            continue;
        }
        tick.changed = true;
        tick.save |= item.sync(now);
        if !item.counts_down() || item.remaining_ms > 0 {
            continue;
        }
        let ended_at_ms = item.ends_at_ms.unwrap_or(now);
        let late = now.saturating_sub(ended_at_ms) > LATE_MS;
        item.stop();
        tick.save = true;
        let label = match item.kind {
            TimerKind::Pomodoro if item.pomo_phase == "work" => {
                if ended_at_ms >= day_start_ms {
                    item.pomo_completed_today = item.pomo_completed_today.saturating_add(1);
                }
                item.pomo_phase = "break".into();
                item.duration_ms = item.pomo_break_ms;
                item.remaining_ms = item.pomo_break_ms;
                format!("{} (Work complete)", item.label)
            }
            TimerKind::Pomodoro => {
                item.pomo_phase = "work".into();
                item.duration_ms = item.pomo_work_ms;
                item.remaining_ms = item.pomo_work_ms;
                format!("{} (Break complete)", item.label)
            }
            _ => item.label.clone(),
        };
        tick.finished.push(Finished {
            label,
            ended_at_ms,
            late,
        });
    }
    tick
}

/// The notification text: a countdown that ran out while nobody could see it says when.
fn notification_body(f: &Finished) -> String {
    if !f.late {
        return f.label.clone();
    }
    let at = i64::try_from(f.ended_at_ms)
        .ok()
        .and_then(chrono::DateTime::from_timestamp_millis)
        .map(|t| t.with_timezone(&chrono::Local).format("%H:%M").to_string());
    match at {
        Some(at) => format!("{} (finished at {at})", f.label),
        None => f.label.clone(),
    }
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

    let mut interval = tokio::time::interval(Duration::from_secs(1));
    // Values come from the wall clock, so ticks missed under load or while asleep need no
    // catching up: the next one is enough.
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        interval.tick().await;
        let (tick, val) = {
            let mut st = global_store()
                .lock()
                .unwrap_or_else(PoisonError::into_inner);
            let rolled = roll_day(&mut st, &today_key());
            let tick = tick_store(&mut st, now_ms(), day_start_ms());
            if tick.save || rolled {
                save_store(&st);
            }
            let val = (tick.changed || rolled).then(|| store_to_value(&st));
            (tick, val)
        };
        if let Some(v) = val {
            hub.publish(vec![TopicUpdate {
                topic: Topic::new(STATE),
                value: v,
            }]);
        }
        for f in &tick.finished {
            notify_timer_done(&notification_body(f)).await;
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    const T0: u64 = 1_795_800_000_000; // 2026-11-27, some time in the afternoon
    const MIN: u64 = 60_000;

    fn store() -> TimerStore {
        default_timers()
    }

    fn item<'a>(st: &'a mut TimerStore, id: &str) -> &'a mut TimerEntry {
        st.items.iter_mut().find(|i| i.id == id).unwrap()
    }

    #[test]
    fn ticks_timer_stopwatch_and_pomodoro_cycles() {
        let mut st = store();
        item(&mut st, "pomodoro").remaining_ms = 2000;
        item(&mut st, "pomodoro").run_from(T0);
        item(&mut st, "stopwatch").run_from(T0);

        let t = tick_store(&mut st, T0 + 1000, 0);
        assert!(t.changed);
        assert!(t.finished.is_empty());
        assert_eq!(item(&mut st, "pomodoro").remaining_ms, 1000);
        assert_eq!(item(&mut st, "stopwatch").elapsed_ms, 1000);

        let t = tick_store(&mut st, T0 + 2000, 0);
        assert_eq!(t.finished.len(), 1);
        assert!(!t.finished[0].late);
        assert!(t.save);
        let p = item(&mut st, "pomodoro");
        assert_eq!(p.pomo_completed_today, 1);
        assert_eq!(p.pomo_phase, "break");
        assert!(!p.running);
        assert_eq!(p.ends_at_ms, None);
    }

    #[test]
    fn a_late_tick_counts_the_real_time() {
        let mut st = store();
        let tea = item(&mut st, "timer-1");
        tea.run_from(T0);
        // The 1 s interval came 2.5 s late (load) instead of after 1 s.
        tick_store(&mut st, T0 + 2500, 0);
        assert_eq!(item(&mut st, "timer-1").remaining_ms, 5 * MIN - 2500);
        tick_store(&mut st, T0 + 3000, 0);
        assert_eq!(item(&mut st, "timer-1").remaining_ms, 5 * MIN - 3000);
    }

    #[test]
    fn a_suspend_gap_counts_for_the_stopwatch_and_finishes_a_timer_once() {
        let mut st = store();
        item(&mut st, "stopwatch").run_from(T0);
        item(&mut st, "timer-1").run_from(T0);
        tick_store(&mut st, T0 + 1000, 0);
        // The laptop sleeps for an hour: no ticks, the wall clock moves on.
        let t = tick_store(&mut st, T0 + 60 * MIN + 1000, 0);
        assert_eq!(item(&mut st, "stopwatch").elapsed_ms, 60 * MIN + 1000);
        assert_eq!(t.finished.len(), 1);
        assert_eq!(t.finished[0].label, "Tea");
        assert_eq!(t.finished[0].ended_at_ms, T0 + 5 * MIN);
        assert!(t.finished[0].late);
        assert!(!item(&mut st, "timer-1").running);
        assert_eq!(item(&mut st, "timer-1").remaining_ms, 0);
        // No second notification on later ticks.
        let t = tick_store(&mut st, T0 + 60 * MIN + 2000, 0);
        assert!(t.finished.is_empty());
    }

    fn round_trip(st: &TimerStore, dir: &Path, now: u64) -> TimerStore {
        let path = dir.join("timers.json");
        std::fs::write(&path, serde_json::to_vec_pretty(st).unwrap()).unwrap();
        load_store(&path, now)
    }

    #[test]
    fn a_restart_resumes_running_entries_with_the_downtime() {
        let dir = tempfile::tempdir().unwrap();
        let mut st = store();
        item(&mut st, "stopwatch").run_from(T0);
        item(&mut st, "pomodoro").run_from(T0);
        // Saved at start; core then ran for 10 s (no saves) and was down for 50 s.
        let mut back = round_trip(&st, dir.path(), T0 + 60_000);
        let t = tick_store(&mut back, T0 + 60_000, 0);
        assert!(t.finished.is_empty());
        assert_eq!(item(&mut back, "stopwatch").elapsed_ms, 60_000);
        assert_eq!(item(&mut back, "pomodoro").remaining_ms, 25 * MIN - 60_000);
        assert!(item(&mut back, "pomodoro").running);
    }

    #[test]
    fn a_timer_that_ran_out_while_core_was_down_finishes_once() {
        let dir = tempfile::tempdir().unwrap();
        let mut st = store();
        item(&mut st, "timer-1").run_from(T0);
        let mut back = round_trip(&st, dir.path(), T0 + 30 * MIN);
        let t = tick_store(&mut back, T0 + 30 * MIN, 0);
        assert_eq!(t.finished.len(), 1);
        assert!(t.finished[0].late);
        assert!(t.save);
        // Saved as finished: the next start of core doesn't notify again.
        let mut again = round_trip(&back, dir.path(), T0 + 31 * MIN);
        assert!(tick_store(&mut again, T0 + 31 * MIN, 0).finished.is_empty());
        assert!(!item(&mut again, "timer-1").running);
    }

    #[test]
    fn a_pomodoro_moves_on_one_phase_after_a_long_gap() {
        let mut st = store();
        item(&mut st, "pomodoro").run_from(T0);
        // Three hours later: work (25 min) and many breaks would have passed.
        let t = tick_store(&mut st, T0 + 180 * MIN, 0);
        assert_eq!(t.finished.len(), 1);
        assert_eq!(t.finished[0].label, "Focus (Work complete)");
        let p = item(&mut st, "pomodoro");
        assert_eq!(p.pomo_phase, "break");
        assert_eq!(p.remaining_ms, 5 * MIN);
        assert_eq!(p.pomo_completed_today, 1);
        assert!(!p.running);
        assert!(tick_store(&mut st, T0 + 181 * MIN, 0).finished.is_empty());
        assert_eq!(item(&mut st, "pomodoro").pomo_completed_today, 1);
    }

    #[test]
    fn a_work_phase_that_ended_before_midnight_does_not_count_for_today() {
        let mut st = store();
        st.day_key = "2026-11-26".into();
        item(&mut st, "pomodoro").pomo_completed_today = 4;
        item(&mut st, "pomodoro").run_from(T0);
        // Asleep over midnight: the new day resets the counter first, then the tick finishes
        // the phase, which ended yesterday (midnight is after its end).
        assert!(roll_day(&mut st, "2026-11-27"));
        assert!(!roll_day(&mut st, "2026-11-27"));
        assert_eq!(item(&mut st, "pomodoro").pomo_completed_today, 0);
        let midnight = T0 + 60 * MIN;
        let t = tick_store(&mut st, midnight + 8 * 60 * MIN, midnight);
        assert_eq!(t.finished.len(), 1);
        assert_eq!(item(&mut st, "pomodoro").pomo_completed_today, 0);
    }

    #[test]
    fn pause_and_resume_rebase_the_anchor() {
        let mut st = store();
        let tea = item(&mut st, "timer-1");
        tea.run_from(T0);
        tea.sync(T0 + 5000);
        tea.stop();
        assert_eq!(tea.remaining_ms, 5 * MIN - 5000);
        // Paused for a long time: nothing moves.
        tick_store(&mut st, T0 + 100_000, 0);
        assert_eq!(item(&mut st, "timer-1").remaining_ms, 5 * MIN - 5000);
        item(&mut st, "timer-1").run_from(T0 + 100_000);
        tick_store(&mut st, T0 + 101_000, 0);
        assert_eq!(item(&mut st, "timer-1").remaining_ms, 5 * MIN - 6000);
        let sw = item(&mut st, "stopwatch");
        sw.run_from(T0);
        sw.sync(T0 + 4000);
        sw.stop();
        sw.run_from(T0 + 50_000);
        sw.sync(T0 + 51_000);
        assert_eq!(sw.elapsed_ms, 5000);
    }

    #[test]
    fn a_clock_set_back_pauses_instead_of_running_backwards() {
        let mut st = store();
        item(&mut st, "stopwatch").run_from(T0);
        item(&mut st, "timer-1").run_from(T0);
        tick_store(&mut st, T0 + 10_000, 0);
        let t = tick_store(&mut st, T0 - 50_000, 0);
        assert!(t.save);
        assert_eq!(item(&mut st, "stopwatch").elapsed_ms, 10_000);
        assert_eq!(item(&mut st, "timer-1").remaining_ms, 5 * MIN - 10_000);
        tick_store(&mut st, T0 - 49_000, 0);
        assert_eq!(item(&mut st, "stopwatch").elapsed_ms, 11_000);
        assert_eq!(item(&mut st, "timer-1").remaining_ms, 5 * MIN - 11_000);
    }

    #[test]
    fn the_published_state_keeps_its_shape() {
        let mut st = store();
        item(&mut st, "timer-1").run_from(T0);
        let json = crate::json::to_json(&store_to_value(&st));
        let tea = &json["items"][1];
        assert_eq!(tea["running"], serde_json::json!(true));
        assert_eq!(tea["remainingMs"].as_f64(), Some(300_000.0));
        assert!(tea.get("endsAtMs").is_none());
        assert!(tea.get("startedAtMs").is_none());
        let keys: Vec<&str> = tea
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            keys.len(),
            12,
            "id, label, kind, durationMs, remainingMs, elapsedMs, running, lapsMs, pomoPhase, pomoWorkMs, pomoBreakMs, pomoCompletedToday: {keys:?}"
        );
    }

    #[test]
    fn a_late_finish_says_when_it_ran_out() {
        let on_time = Finished {
            label: "Tea".into(),
            ended_at_ms: T0,
            late: false,
        };
        assert_eq!(notification_body(&on_time), "Tea");
        let late = Finished {
            late: true,
            ..on_time
        };
        assert!(notification_body(&late).starts_with("Tea (finished at "));
    }
}

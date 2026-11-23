//! History: per numeric series an `f32` ring at 1 s × 900 (15 min) and 10 s × 8640 (24 h) in
//! memory, and 1-minute min/avg/max rollups for 30 days in SQLite (ARCHITECTURE §3.4).
//!
//! Only published values are recorded, and the hub only publishes subscribed topics (or those
//! an alert rule watches), so history exists exactly for what someone looks at. Gaps between
//! updates (values are published only when they change) are filled lazily with the last value,
//! so recording costs no wake-ups of its own.

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use opaline_ipc::{UpdateBatch, Value};

use crate::hub::Hub;

const FINE_STEP_S: u64 = 1;
const FINE_LEN: usize = 900;
const COARSE_STEP_S: u64 = 10;
const COARSE_LEN: usize = 8640;
const KEEP_DAYS: i64 = 30;
/// Series that got no update for this long are dropped from memory.
const IDLE_DROP_S: u64 = 3600;
const FLUSH_EVERY: Duration = Duration::from_secs(60);
/// Gap filling is capped: after a longer pause only the last hour is filled in.
const MAX_FILL_S: u64 = 3600;

/// A fixed-step ring of samples, newest last.
#[derive(Debug, Clone)]
pub struct Ring {
    step_s: u64,
    cap: usize,
    /// Slot number (time / step) of the newest sample.
    last_slot: Option<u64>,
    values: VecDeque<f32>,
}

impl Ring {
    pub fn new(step_s: u64, cap: usize) -> Self {
        Self {
            step_s,
            cap,
            last_slot: None,
            values: VecDeque::new(),
        }
    }

    /// Records `v` at `t_s`, repeating the previous value over any skipped slots.
    pub fn push(&mut self, t_s: u64, v: f32) {
        let slot = t_s / self.step_s;
        match self.last_slot {
            Some(last) if slot < last => return, // out of order: ignore
            Some(last) if slot == last => {
                if let Some(back) = self.values.back_mut() {
                    *back = v;
                }
            }
            Some(last) => {
                let fill = self.values.back().copied().unwrap_or(v);
                let gap = (slot - last - 1).min(self.cap as u64);
                for _ in 0..gap {
                    self.values.push_back(fill);
                }
                self.values.push_back(v);
            }
            None => self.values.push_back(v),
        }
        self.last_slot = Some(slot);
        while self.values.len() > self.cap {
            self.values.pop_front();
        }
    }

    /// The last `n` samples, oldest first.
    pub fn tail(&self, n: usize) -> Vec<f32> {
        self.values
            .iter()
            .skip(self.values.len().saturating_sub(n))
            .copied()
            .collect()
    }
}

/// min / sum / max / count of one minute, for the SQLite rollup.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Minute {
    minute: u64,
    min: f32,
    max: f32,
    sum: f64,
    count: u32,
}

#[derive(Debug, Clone)]
struct Series {
    fine: Ring,
    coarse: Ring,
    /// Mean of the current coarse slot.
    coarse_acc: (u64, f64, u32),
    minute: Option<Minute>,
    done: Vec<Minute>,
    last_t: u64,
}

impl Series {
    fn new() -> Self {
        Self {
            fine: Ring::new(FINE_STEP_S, FINE_LEN),
            coarse: Ring::new(COARSE_STEP_S, COARSE_LEN),
            coarse_acc: (0, 0.0, 0),
            minute: None,
            done: Vec::new(),
            last_t: 0,
        }
    }

    /// Records `v` at `t_s`. Averages are time-weighted: every second since the previous sample
    /// counts with the previous value (values are only published when they change).
    fn push(&mut self, t_s: u64, v: f32) {
        if self.last_t > 0 && t_s > self.last_t {
            let prev = self.fine.tail(1).first().copied().unwrap_or(v);
            let gap_start = (self.last_t + 1).max(t_s.saturating_sub(MAX_FILL_S));
            for t in gap_start..t_s {
                self.add_second(t, prev);
            }
        }
        self.add_second(t_s, v);
        self.fine.push(t_s, v);
        self.last_t = self.last_t.max(t_s);
    }

    fn add_second(&mut self, t_s: u64, v: f32) {
        let slot = t_s / COARSE_STEP_S;
        let (cur, sum, n) = self.coarse_acc;
        self.coarse_acc = if cur == slot {
            (slot, sum + f64::from(v), n + 1)
        } else {
            (slot, f64::from(v), 1)
        };
        let (_, sum, n) = self.coarse_acc;
        self.coarse.push(t_s, (sum / f64::from(n)) as f32);
        let minute = t_s / 60;
        match &mut self.minute {
            Some(m) if m.minute == minute => {
                m.min = m.min.min(v);
                m.max = m.max.max(v);
                m.sum += f64::from(v);
                m.count += 1;
            }
            slot => {
                if let Some(m) = slot.take() {
                    self.done.push(m);
                }
                *slot = Some(Minute {
                    minute,
                    min: v,
                    max: v,
                    sum: f64::from(v),
                    count: 1,
                });
            }
        }
    }
}

/// The series name for one number of a topic: `cpu.load`, or `cpu.perThread#3` for arrays.
pub fn series_names(topic: &str, value: &Value) -> Vec<(String, f32)> {
    match value.numbers() {
        Some([v]) if matches!(value, Value::Num(_)) => vec![(topic.to_owned(), *v as f32)],
        Some(vs) => vs
            .iter()
            .enumerate()
            .map(|(i, v)| (format!("{topic}#{i}"), *v as f32))
            .collect(),
        None => Vec::new(),
    }
}

#[derive(Debug, Default)]
pub struct History {
    series: HashMap<String, Series>,
}

impl History {
    pub fn record(&mut self, batch: &UpdateBatch) {
        let t = batch.at_ms / 1000;
        for u in &batch.updates {
            for (name, v) in series_names(u.topic.as_str(), &u.value) {
                if v.is_finite() {
                    self.series
                        .entry(name)
                        .or_insert_with(Series::new)
                        .push(t, v);
                }
            }
        }
    }

    /// The last `seconds` of a series: 1 s steps up to 15 min, 10 s steps up to 24 h.
    pub fn query(&self, series: &str, seconds: u64) -> Option<(u64, Vec<f32>)> {
        let s = self.series.get(series)?;
        if seconds <= FINE_STEP_S * FINE_LEN as u64 {
            Some((FINE_STEP_S, s.fine.tail(seconds as usize)))
        } else {
            Some((
                COARSE_STEP_S,
                s.coarse.tail((seconds / COARSE_STEP_S) as usize),
            ))
        }
    }

    /// Finished minutes to write, and forgets idle series.
    fn take_minutes(&mut self, now_s: u64) -> Vec<(String, u64, f32, f32, f32)> {
        let mut out = Vec::new();
        for (name, s) in &mut self.series {
            // A minute that ended without a later sample is finished too.
            if s.minute.is_some_and(|m| m.minute < now_s / 60)
                && let Some(m) = s.minute.take()
            {
                s.done.push(m);
            }
            for m in s.done.drain(..) {
                out.push((
                    name.clone(),
                    m.minute * 60,
                    m.min,
                    (m.sum / f64::from(m.count)) as f32,
                    m.max,
                ));
            }
        }
        self.series
            .retain(|_, s| now_s.saturating_sub(s.last_t) < IDLE_DROP_S);
        out
    }
}

fn db_path() -> Option<PathBuf> {
    crate::paths::data_dir()
        .ok()
        .map(|d| d.join("history.sqlite"))
}

fn open_db() -> Result<rusqlite::Connection, String> {
    let path = db_path().ok_or("no-data-dir")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let db = rusqlite::Connection::open(path).map_err(|e| e.to_string())?;
    db.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA synchronous=NORMAL;
         CREATE TABLE IF NOT EXISTS rollup (
             series TEXT NOT NULL, minute INTEGER NOT NULL,
             min REAL NOT NULL, avg REAL NOT NULL, max REAL NOT NULL,
             PRIMARY KEY (series, minute)) WITHOUT ROWID;",
    )
    .map_err(|e| e.to_string())?;
    Ok(db)
}

fn write(
    db: &mut rusqlite::Connection,
    rows: &[(String, u64, f32, f32, f32)],
    now_s: u64,
) -> Result<(), String> {
    let tx = db.transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare_cached("INSERT OR REPLACE INTO rollup (series, minute, min, avg, max) VALUES (?1, ?2, ?3, ?4, ?5)")
            .map_err(|e| e.to_string())?;
        for (s, m, lo, avg, hi) in rows {
            stmt.execute(rusqlite::params![
                s,
                *m as i64,
                f64::from(*lo),
                f64::from(*avg),
                f64::from(*hi)
            ])
            .map_err(|e| e.to_string())?;
        }
        let cutoff = now_s as i64 - KEEP_DAYS * 86_400;
        tx.execute("DELETE FROM rollup WHERE minute < ?1", [cutoff])
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

/// Minute averages from SQLite for ranges longer than a day.
pub fn query_rollup(series: &str, seconds: u64) -> Result<(u64, Vec<f32>), String> {
    let db = open_db()?;
    let since = crate::hub::now_ms() / 1000 - seconds;
    let mut stmt = db
        .prepare("SELECT avg FROM rollup WHERE series = ?1 AND minute >= ?2 ORDER BY minute")
        .map_err(|e| e.to_string())?;
    let values = stmt
        .query_map(rusqlite::params![series, since as i64], |r| {
            r.get::<_, f64>(0)
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .map(|v| v as f32)
        .collect();
    Ok((60, values))
}

pub type Shared = Arc<Mutex<History>>;

/// Records every published batch and writes finished minutes once a minute.
pub async fn run(hub: Arc<Hub>, history: Shared) -> Result<(), String> {
    let mut updates = hub.updates();
    let mut flush = tokio::time::interval(FLUSH_EVERY);
    flush.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut db: Option<rusqlite::Connection> = None;
    loop {
        tokio::select! {
            batch = updates.recv() => match batch {
                Ok(batch) => history.lock().unwrap_or_else(PoisonError::into_inner).record(&batch),
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                Err(tokio::sync::broadcast::error::RecvError::Closed) => return Ok(()),
            },
            _ = flush.tick() => {
                let now = crate::hub::now_ms() / 1000;
                let rows = history.lock().unwrap_or_else(PoisonError::into_inner).take_minutes(now);
                if rows.is_empty() {
                    continue;
                }
                let mut conn = match db.take() {
                    Some(c) => c,
                    None => tokio::task::spawn_blocking(open_db).await.map_err(|e| e.to_string())??,
                };
                let (back, result) = tokio::task::spawn_blocking(move || {
                    let r = write(&mut conn, &rows, now);
                    (conn, r)
                })
                .await
                .map_err(|e| e.to_string())?;
                if let Err(error) = result {
                    tracing::warn!(%error, "could not write history");
                }
                db = Some(back);
            }
        }
    }
}

/// Answers a history query: memory for up to a day, SQLite beyond.
pub async fn query(history: &Shared, series: &str, seconds: u64) -> Result<Value, String> {
    let seconds = seconds.clamp(1, KEEP_DAYS as u64 * 86_400);
    let found = if seconds <= COARSE_STEP_S * COARSE_LEN as u64 {
        history
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .query(series, seconds)
    } else {
        None
    };
    let (step, values) = match found {
        Some(v) => v,
        None => {
            let series = series.to_owned();
            tokio::task::spawn_blocking(move || query_rollup(&series, seconds))
                .await
                .map_err(|e| e.to_string())??
        }
    };
    Ok(Value::map([
        ("stepS", Value::Num(step as f64)),
        (
            "values",
            Value::Nums(values.into_iter().map(f64::from).collect()),
        ),
    ]))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::float_cmp)]

    use opaline_ipc::{Topic, TopicUpdate};

    use super::*;

    fn batch(t: u64, topic: &str, value: Value) -> UpdateBatch {
        UpdateBatch {
            seq: 0,
            at_ms: t * 1000,
            updates: vec![TopicUpdate {
                topic: Topic::new(topic),
                value,
            }],
        }
    }

    #[test]
    fn rings_fill_gaps_with_the_last_value() {
        let mut r = Ring::new(1, 5);
        r.push(100, 1.0);
        r.push(103, 4.0);
        assert_eq!(r.tail(10), vec![1.0, 1.0, 1.0, 4.0]);
        r.push(103, 5.0);
        assert_eq!(r.tail(1), vec![5.0], "same slot: replaced");
        r.push(110, 6.0);
        assert_eq!(r.tail(10).len(), 5, "capped");
        r.push(50, 9.0);
        assert_eq!(r.tail(1), vec![6.0], "out-of-order samples are ignored");
    }

    #[test]
    fn records_numbers_and_arrays() {
        let mut h = History::default();
        h.record(&batch(1000, "cpu.load", Value::Num(10.0)));
        h.record(&batch(1002, "cpu.load", Value::Num(30.0)));
        h.record(&batch(1000, "cpu.perThread", Value::Nums(vec![1.0, 2.0])));
        h.record(&batch(1000, "network.wifi", Value::from("x")));
        assert_eq!(h.query("cpu.load", 3), Some((1, vec![10.0, 10.0, 30.0])));
        assert_eq!(h.query("cpu.perThread#1", 1), Some((1, vec![2.0])));
        assert!(h.query("network.wifi", 1).is_none());
        let (step, coarse) = h.query("cpu.load", 3600).unwrap();
        assert_eq!(step, 10);
        assert_eq!(
            coarse,
            vec![50.0 / 3.0],
            "mean of the 10 s slot (10, 10 filled, 30)"
        );
    }

    #[test]
    fn minutes_roll_up_and_idle_series_go() {
        let mut h = History::default();
        h.record(&batch(60, "cpu.load", Value::Num(10.0)));
        h.record(&batch(90, "cpu.load", Value::Num(30.0)));
        h.record(&batch(125, "cpu.load", Value::Num(5.0)));
        let rows = h.take_minutes(130);
        // 10 held for 30 s (60…89), then 30 for 30 s (90…119): time-weighted average 20.
        assert_eq!(rows, vec![("cpu.load".to_owned(), 60, 10.0, 20.0, 30.0)]);
        let rows = h.take_minutes(200);
        // 30 held for 120…124, then 5 at 125: min 5, max 30, time-weighted mean 155/6.
        assert_eq!(rows.len(), 1, "a minute without later samples ends too");
        let (name, minute, lo, avg, hi) = &rows[0];
        assert_eq!(
            (name.as_str(), *minute, *lo, *hi),
            ("cpu.load", 120, 5.0, 30.0)
        );
        assert!((avg - 155.0 / 6.0).abs() < 1e-4, "{avg}");
        h.take_minutes(125 + IDLE_DROP_S + 1);
        assert!(h.query("cpu.load", 1).is_none());
    }

    #[test]
    fn sqlite_rollups() {
        let mut db = rusqlite::Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE rollup (series TEXT NOT NULL, minute INTEGER NOT NULL, min REAL NOT NULL, avg REAL NOT NULL, max REAL NOT NULL, PRIMARY KEY (series, minute)) WITHOUT ROWID;").unwrap();
        let now = 40 * 86_400;
        write(
            &mut db,
            &[
                ("cpu.load".into(), 60, 1.0, 2.0, 3.0),
                ("cpu.load".into(), now - 60, 4.0, 5.0, 6.0),
            ],
            now,
        )
        .unwrap();
        let n: i64 = db
            .query_row("SELECT COUNT(*) FROM rollup", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1, "rows older than 30 days are deleted");
    }
}

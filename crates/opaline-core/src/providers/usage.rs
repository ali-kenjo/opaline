//! Network data usage per day, across reboots and counter resets, with today and the current
//! billing period (brief §6 "Network"). Accounting always runs (once a minute, one small file
//! read); the totals are published while someone is subscribed.

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use chrono::{Datelike, Local, NaiveDate};
use opaline_ipc::Value;
use serde::{Deserialize, Serialize};

use super::network::{classify, parse_net_dev};
use crate::engine::update;
use crate::hub::Hub;
use crate::sysfs::Root;

pub const USAGE: &str = "network.usage";
const ACCOUNT_EVERY: Duration = Duration::from_secs(60);
const SAVE_EVERY: u32 = 10; // minutes
const KEEP_DAYS: i64 = 400;
/// The day of the month a billing period starts. A setting in Phase 6.
pub const DEFAULT_BILLING_DAY: u32 = 1;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Ledger {
    pub version: u32,
    /// `YYYY-MM-DD` → `[rx, tx]` bytes on physical interfaces.
    pub days: BTreeMap<String, [u64; 2]>,
    /// Counters at the last accounting, per interface.
    pub last: BTreeMap<String, [u64; 2]>,
    /// `/proc/sys/kernel/random/boot_id` at the last accounting: a new boot resets counters.
    pub boot_id: String,
}

impl Ledger {
    /// Adds the traffic since the last call. Counters that went backwards (interface re-plugged,
    /// driver reload) or a new boot count from zero.
    pub fn account(
        &mut self,
        today: NaiveDate,
        boot_id: &str,
        counters: &HashMap<String, [u64; 2]>,
    ) {
        let new_boot = self.boot_id != boot_id;
        let mut add = [0u64; 2];
        for (iface, cur) in counters {
            let prev = if new_boot { None } else { self.last.get(iface) };
            for i in 0..2 {
                add[i] += match prev {
                    Some(p) if cur[i] >= p[i] => cur[i] - p[i],
                    // First sight of an interface in this boot: count what it has done so far
                    // only after a reboot (otherwise we'd re-count history on first start).
                    None if !new_boot || self.boot_id.is_empty() => 0,
                    _ => cur[i],
                };
            }
        }
        let day = self.days.entry(today.to_string()).or_insert([0, 0]);
        day[0] += add[0];
        day[1] += add[1];
        self.last = counters.iter().map(|(k, v)| (k.clone(), *v)).collect();
        self.boot_id = boot_id.to_owned();
        let oldest = today - chrono::Duration::days(KEEP_DAYS);
        self.days
            .retain(|d, _| NaiveDate::parse_from_str(d, "%Y-%m-%d").is_ok_and(|d| d >= oldest));
    }

    /// `(today, billing period)` totals.
    pub fn totals(&self, today: NaiveDate, billing_day: u32) -> ([u64; 2], [u64; 2]) {
        let start = period_start(today, billing_day);
        let mut period = [0u64; 2];
        for (d, v) in &self.days {
            if NaiveDate::parse_from_str(d, "%Y-%m-%d").is_ok_and(|d| d >= start && d <= today) {
                period[0] += v[0];
                period[1] += v[1];
            }
        }
        (
            self.days.get(&today.to_string()).copied().unwrap_or([0, 0]),
            period,
        )
    }
}

/// The first day of the billing period containing `today`. A billing day past the end of a
/// month (31 in April) means that month's last day.
pub fn period_start(today: NaiveDate, billing_day: u32) -> NaiveDate {
    let clamp = |y: i32, m: u32| {
        let last = (28..=31)
            .rev()
            .find(|d| NaiveDate::from_ymd_opt(y, m, *d).is_some())
            .unwrap_or(28);
        NaiveDate::from_ymd_opt(y, m, billing_day.clamp(1, last)).unwrap_or(today)
    };
    let this = clamp(today.year(), today.month());
    if this <= today {
        this
    } else if today.month() == 1 {
        clamp(today.year() - 1, 12)
    } else {
        clamp(today.year(), today.month() - 1)
    }
}

fn ledger_path() -> Option<PathBuf> {
    crate::paths::data_dir()
        .ok()
        .map(|d| d.join("data-usage.json"))
}

fn load() -> Ledger {
    ledger_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn save(ledger: &Ledger) {
    let Some(path) = ledger_path() else {
        return;
    };
    match serde_json::to_vec(ledger) {
        Ok(bytes) => {
            if let Err(error) = crate::paths::write_atomic(&path, &bytes) {
                tracing::warn!(%error, "could not save data usage");
            }
        }
        Err(error) => tracing::warn!(%error, "could not serialise data usage"),
    }
}

fn physical_counters(root: &Root) -> HashMap<String, [u64; 2]> {
    root.read("/proc/net/dev")
        .map(|t| parse_net_dev(&t))
        .unwrap_or_default()
        .into_iter()
        .filter(|(name, _)| classify(root, name).1)
        .collect()
}

fn value(ledger: &Ledger, today: NaiveDate, billing_day: u32) -> Value {
    let (day, period) = ledger.totals(today, billing_day);
    Value::map([
        ("todayRxB", Value::Num(day[0] as f64)),
        ("todayTxB", Value::Num(day[1] as f64)),
        ("periodRxB", Value::Num(period[0] as f64)),
        ("periodTxB", Value::Num(period[1] as f64)),
        (
            "periodStart",
            Value::from(period_start(today, billing_day).to_string()),
        ),
        ("billingDay", Value::Num(f64::from(billing_day))),
    ])
}

pub async fn run(hub: Arc<Hub>) -> Result<(), String> {
    let root = Root::system();
    let mut ledger = tokio::task::spawn_blocking(load)
        .await
        .map_err(|e| e.to_string())?;
    let mut changes = hub.watch_subscriptions();
    let mut minutes = 0u32;
    let mut interval = tokio::time::interval(ACCOUNT_EVERY);
    loop {
        tokio::select! {
            _ = interval.tick() => {
                let boot_id = root.read_trim("/proc/sys/kernel/random/boot_id").unwrap_or_default();
                ledger.account(Local::now().date_naive(), &boot_id, &physical_counters(&root));
                minutes += 1;
                if minutes.is_multiple_of(SAVE_EVERY) {
                    let snapshot = ledger.clone();
                    tokio::task::spawn_blocking(move || save(&snapshot));
                }
            }
            changed = changes.changed() => {
                changed.map_err(|_| "hub closed".to_owned())?;
            }
        }
        if hub.is_subscribed(USAGE) {
            hub.publish(vec![update(
                USAGE,
                value(&ledger, Local::now().date_naive(), DEFAULT_BILLING_DAY),
            )]);
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    fn day(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    fn counters(rx: u64, tx: u64) -> HashMap<String, [u64; 2]> {
        [("wlo1".to_owned(), [rx, tx])].into_iter().collect()
    }

    #[test]
    fn counts_deltas_resets_and_reboots() {
        let mut l = Ledger::default();
        // First start ever: the counters so far aren't today's traffic.
        l.account(day("2026-11-23"), "boot-a", &counters(1000, 100));
        assert_eq!(l.days["2026-11-23"], [0, 0]);
        l.account(day("2026-11-23"), "boot-a", &counters(1500, 150));
        assert_eq!(l.days["2026-11-23"], [500, 50]);
        // Interface re-plugged: counters restart at a smaller value.
        l.account(day("2026-11-23"), "boot-a", &counters(200, 20));
        assert_eq!(l.days["2026-11-23"], [700, 70]);
        // Reboot: everything the counters show was done in this boot.
        l.account(day("2026-11-24"), "boot-b", &counters(300, 30));
        assert_eq!(l.days["2026-11-24"], [300, 30]);
        let (today, period) = l.totals(day("2026-11-24"), 1);
        assert_eq!(today, [300, 30]);
        assert_eq!(period, [1000, 100]);
    }

    #[test]
    fn billing_periods() {
        assert_eq!(period_start(day("2026-11-23"), 1), day("2026-11-01"));
        assert_eq!(period_start(day("2026-11-23"), 25), day("2026-10-25"));
        assert_eq!(period_start(day("2026-01-10"), 15), day("2025-12-15"));
        assert_eq!(
            period_start(day("2026-04-30"), 31),
            day("2026-04-30"),
            "31 → April's last day"
        );
        assert_eq!(period_start(day("2026-03-05"), 30), day("2026-02-28"));
    }

    #[test]
    fn old_days_are_pruned() {
        let mut l = Ledger::default();
        l.days.insert("2024-01-01".into(), [1, 1]);
        l.account(day("2026-11-23"), "b", &counters(0, 0));
        assert!(!l.days.contains_key("2024-01-01"));
    }
}

//! Memory: usage, swap, zswap and pressure (brief §6 "Memory").

use std::collections::HashMap;

use opaline_ipc::{Availability, TopicUpdate, Value};

use super::psi::parse_psi;
use crate::engine::{Probe, Provider, ProviderError, SampleCx, TopicDesc, update};
use crate::sysfs::{HotFile, Root};

pub const USAGE: &str = "memory.usage";
pub const PERCENT: &str = "memory.percent";
pub const SWAP: &str = "memory.swap";
pub const SWAP_PERCENT: &str = "memory.swapPercent";
pub const ZSWAP: &str = "memory.zswap";
pub const PRESSURE: &str = "memory.pressure";

const TOPICS: &[TopicDesc] = &[
    TopicDesc::new(USAGE),
    TopicDesc::new(PERCENT),
    TopicDesc::new(SWAP),
    TopicDesc::new(SWAP_PERCENT),
    TopicDesc::new(ZSWAP),
    TopicDesc::new(PRESSURE),
];

/// `/proc/meminfo` as a map from field name to bytes.
pub fn parse_meminfo(text: &str) -> HashMap<&str, u64> {
    text.lines()
        .filter_map(|line| {
            let (key, rest) = line.split_once(':')?;
            let mut parts = rest.split_ascii_whitespace();
            let value: u64 = parts.next()?.parse().ok()?;
            let bytes = match parts.next() {
                Some("kB") => value.saturating_mul(1024),
                _ => value,
            };
            Some((key, bytes))
        })
        .collect()
}

/// Memory figures derived the way `free` does: used = total − available.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Usage {
    pub total: u64,
    pub available: u64,
    pub used: u64,
    pub cached: u64,
    pub buffers: u64,
    pub shmem: u64,
    pub swap_total: u64,
    pub swap_used: u64,
    pub zswap_pool: Option<u64>,
    pub zswapped: Option<u64>,
}

pub fn usage(info: &HashMap<&str, u64>) -> Option<Usage> {
    let total = *info.get("MemTotal")?;
    // MemAvailable exists since Linux 3.14; fall back to the old free + cache estimate.
    let available = info.get("MemAvailable").copied().unwrap_or_else(|| {
        ["MemFree", "Buffers", "Cached"]
            .iter()
            .filter_map(|k| info.get(k))
            .sum()
    });
    let get = |k: &str| info.get(k).copied().unwrap_or(0);
    let swap_total = get("SwapTotal");
    Some(Usage {
        total,
        available: available.min(total),
        used: total.saturating_sub(available),
        cached: get("Cached") + get("SReclaimable"),
        buffers: get("Buffers"),
        shmem: get("Shmem"),
        swap_total,
        swap_used: swap_total.saturating_sub(get("SwapFree")),
        zswap_pool: info.get("Zswap").copied(),
        zswapped: info.get("Zswapped").copied(),
    })
}

fn percent(part: u64, whole: u64) -> f64 {
    if whole == 0 {
        0.0
    } else {
        part as f64 / whole as f64 * 100.0
    }
}

pub struct Memory {
    meminfo: Option<HotFile>,
    pressure: Option<HotFile>,
    root: Root,
}

impl std::fmt::Debug for Memory {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Memory")
            .field("root", &self.root)
            .finish_non_exhaustive()
    }
}

impl Memory {
    pub fn new(root: Root) -> Self {
        Self {
            meminfo: root.open("/proc/meminfo").ok(),
            pressure: root.open("/proc/pressure/memory").ok(),
            root,
        }
    }

    fn zswap_enabled(&self) -> bool {
        self.root
            .read_trim("/sys/module/zswap/parameters/enabled")
            .is_some_and(|v| v == "Y" || v == "1")
    }
}

fn text(file: &mut Option<HotFile>) -> Option<String> {
    let bytes = file.as_mut()?.read().ok()?;
    std::str::from_utf8(bytes).ok().map(str::to_owned)
}

impl Provider for Memory {
    fn id(&self) -> &'static str {
        "memory"
    }

    fn topics(&self) -> &[TopicDesc] {
        TOPICS
    }

    fn probe(&mut self) -> Probe {
        let swap_total = text(&mut self.meminfo)
            .map(|t| parse_meminfo(&t).get("SwapTotal").copied().unwrap_or(0))
            .unwrap_or(0);
        let mut probe = Probe::default().available(USAGE).available(PERCENT).detail(
            "zswap",
            if self.zswap_enabled() {
                "enabled"
            } else {
                "disabled"
            },
        );
        let no_swap = Availability::Unavailable {
            reason: "no-swap".into(),
        };
        probe = if swap_total > 0 {
            probe.available(SWAP).available(SWAP_PERCENT)
        } else {
            probe
                .missing(SWAP, no_swap.clone())
                .missing(SWAP_PERCENT, no_swap)
        };
        probe = if self.zswap_enabled() {
            probe.available(ZSWAP)
        } else {
            probe.missing(
                ZSWAP,
                Availability::Unavailable {
                    reason: "zswap-disabled".into(),
                },
            )
        };
        if self.pressure.is_some() {
            probe.available(PRESSURE)
        } else {
            probe.missing(
                PRESSURE,
                Availability::Unavailable {
                    reason: "psi-disabled".into(),
                },
            )
        }
    }

    fn sample(&mut self, cx: &SampleCx<'_>) -> Result<Vec<TopicUpdate>, ProviderError> {
        let mut out = Vec::new();
        let needs_meminfo = [USAGE, PERCENT, SWAP, SWAP_PERCENT, ZSWAP]
            .iter()
            .any(|t| cx.is_due(t));
        if needs_meminfo {
            let text = text(&mut self.meminfo)
                .ok_or_else(|| ProviderError::Other("/proc/meminfo unreadable".into()))?;
            let info = parse_meminfo(&text);
            let u = usage(&info)
                .ok_or_else(|| ProviderError::Other("/proc/meminfo has no MemTotal".into()))?;
            let mem_percent = percent(u.used, u.total);
            if cx.is_due(USAGE) {
                out.push(update(
                    USAGE,
                    Value::map([
                        ("totalB", Value::Num(u.total as f64)),
                        ("usedB", Value::Num(u.used as f64)),
                        ("availableB", Value::Num(u.available as f64)),
                        ("cachedB", Value::Num(u.cached as f64)),
                        ("buffersB", Value::Num(u.buffers as f64)),
                        ("shmemB", Value::Num(u.shmem as f64)),
                        ("percent", Value::Num(mem_percent)),
                    ]),
                ));
            }
            if cx.is_due(PERCENT) {
                out.push(update(PERCENT, mem_percent));
            }
            let swap_percent = percent(u.swap_used, u.swap_total);
            if cx.is_due(SWAP) {
                out.push(update(
                    SWAP,
                    if u.swap_total == 0 {
                        Value::unavailable("no-swap")
                    } else {
                        Value::map([
                            ("totalB", Value::Num(u.swap_total as f64)),
                            ("usedB", Value::Num(u.swap_used as f64)),
                            ("percent", Value::Num(swap_percent)),
                        ])
                    },
                ));
            }
            if cx.is_due(SWAP_PERCENT) {
                out.push(update(
                    SWAP_PERCENT,
                    if u.swap_total == 0 {
                        Value::unavailable("no-swap")
                    } else {
                        Value::Num(swap_percent)
                    },
                ));
            }
            if cx.is_due(ZSWAP) {
                let value = match (self.zswap_enabled(), u.zswap_pool, u.zswapped) {
                    (true, Some(pool), Some(stored)) => Value::map([
                        ("poolB", Value::Num(pool as f64)),
                        ("storedB", Value::Num(stored as f64)),
                        (
                            "ratio",
                            if pool > 0 {
                                Value::Num(stored as f64 / pool as f64)
                            } else {
                                Value::unavailable("empty")
                            },
                        ),
                    ]),
                    (true, _, _) => Value::unavailable("zswap-not-reported"),
                    (false, _, _) => Value::unavailable("zswap-disabled"),
                };
                out.push(update(ZSWAP, value));
            }
        }
        if cx.is_due(PRESSURE) {
            let value = text(&mut self.pressure)
                .as_deref()
                .and_then(parse_psi)
                .map_or_else(|| Value::unavailable("psi-disabled"), |p| p.to_value());
            out.push(update(PRESSURE, value));
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::float_cmp, clippy::panic)]

    use super::*;
    use crate::sysfs::fixture;

    const ALL: &[&str] = &[USAGE, PERCENT, SWAP, SWAP_PERCENT, ZSWAP, PRESSURE];

    fn sample(root: Root) -> HashMap<String, Value> {
        let mut m = Memory::new(root);
        let cx = SampleCx {
            now: std::time::Instant::now(),
            due: ALL,
        };
        m.sample(&cx)
            .unwrap()
            .into_iter()
            .map(|u| (u.topic.0, u.value))
            .collect()
    }

    fn field(v: &Value, key: &str) -> f64 {
        match v {
            Value::Map(m) => match m.get(key) {
                Some(Value::Num(n)) => *n,
                other => panic!("{key}: {other:?}"),
            },
            other => panic!("not a map: {other:?}"),
        }
    }

    #[test]
    fn reference_laptop_matches_free() {
        let v = sample(fixture("hp-i5-10300h"));
        // From the fixture's /proc/meminfo: total 15617084 kB, available 10333672 kB.
        let kib = 1024.0;
        assert_eq!(field(&v[USAGE], "totalB"), 15_617_084.0 * kib);
        assert_eq!(
            field(&v[USAGE], "usedB"),
            (15_617_084.0 - 10_333_672.0) * kib
        );
        assert_eq!(field(&v[SWAP], "usedB"), (4_194_300.0 - 3_351_300.0) * kib);
        assert_eq!(v[ZSWAP], Value::unavailable("zswap-disabled"));
        assert_eq!(field(&v[PRESSURE], "full10"), 0.0);
        let Value::Num(p) = v[PERCENT] else { panic!() };
        assert!((p - 33.83).abs() < 0.01, "{p}");
    }

    #[test]
    fn vm_without_swap_or_psi() {
        let v = sample(fixture("synthetic-vm"));
        assert_eq!(v[SWAP], Value::unavailable("no-swap"));
        assert_eq!(v[SWAP_PERCENT], Value::unavailable("no-swap"));
        assert_eq!(v[PRESSURE], Value::unavailable("psi-disabled"));
        assert_eq!(field(&v[USAGE], "totalB"), 2_048_000.0 * 1024.0);
    }

    #[test]
    fn old_kernels_without_memavailable() {
        let info =
            parse_meminfo("MemTotal: 1000 kB\nMemFree: 100 kB\nBuffers: 50 kB\nCached: 250 kB\n");
        let u = usage(&info).unwrap();
        assert_eq!(u.available, 400 * 1024);
        assert_eq!(u.used, 600 * 1024);
    }
}

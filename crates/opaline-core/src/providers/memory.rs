//! Memory: usage, swap, zswap and pressure (brief §6 "Memory").

use std::collections::{BTreeMap, HashMap};
use std::time::Duration;

use opaline_ipc::{Availability, TopicUpdate, Value};

use super::psi::parse_psi;
use crate::engine::{Probe, Provider, ProviderError, SampleCx, TopicDesc, update};
use crate::sysfs::{HotFile, Root};

pub const USAGE: &str = "memory.usage";
pub const PERCENT: &str = "memory.percent";
pub const SWAP: &str = "memory.swap";
pub const SWAP_PERCENT: &str = "memory.swapPercent";
pub const ZSWAP: &str = "memory.zswap";
pub const ZRAM: &str = "memory.zram";
pub const PRESSURE: &str = "memory.pressure";
pub const INFO: &str = "memory.info";

const TOPICS: &[TopicDesc] = &[
    TopicDesc::new(USAGE),
    TopicDesc::new(PERCENT),
    TopicDesc::new(SWAP),
    TopicDesc::new(SWAP_PERCENT),
    TopicDesc::new(ZSWAP),
    TopicDesc::new(ZRAM),
    TopicDesc::new(PRESSURE),
    TopicDesc::every(INFO, Duration::from_secs(60)),
];

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct DimmRaw {
    size_b: Option<u64>,
    mem_type: Option<String>,
    form_factor: Option<String>,
    speed_mts: Option<u64>,
    configured_speed_mts: Option<u64>,
    manufacturer: Option<String>,
    part_number: Option<String>,
    locator: Option<String>,
}

fn clean_dmi_str(raw: &str) -> Option<String> {
    let s = raw.trim();
    if s.is_empty()
        || s.eq_ignore_ascii_case("Not Specified")
        || s.eq_ignore_ascii_case("Unknown")
        || s.eq_ignore_ascii_case("None")
        || s.eq_ignore_ascii_case("To Be Filled By O.E.M.")
    {
        return None;
    }
    Some(s.to_owned())
}

fn format_stick_size(bytes: u64) -> String {
    const GIB: u64 = 1024 * 1024 * 1024;
    const MIB: u64 = 1024 * 1024;
    if bytes >= GIB && bytes.is_multiple_of(GIB) {
        format!("{} GB", bytes / GIB)
    } else if bytes >= GIB {
        format!("{:.1} GB", bytes as f64 / GIB as f64)
    } else {
        format!("{} MB", bytes / MIB)
    }
}

/// Parses systemd-udevd's world-readable `/run/udev/data/+dmi:id` SMBIOS memory properties
/// (`MEMORY_ARRAY_*` and `MEMORY_DEVICE_<n>_*`), requiring no root privileges.
pub fn parse_udev_dmi_memory(text: &str) -> Option<Value> {
    let mut slots_total: Option<u64> = None;
    let mut max_capacity_b: Option<u64> = None;
    let mut devices: BTreeMap<u32, DimmRaw> = BTreeMap::new();

    for line in text.lines() {
        let Some(rest) = line.strip_prefix("E:") else {
            continue;
        };
        let Some((key, val)) = rest.split_once('=') else {
            continue;
        };
        match key {
            "MEMORY_ARRAY_NUM_DEVICES" => {
                slots_total = val.trim().parse().ok();
            }
            "MEMORY_ARRAY_MAX_CAPACITY" => {
                max_capacity_b = val.trim().parse().ok().filter(|&v| v > 0);
            }
            _ => {
                if let Some(after) = key.strip_prefix("MEMORY_DEVICE_")
                    && let Some((idx_s, field)) = after.split_once('_')
                    && let Ok(idx) = idx_s.parse::<u32>()
                {
                    let dev = devices.entry(idx).or_default();
                    match field {
                        "SIZE" => dev.size_b = val.trim().parse().ok().filter(|&v| v > 0),
                        "TYPE" => dev.mem_type = clean_dmi_str(val),
                        "FORM_FACTOR" => dev.form_factor = clean_dmi_str(val),
                        "SPEED_MTS" => dev.speed_mts = val.trim().parse().ok().filter(|&v| v > 0),
                        "CONFIGURED_SPEED_MTS" => {
                            dev.configured_speed_mts = val.trim().parse().ok().filter(|&v| v > 0);
                        }
                        "MANUFACTURER" => dev.manufacturer = clean_dmi_str(val),
                        "PART_NUMBER" => dev.part_number = clean_dmi_str(val),
                        "LOCATOR" => dev.locator = clean_dmi_str(val),
                        _ => {}
                    }
                }
            }
        }
    }

    if slots_total.is_none() && devices.is_empty() {
        return None;
    }

    let populated: Vec<&DimmRaw> = devices.values().filter(|d| d.size_b.is_some()).collect();
    let slots_used = populated.len() as u64;
    let total = slots_total.unwrap_or(devices.len() as u64).max(slots_used);

    let configured_speed = populated
        .iter()
        .filter_map(|d| d.configured_speed_mts)
        .max();
    let rated_speed = populated.iter().filter_map(|d| d.speed_mts).max();
    let speed_mts = configured_speed.or(rated_speed);

    let mem_type = populated.iter().find_map(|d| d.mem_type.clone());
    let form_factor = populated.iter().find_map(|d| d.form_factor.clone());

    let unique_str = |extract: fn(&DimmRaw) -> Option<&str>| -> Option<String> {
        let mut seen = Vec::new();
        for d in &populated {
            if let Some(v) = extract(d)
                && !seen.iter().any(|x: &String| x == v)
            {
                seen.push(v.to_owned());
            }
        }
        (!seen.is_empty()).then(|| seen.join(", "))
    };
    let manufacturer = unique_str(|d| d.manufacturer.as_deref());
    let part_number = unique_str(|d| d.part_number.as_deref());

    let sizes: Vec<u64> = populated.iter().filter_map(|d| d.size_b).collect();
    let sticks = if sizes.is_empty() {
        None
    } else if sizes.iter().all(|&s| s == sizes[0]) {
        Some(format!("{} × {}", sizes.len(), format_stick_size(sizes[0])))
    } else {
        Some(
            sizes
                .iter()
                .map(|&s| format_stick_size(s))
                .collect::<Vec<_>>()
                .join(" + "),
        )
    };

    let modules = Value::List(
        populated
            .iter()
            .map(|d| {
                Value::map([
                    ("sizeB", Value::from(d.size_b.map(|v| v as f64))),
                    ("type", Value::from(d.mem_type.clone())),
                    ("formFactor", Value::from(d.form_factor.clone())),
                    ("speedMTs", Value::from(d.speed_mts.map(|v| v as f64))),
                    (
                        "configuredSpeedMTs",
                        Value::from(d.configured_speed_mts.map(|v| v as f64)),
                    ),
                    ("manufacturer", Value::from(d.manufacturer.clone())),
                    ("partNumber", Value::from(d.part_number.clone())),
                    ("locator", Value::from(d.locator.clone())),
                ])
            })
            .collect(),
    );

    Some(Value::map([
        ("slotsUsed", Value::Num(slots_used as f64)),
        ("slotsTotal", Value::Num(total as f64)),
        ("speedMTs", Value::from(speed_mts.map(|v| v as f64))),
        ("ratedSpeedMTs", Value::from(rated_speed.map(|v| v as f64))),
        ("type", Value::from(mem_type)),
        ("formFactor", Value::from(form_factor)),
        ("sticks", Value::from(sticks)),
        ("manufacturer", Value::from(manufacturer)),
        ("partNumber", Value::from(part_number)),
        (
            "maxCapacityB",
            Value::from(max_capacity_b.map(|v| v as f64)),
        ),
        ("modules", modules),
    ]))
}

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
    dmi_info: Option<Value>,
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
        let dmi_info = root
            .read("/run/udev/data/+dmi:id")
            .ok()
            .and_then(|raw| parse_udev_dmi_memory(&raw));
        Self {
            meminfo: root.open("/proc/meminfo").ok(),
            pressure: root.open("/proc/pressure/memory").ok(),
            dmi_info,
            root,
        }
    }

    fn zswap_enabled(&self) -> bool {
        self.root
            .read_trim("/sys/module/zswap/parameters/enabled")
            .is_some_and(|v| v == "Y" || v == "1")
    }
}

/// Aggregated statistics from `/sys/block/zram*/mm_stat`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ZramStats {
    pub orig_data_b: u64,
    pub compr_data_b: u64,
    pub mem_used_b: u64,
    pub devices: usize,
}

/// Parses one `/sys/block/zram*/mm_stat` line:
/// `orig_data_size compr_data_size mem_used_total mem_limit mem_used_max same_pages ...`
pub fn parse_zram_mm_stat(text: &str) -> Option<(u64, u64, u64)> {
    let mut parts = text.split_ascii_whitespace();
    let orig: u64 = parts.next()?.parse().ok()?;
    let compr: u64 = parts.next()?.parse().ok()?;
    let mem_used: u64 = parts.next()?.parse().ok()?;
    Some((orig, compr, mem_used))
}

fn read_zram(root: &Root) -> Option<ZramStats> {
    let mut stats = ZramStats::default();
    for entry in root.list("/sys/block") {
        if !entry.starts_with("zram") {
            continue;
        }
        let dir = format!("/sys/block/{entry}");
        let disksize = root.read_u64(format!("{dir}/disksize")).unwrap_or(0);
        let Ok(raw) = root.read(format!("{dir}/mm_stat")) else {
            continue;
        };
        let Some((orig, compr, mem_used)) = parse_zram_mm_stat(&raw) else {
            continue;
        };
        if disksize == 0 && orig == 0 && mem_used == 0 {
            continue;
        }
        stats.orig_data_b = stats.orig_data_b.saturating_add(orig);
        stats.compr_data_b = stats.compr_data_b.saturating_add(compr);
        stats.mem_used_b = stats.mem_used_b.saturating_add(mem_used);
        stats.devices += 1;
    }
    (stats.devices > 0).then_some(stats)
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
        probe = if read_zram(&self.root).is_some() {
            probe.available(ZRAM)
        } else {
            probe.missing(
                ZRAM,
                Availability::Unavailable {
                    reason: "no-zram".into(),
                },
            )
        };
        probe = if self.dmi_info.is_some() {
            probe.available(INFO)
        } else {
            probe.missing(
                INFO,
                Availability::Unavailable {
                    reason: "no-dmi-memory-info".into(),
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
        if cx.is_due(ZRAM) {
            let value = match read_zram(&self.root) {
                Some(z) => Value::map([
                    ("origDataB", Value::Num(z.orig_data_b as f64)),
                    ("comprDataB", Value::Num(z.compr_data_b as f64)),
                    ("memUsedB", Value::Num(z.mem_used_b as f64)),
                    ("devices", Value::Num(z.devices as f64)),
                    (
                        "ratio",
                        if z.compr_data_b > 0 {
                            Value::Num(z.orig_data_b as f64 / z.compr_data_b as f64)
                        } else {
                            Value::unavailable("empty")
                        },
                    ),
                ]),
                None => Value::unavailable("no-zram"),
            };
            out.push(update(ZRAM, value));
        }
        if cx.is_due(PRESSURE) {
            let value = text(&mut self.pressure)
                .as_deref()
                .and_then(parse_psi)
                .map_or_else(|| Value::unavailable("psi-disabled"), |p| p.to_value());
            out.push(update(PRESSURE, value));
        }
        if cx.is_due(INFO) {
            out.push(update(
                INFO,
                self.dmi_info
                    .clone()
                    .unwrap_or_else(|| Value::unavailable("no-dmi-memory-info")),
            ));
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::float_cmp, clippy::panic)]

    use super::*;
    use crate::sysfs::fixture;

    const ALL: &[&str] = &[USAGE, PERCENT, SWAP, SWAP_PERCENT, ZSWAP, ZRAM, PRESSURE];

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

    #[test]
    fn parses_udev_dmi_memory_slots_and_speed() {
        let sample = "\
E:MEMORY_ARRAY_NUM_DEVICES=2
E:MEMORY_ARRAY_MAX_CAPACITY=34359738368
E:MEMORY_DEVICE_0_SIZE=8589934592
E:MEMORY_DEVICE_0_FORM_FACTOR=SODIMM
E:MEMORY_DEVICE_0_TYPE=DDR4
E:MEMORY_DEVICE_0_SPEED_MTS=3200
E:MEMORY_DEVICE_0_CONFIGURED_SPEED_MTS=2933
E:MEMORY_DEVICE_0_MANUFACTURER=SK Hynix
E:MEMORY_DEVICE_0_PART_NUMBER=HMA81GS6DJR8N-XN
E:MEMORY_DEVICE_1_SIZE=8589934592
E:MEMORY_DEVICE_1_FORM_FACTOR=SODIMM
E:MEMORY_DEVICE_1_TYPE=DDR4
E:MEMORY_DEVICE_1_SPEED_MTS=3200
E:MEMORY_DEVICE_1_CONFIGURED_SPEED_MTS=2933
E:MEMORY_DEVICE_1_MANUFACTURER=SK Hynix
E:MEMORY_DEVICE_1_PART_NUMBER=HMA81GS6DJR8N-XN
";
        let v = parse_udev_dmi_memory(sample).unwrap();
        let Value::Map(m) = v else { panic!() };
        assert_eq!(m["slotsUsed"], Value::Num(2.0));
        assert_eq!(m["slotsTotal"], Value::Num(2.0));
        assert_eq!(m["speedMTs"], Value::Num(2933.0));
        assert_eq!(m["ratedSpeedMTs"], Value::Num(3200.0));
        assert_eq!(m["type"], Value::from("DDR4"));
        assert_eq!(m["formFactor"], Value::from("SODIMM"));
        assert_eq!(m["sticks"], Value::from("2 × 8 GB"));
        assert_eq!(m["manufacturer"], Value::from("SK Hynix"));
        assert_eq!(m["partNumber"], Value::from("HMA81GS6DJR8N-XN"));
        assert_eq!(parse_udev_dmi_memory("E:ID_VENDOR=HP\n"), None);
    }

    #[test]
    fn parses_zram_mm_stat_and_samples_topic() {
        assert_eq!(
            parse_zram_mm_stat("1073741824 268435456 300000000 0 310000000 100 0 0\n"),
            Some((1_073_741_824, 268_435_456, 300_000_000))
        );
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("proc")).unwrap();
        std::fs::create_dir_all(dir.path().join("sys/block/zram0")).unwrap();
        std::fs::write(
            dir.path().join("proc/meminfo"),
            "MemTotal: 16000000 kB\nMemAvailable: 8000000 kB\n",
        )
        .unwrap();
        std::fs::write(dir.path().join("sys/block/zram0/disksize"), "4294967296\n").unwrap();
        std::fs::write(
            dir.path().join("sys/block/zram0/mm_stat"),
            "104857600 26214400 30000000 0 30000000 0 0 0\n",
        )
        .unwrap();
        let v = sample(Root::at(dir.path()));
        assert_eq!(field(&v[ZRAM], "origDataB"), 104_857_600.0);
        assert_eq!(field(&v[ZRAM], "comprDataB"), 26_214_400.0);
        assert_eq!(field(&v[ZRAM], "memUsedB"), 30_000_000.0);
        assert_eq!(field(&v[ZRAM], "ratio"), 4.0);
    }
}

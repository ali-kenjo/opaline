//! CPU: usage, clocks, temperatures, throttling, load, uptime and pressure (brief §6 "CPU").

use std::collections::BTreeSet;
use std::time::Duration;

use opaline_ipc::{Availability, TopicUpdate, Value};

use super::hwmon::{self, Device, parse_millidegrees, plausible_celsius};
use super::psi::parse_psi;
use crate::engine::{Probe, Provider, ProviderError, SampleCx, TopicDesc, update};
use crate::sysfs::{HotFile, Root};

pub const LOAD: &str = "cpu.load";
pub const PER_THREAD: &str = "cpu.perThread";
pub const FREQ: &str = "cpu.freq";
pub const FREQ_PER_THREAD: &str = "cpu.freqPerThread";
pub const TEMP: &str = "cpu.temp";
pub const TEMP_PER_CORE: &str = "cpu.tempPerCore";
pub const THROTTLE: &str = "cpu.throttle";
pub const PRESSURE: &str = "cpu.pressure";
pub const INFO: &str = "cpu.info";
pub const LOADAVG: &str = "system.loadavg";
pub const UPTIME: &str = "system.uptime";

const TOPICS: &[TopicDesc] = &[
    TopicDesc::new(LOAD),
    TopicDesc::new(PER_THREAD),
    TopicDesc::new(FREQ),
    TopicDesc::new(FREQ_PER_THREAD),
    TopicDesc::new(TEMP),
    TopicDesc::new(TEMP_PER_CORE),
    TopicDesc::new(THROTTLE),
    TopicDesc::new(PRESSURE),
    TopicDesc::every(INFO, Duration::from_secs(60)),
    TopicDesc::new(LOADAVG),
    TopicDesc::every(UPTIME, Duration::from_secs(10)),
];

/// Busy and total jiffies of one `/proc/stat` CPU line.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Times {
    pub busy: u64,
    pub total: u64,
}

/// Parses `/proc/stat`: the aggregate `cpu` line first, then `cpu0`, `cpu1`, …
/// Busy = user + nice + system + irq + softirq + steal; idle = idle + iowait. Guest time is
/// already part of user time, so it isn't added again.
pub fn parse_stat(text: &str) -> Vec<Times> {
    text.lines()
        .take_while(|line| line.starts_with("cpu"))
        .filter_map(|line| {
            let mut fields = line.split_ascii_whitespace();
            fields.next()?;
            let v: Vec<u64> = fields.take(8).map(|f| f.parse().unwrap_or(0)).collect();
            if v.len() < 4 {
                return None;
            }
            let get = |i: usize| v.get(i).copied().unwrap_or(0);
            let busy = get(0) + get(1) + get(2) + get(5) + get(6) + get(7);
            let idle = get(3) + get(4);
            Some(Times {
                busy,
                total: busy + idle,
            })
        })
        .collect()
}

/// Usage in percent between two readings, or `None` if no time passed (or counters reset).
pub fn usage(prev: Times, cur: Times) -> Option<f64> {
    let total = cur.total.checked_sub(prev.total)?;
    let busy = cur.busy.checked_sub(prev.busy)?;
    (total > 0).then(|| (busy as f64 / total as f64 * 100.0).clamp(0.0, 100.0))
}

/// Parses the first three fields of `/proc/loadavg`.
pub fn parse_loadavg(content: &str) -> Option<[f64; 3]> {
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

/// `/proc/uptime`'s first field, in seconds.
pub fn parse_uptime(content: &str) -> Option<f64> {
    content
        .split_ascii_whitespace()
        .next()?
        .parse()
        .ok()
        .filter(|v: &f64| v.is_finite() && *v >= 0.0)
}

/// Static facts from `/proc/cpuinfo`: model name, vendor, cache, logical CPUs, and `cpu MHz`
/// per CPU (the clock source in VMs without cpufreq).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CpuInfo {
    pub model: Option<String>,
    pub vendor: Option<String>,
    pub cache_size: Option<String>,
    pub threads: usize,
    pub mhz: Vec<f64>,
}

fn friendly_vendor(raw: &str) -> String {
    match raw {
        "GenuineIntel" => "Intel".into(),
        "AuthenticAMD" => "AMD".into(),
        "CentaurHauls" => "VIA".into(),
        "HygonGenuine" => "Hygon".into(),
        other => other.into(),
    }
}

pub fn parse_cpuinfo(text: &str) -> CpuInfo {
    let mut info = CpuInfo::default();
    for line in text.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let (key, value) = (key.trim(), value.trim());
        match key {
            "processor" => info.threads += 1,
            "model name" if info.model.is_none() => info.model = Some(value.to_owned()),
            "vendor_id" if info.vendor.is_none() && !value.is_empty() => {
                info.vendor = Some(friendly_vendor(value));
            }
            "cache size" if info.cache_size.is_none() && !value.is_empty() => {
                info.cache_size = Some(value.to_owned());
            }
            "cpu MHz" => {
                if let Ok(mhz) = value.parse() {
                    info.mhz.push(mhz);
                }
            }
            _ => {}
        }
    }
    info
}

fn parse_cache_kib(raw: &str) -> Option<u64> {
    let s = raw.trim();
    if let Some(n) = s.strip_suffix('K').or_else(|| s.strip_suffix("KB")) {
        return n.trim().parse::<u64>().ok();
    }
    if let Some(n) = s.strip_suffix('M').or_else(|| s.strip_suffix("MB")) {
        return n.trim().parse::<u64>().ok().map(|v| v * 1024);
    }
    if let Some(n) = s.strip_suffix("kB") {
        return n.trim().parse::<u64>().ok();
    }
    s.parse::<u64>().ok()
}

fn format_cache_kib(kib: u64) -> String {
    if kib >= 1024 && kib.is_multiple_of(1024) {
        format!("{} MB", kib / 1024)
    } else if kib >= 1024 {
        format!("{:.1} MB", kib as f64 / 1024.0)
    } else {
        format!("{kib} KB")
    }
}

/// Reads L1/L2/L3 cache sizes from `/sys/devices/system/cpu/cpu0/cache/index*`, falling back to
/// `/proc/cpuinfo`'s `cache size` for L3 if sysfs cache entries aren't present.
fn read_cpu_caches(
    root: &Root,
    fallback_l3: Option<&str>,
) -> (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    let mut l1_kib = 0u64;
    let mut l2_kib = 0u64;
    let mut l3_kib = 0u64;
    let base = "/sys/devices/system/cpu/cpu0/cache";
    for idx in root.list(base) {
        if !idx.starts_with("index") {
            continue;
        }
        let dir = format!("{base}/{idx}");
        let Some(level) = root.read_u64(format!("{dir}/level")) else {
            continue;
        };
        let Some(size_str) = root.read_trim(format!("{dir}/size")) else {
            continue;
        };
        let Some(kib) = parse_cache_kib(&size_str) else {
            continue;
        };
        match level {
            1 => l1_kib = l1_kib.saturating_add(kib),
            2 => l2_kib = l2_kib.max(kib),
            3 => l3_kib = l3_kib.max(kib),
            _ => {}
        }
    }
    if l3_kib == 0
        && let Some(fb) = fallback_l3.and_then(parse_cache_kib)
    {
        l3_kib = fb;
    }
    let l1 = (l1_kib > 0).then(|| format_cache_kib(l1_kib));
    let l2 = (l2_kib > 0).then(|| format_cache_kib(l2_kib));
    let l3 = (l3_kib > 0).then(|| format_cache_kib(l3_kib));
    let mut parts = Vec::new();
    if let Some(ref v) = l3 {
        parts.push(format!("L3 {v}"));
    }
    if let Some(ref v) = l2 {
        parts.push(format!("L2 {v}"));
    }
    if parts.is_empty()
        && let Some(ref v) = l1
    {
        parts.push(format!("L1 {v}"));
    }
    let summary = (!parts.is_empty()).then(|| parts.join(" · "));
    (l1, l2, l3, summary)
}

/// Where the temperatures come from.
#[derive(Debug, Clone, PartialEq)]
pub struct TempSources {
    /// Human-readable source for Diagnostics: `coretemp Package id 0`, `thermal_zone x86_pkg_temp`.
    pub label: String,
    pub package: Vec<String>,
    pub cores: Vec<String>,
    pub crit: Option<f64>,
}

/// Picks the CPU temperature sensors: coretemp, k10temp, zenpower, then thermal zones.
pub fn find_temps(root: &Root, devices: &[Device]) -> Option<TempSources> {
    for dev in devices {
        let labeled = |prefix: &str| -> Vec<&hwmon::Channel> {
            let mut v: Vec<_> = dev
                .temps
                .iter()
                .filter(|c| c.label.as_deref().is_some_and(|l| l.starts_with(prefix)))
                .collect();
            v.sort_by(|a, b| crate::sysfs::natural_cmp(label(a), label(b)));
            v
        };
        let (package, cores) = match dev.name.as_str() {
            "coretemp" => (labeled("Package id"), labeled("Core ")),
            "k10temp" | "zenpower" => {
                let tdie = labeled("Tdie");
                let pkg = if tdie.is_empty() {
                    labeled("Tctl")
                } else {
                    tdie
                };
                (pkg, labeled("Tccd"))
            }
            _ => continue,
        };
        // Old k10temp versions have one unlabeled channel.
        let package = if package.is_empty() && dev.name == "k10temp" {
            dev.temps.iter().take(1).collect()
        } else {
            package
        };
        if package.is_empty() && cores.is_empty() {
            continue;
        }
        let first = package.first().or(cores.first());
        return Some(TempSources {
            label: format!("{} {}", dev.name, first.map_or("", |c| label(c))),
            crit: first.and_then(|c| c.crit.or(c.max)),
            package: package.iter().map(|c| c.input.clone()).collect(),
            cores: cores.iter().map(|c| c.input.clone()).collect(),
        });
    }
    // Fallback: a thermal zone that is about the CPU and reads a plausible value.
    const ZONES: [&str; 5] = [
        "x86_pkg_temp",
        "cpu-thermal",
        "cpu_thermal",
        "soc_thermal",
        "acpitz",
    ];
    let zones: Vec<(String, String)> = root
        .list("/sys/class/thermal")
        .into_iter()
        .filter(|z| z.starts_with("thermal_zone"))
        .filter_map(|z| {
            let dir = format!("/sys/class/thermal/{z}");
            Some((
                root.read_trim(format!("{dir}/type"))?,
                format!("{dir}/temp"),
            ))
        })
        .collect();
    ZONES.iter().find_map(|wanted| {
        let (kind, path) = zones.iter().find(|(kind, path)| {
            kind == wanted
                && root
                    .read(path)
                    .ok()
                    .and_then(|t| parse_millidegrees(t.as_bytes()))
                    .is_some_and(plausible_celsius)
        })?;
        Some(TempSources {
            label: format!("thermal_zone {kind}"),
            package: vec![path.clone()],
            cores: Vec::new(),
            crit: None,
        })
    })
}

fn label(c: &hwmon::Channel) -> &str {
    c.label.as_deref().unwrap_or(&c.id)
}

struct Opened {
    path: String,
    file: Option<HotFile>,
}

impl Opened {
    fn new(root: &Root, path: String) -> Self {
        Self {
            file: root.open(&path).ok(),
            path,
        }
    }

    fn read_u64(&mut self) -> Option<u64> {
        let bytes = self.file.as_mut()?.read().ok()?;
        std::str::from_utf8(bytes).ok()?.trim().parse().ok()
    }

    fn read_celsius(&mut self) -> Option<f64> {
        let bytes = self.file.as_mut()?.read().ok()?;
        parse_millidegrees(bytes).filter(|t| plausible_celsius(*t))
    }
}

pub struct Cpu {
    root: Root,
    stat: Opened,
    loadavg: Opened,
    uptime: Opened,
    pressure: Opened,
    prev: Vec<Times>,
    /// `scaling_cur_freq` (kHz) per policy, with the CPUs it covers.
    freq: Vec<(Opened, usize)>,
    temps: Option<TempSources>,
    pkg_temps: Vec<Opened>,
    core_temps: Vec<Opened>,
    /// One `core_throttle_count` per physical core, and one `package_throttle_count` per package.
    throttle_core: Vec<Opened>,
    throttle_pkg: Vec<Opened>,
    prev_throttle: Option<(u64, u64)>,
    info: Value,
    max_mhz: Option<f64>,
    threads: usize,
}

impl std::fmt::Debug for Cpu {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Cpu")
            .field("root", &self.root)
            .finish_non_exhaustive()
    }
}

impl Cpu {
    pub fn new(root: Root) -> Self {
        let devices = hwmon::discover(&root);
        let temps = find_temps(&root, &devices);
        let cpuinfo = root
            .read("/proc/cpuinfo")
            .map(|t| parse_cpuinfo(&t))
            .unwrap_or_default();

        let policies: Vec<String> = root
            .list("/sys/devices/system/cpu/cpufreq")
            .into_iter()
            .filter(|p| p.starts_with("policy"))
            .map(|p| format!("/sys/devices/system/cpu/cpufreq/{p}"))
            .collect();
        let freq = policies
            .iter()
            .map(|dir| {
                let cpus = root
                    .read_trim(format!("{dir}/affected_cpus"))
                    .map_or(1, |s| s.split_ascii_whitespace().count().max(1));
                (Opened::new(&root, format!("{dir}/scaling_cur_freq")), cpus)
            })
            .collect();
        let khz = |file: &str| -> Option<f64> {
            policies
                .iter()
                .filter_map(|dir| root.read_u64(format!("{dir}/{file}")))
                .max()
                .map(|v| v as f64 / 1000.0)
        };
        let max_mhz = khz("cpuinfo_max_freq");
        let min_mhz = policies
            .iter()
            .filter_map(|dir| root.read_u64(format!("{dir}/cpuinfo_min_freq")))
            .min()
            .map(|v| v as f64 / 1000.0);
        let first_policy = policies.first();
        let policy_text =
            |file: &str| first_policy.and_then(|dir| root.read_trim(format!("{dir}/{file}")));

        // Physical cores, and one throttle counter per core / package.
        let cpus: Vec<String> = root
            .list("/sys/devices/system/cpu")
            .into_iter()
            .filter(|c| {
                c.strip_prefix("cpu")
                    .is_some_and(|n| n.parse::<u32>().is_ok())
            })
            .collect();
        let mut cores = BTreeSet::new();
        let mut packages = BTreeSet::new();
        let mut throttle_core = Vec::new();
        let mut throttle_pkg = Vec::new();
        for cpu in &cpus {
            let dir = format!("/sys/devices/system/cpu/{cpu}");
            let pkg = root.read_trim(format!("{dir}/topology/physical_package_id"));
            let core = root.read_trim(format!("{dir}/topology/core_id"));
            let tt = format!("{dir}/thermal_throttle");
            if cores.insert((pkg.clone(), core)) && root.exists(format!("{tt}/core_throttle_count"))
            {
                throttle_core.push(Opened::new(&root, format!("{tt}/core_throttle_count")));
            }
            if packages.insert(pkg) && root.exists(format!("{tt}/package_throttle_count")) {
                throttle_pkg.push(Opened::new(&root, format!("{tt}/package_throttle_count")));
            }
        }
        let physical = if cores.iter().all(|(_, c)| c.is_some()) && !cores.is_empty() {
            cores.len()
        } else {
            cpuinfo.threads
        };

        let (l1_cache, l2_cache, l3_cache, cache_summary) =
            read_cpu_caches(&root, cpuinfo.cache_size.as_deref());

        let info = Value::map([
            ("model", Value::from(cpuinfo.model.clone())),
            ("vendor", Value::from(cpuinfo.vendor.clone())),
            ("arch", Value::from(std::env::consts::ARCH)),
            ("l1Cache", Value::from(l1_cache)),
            ("l2Cache", Value::from(l2_cache)),
            ("l3Cache", Value::from(l3_cache)),
            ("cache", Value::from(cache_summary)),
            ("cores", Value::Num(physical as f64)),
            (
                "threads",
                Value::Num(cpuinfo.threads.max(cpus.len()) as f64),
            ),
            ("maxMHz", Value::from(max_mhz)),
            ("minMHz", Value::from(min_mhz)),
            ("driver", Value::from(policy_text("scaling_driver"))),
            ("governor", Value::from(policy_text("scaling_governor"))),
            (
                "tempSource",
                Value::from(temps.as_ref().map(|t| t.label.clone())),
            ),
            (
                "throttleSource",
                Value::from(if throttle_core.is_empty() {
                    "inferred"
                } else {
                    "counters"
                }),
            ),
        ]);

        Self {
            stat: Opened::new(&root, "/proc/stat".into()),
            loadavg: Opened::new(&root, "/proc/loadavg".into()),
            uptime: Opened::new(&root, "/proc/uptime".into()),
            pressure: Opened::new(&root, "/proc/pressure/cpu".into()),
            prev: Vec::new(),
            freq,
            pkg_temps: temps
                .iter()
                .flat_map(|t| t.package.clone())
                .map(|p| Opened::new(&root, p))
                .collect(),
            core_temps: temps
                .iter()
                .flat_map(|t| t.cores.clone())
                .map(|p| Opened::new(&root, p))
                .collect(),
            temps,
            throttle_core,
            throttle_pkg,
            prev_throttle: None,
            info,
            max_mhz,
            threads: cpuinfo.threads.max(cpus.len()),
            root,
        }
    }

    fn text(file: &mut Opened) -> Option<String> {
        let bytes = file.file.as_mut()?.read().ok()?;
        std::str::from_utf8(bytes).ok().map(str::to_owned)
    }

    /// Current clock per CPU in MHz: cpufreq policies expanded to their CPUs, or `cpu MHz` from
    /// `/proc/cpuinfo` where there's no cpufreq (VMs).
    fn clocks(&mut self) -> Vec<f64> {
        if self.freq.is_empty() {
            return self
                .root
                .read("/proc/cpuinfo")
                .map(|t| parse_cpuinfo(&t).mhz)
                .unwrap_or_default();
        }
        self.freq
            .iter_mut()
            .filter_map(|(file, cpus)| {
                file.read_u64()
                    .map(|khz| std::iter::repeat_n(khz as f64 / 1000.0, *cpus))
            })
            .flatten()
            .collect()
    }

    fn throttle(&mut self, package_temp: Option<f64>, avg_mhz: Option<f64>) -> Value {
        if self.throttle_core.is_empty() && self.throttle_pkg.is_empty() {
            // No counters: infer it from a hot CPU running well below its top clock.
            let crit = self.temps.as_ref().and_then(|t| t.crit).unwrap_or(100.0);
            let likely = match (package_temp, avg_mhz, self.max_mhz) {
                (Some(t), Some(f), Some(max)) => t >= crit - 5.0 && f < max * 0.7,
                _ => return Value::unavailable("no-throttle-source"),
            };
            return Value::map([
                ("active", Value::Bool(likely)),
                ("certain", Value::Bool(false)),
            ]);
        }
        let sum =
            |files: &mut Vec<Opened>| files.iter_mut().filter_map(Opened::read_u64).sum::<u64>();
        let core = sum(&mut self.throttle_core);
        let pkg = sum(&mut self.throttle_pkg);
        let active = self
            .prev_throttle
            .is_some_and(|(pc, pp)| core > pc || pkg > pp);
        self.prev_throttle = Some((core, pkg));
        Value::map([
            ("active", Value::Bool(active)),
            ("certain", Value::Bool(true)),
            ("coreEvents", Value::Num(core as f64)),
            ("packageEvents", Value::Num(pkg as f64)),
        ])
    }
}

impl Provider for Cpu {
    fn id(&self) -> &'static str {
        "cpu"
    }

    fn topics(&self) -> &[TopicDesc] {
        TOPICS
    }

    fn probe(&mut self) -> Probe {
        let mut probe = Probe::default()
            .detail("threads", self.threads.to_string())
            .detail("cpufreqPolicies", self.freq.len().to_string());
        for topic in [LOAD, PER_THREAD, INFO, LOADAVG, UPTIME] {
            probe = probe.available(topic);
        }
        let temp_why = Availability::Unavailable {
            reason: "no-cpu-temperature-sensor".into(),
        };
        match &self.temps {
            Some(t) => {
                probe = probe.available(TEMP).detail("tempSource", t.label.clone());
                probe = if t.cores.is_empty() {
                    probe.missing(TEMP_PER_CORE, temp_why)
                } else {
                    probe.available(TEMP_PER_CORE)
                };
            }
            None => {
                probe = probe
                    .missing(TEMP, temp_why.clone())
                    .missing(TEMP_PER_CORE, temp_why)
            }
        }
        probe = if self.freq.is_empty() {
            probe.detail("clockSource", "/proc/cpuinfo")
        } else {
            probe.detail("clockSource", "cpufreq")
        };
        probe = probe
            .available(FREQ)
            .available(FREQ_PER_THREAD)
            .available(THROTTLE);
        if self.pressure.file.is_some() {
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

        if cx.is_due(LOAD) || cx.is_due(PER_THREAD) || self.prev.is_empty() {
            let text = Self::text(&mut self.stat)
                .ok_or_else(|| ProviderError::Other(format!("{} unreadable", self.stat.path)))?;
            let cur = parse_stat(&text);
            if cur.len() == self.prev.len() {
                let usages: Vec<Option<f64>> = self
                    .prev
                    .iter()
                    .zip(&cur)
                    .map(|(p, c)| usage(*p, *c))
                    .collect();
                if let Some(Some(total)) = usages.first() {
                    out.push(update(LOAD, *total));
                }
                let per: Vec<f64> = usages.iter().skip(1).map(|u| u.unwrap_or(0.0)).collect();
                if !per.is_empty() {
                    out.push(update(PER_THREAD, Value::Nums(per)));
                }
            }
            self.prev = cur;
        }

        let clocks = if cx.is_due(FREQ) || cx.is_due(FREQ_PER_THREAD) || cx.is_due(THROTTLE) {
            self.clocks()
        } else {
            Vec::new()
        };
        let avg_mhz =
            (!clocks.is_empty()).then(|| clocks.iter().sum::<f64>() / clocks.len() as f64);
        if cx.is_due(FREQ) {
            out.push(update(FREQ, Value::from(avg_mhz)));
        }
        if cx.is_due(FREQ_PER_THREAD) {
            out.push(update(FREQ_PER_THREAD, Value::Nums(clocks.clone())));
        }

        let package_temp = if cx.is_due(TEMP) || cx.is_due(THROTTLE) {
            self.pkg_temps
                .iter_mut()
                .filter_map(Opened::read_celsius)
                .reduce(f64::max)
        } else {
            None
        };
        if cx.is_due(TEMP) {
            out.push(update(
                TEMP,
                match (&self.temps, package_temp) {
                    (None, _) => Value::unavailable("no-cpu-temperature-sensor"),
                    (Some(_), None) => Value::unavailable("implausible-reading"),
                    (Some(_), Some(t)) => Value::Num(t),
                },
            ));
        }
        if cx.is_due(TEMP_PER_CORE) {
            let cores: Vec<f64> = self
                .core_temps
                .iter_mut()
                .filter_map(Opened::read_celsius)
                .collect();
            out.push(update(
                TEMP_PER_CORE,
                if cores.is_empty() {
                    Value::unavailable("no-cpu-temperature-sensor")
                } else {
                    Value::Nums(cores)
                },
            ));
        }
        if cx.is_due(THROTTLE) {
            let value = self.throttle(package_temp, avg_mhz);
            out.push(update(THROTTLE, value));
        }
        if cx.is_due(PRESSURE) {
            let value = Self::text(&mut self.pressure)
                .as_deref()
                .and_then(parse_psi)
                .map_or_else(|| Value::unavailable("psi-disabled"), |p| p.to_value());
            out.push(update(PRESSURE, value));
        }
        if cx.is_due(INFO) {
            out.push(update(INFO, self.info.clone()));
        }
        if cx.is_due(LOADAVG) {
            let value = Self::text(&mut self.loadavg)
                .as_deref()
                .and_then(parse_loadavg)
                .map_or_else(
                    || Value::unavailable("loadavg-unreadable"),
                    |v| Value::Nums(v.to_vec()),
                );
            out.push(update(LOADAVG, value));
        }
        if cx.is_due(UPTIME) {
            let value = Self::text(&mut self.uptime)
                .as_deref()
                .and_then(parse_uptime);
            out.push(update(UPTIME, Value::from(value)));
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::float_cmp, clippy::panic)]

    use super::*;
    use crate::sysfs::fixture;

    const ALL: &[&str] = &[
        LOAD,
        PER_THREAD,
        FREQ,
        FREQ_PER_THREAD,
        TEMP,
        TEMP_PER_CORE,
        THROTTLE,
        PRESSURE,
        INFO,
        LOADAVG,
        UPTIME,
    ];

    fn sample_all(cpu: &mut Cpu) -> std::collections::HashMap<String, Value> {
        let cx = SampleCx {
            now: std::time::Instant::now(),
            due: ALL,
        };
        cpu.sample(&cx)
            .unwrap()
            .into_iter()
            .map(|u| (u.topic.0, u.value))
            .collect()
    }

    fn field<'a>(v: &'a Value, key: &str) -> &'a Value {
        match v {
            Value::Map(m) => m.get(key).unwrap(),
            other => panic!("not a map: {other:?}"),
        }
    }

    #[test]
    fn stat_usage_between_two_readings() {
        let a =
            parse_stat("cpu  100 0 100 800 0 0 0 0 0 0\ncpu0 100 0 100 800 0 0 0 0 0 0\nintr 1\n");
        let b = parse_stat("cpu  150 0 150 900 0 0 0 0 0 0\ncpu0 150 0 150 900 0 0 0 0 0 0\n");
        assert_eq!(a.len(), 2);
        assert_eq!(usage(a[0], b[0]), Some(50.0));
        assert_eq!(
            usage(b[0], a[0]),
            None,
            "counters going backwards are not a usage"
        );
        assert_eq!(usage(a[0], a[0]), None);
    }

    #[test]
    fn loadavg_and_uptime() {
        assert_eq!(
            parse_loadavg("0.52 0.58 0.59 2/1234 98765\n"),
            Some([0.52, 0.58, 0.59])
        );
        assert_eq!(parse_loadavg("0.1 0.2"), None);
        assert_eq!(parse_loadavg("-1 0 0"), None);
        assert_eq!(parse_uptime("12345.67 99999.00\n"), Some(12345.67));
    }

    #[test]
    fn reference_laptop() {
        let mut cpu = Cpu::new(fixture("hp-i5-10300h"));
        let v = sample_all(&mut cpu);
        assert_eq!(v[TEMP], Value::Num(45.0));
        assert_eq!(v[TEMP_PER_CORE], Value::Nums(vec![45.0, 42.0, 43.0, 42.0]));
        assert_eq!(field(&v[INFO], "cores"), &Value::Num(4.0));
        assert_eq!(field(&v[INFO], "threads"), &Value::Num(8.0));
        assert_eq!(field(&v[INFO], "maxMHz"), &Value::Num(4500.0));
        assert_eq!(field(&v[INFO], "driver"), &Value::from("intel_pstate"));
        assert_eq!(
            field(&v[INFO], "tempSource"),
            &Value::from("coretemp Package id 0")
        );
        assert_eq!(field(&v[THROTTLE], "certain"), &Value::Bool(true));
        assert_eq!(field(&v[THROTTLE], "active"), &Value::Bool(false));
        let Value::Nums(clocks) = &v[FREQ_PER_THREAD] else {
            panic!()
        };
        assert_eq!(clocks.len(), 8);
        // Usage needs two readings; the first one only sets the baseline.
        assert!(!v.contains_key(LOAD));
        assert!(matches!(v[PRESSURE], Value::Map(_)));
    }

    #[test]
    fn amd_desktop() {
        let mut cpu = Cpu::new(fixture("synthetic-amd-desktop"));
        let v = sample_all(&mut cpu);
        // Tdie wins over Tctl (Tctl carries an offset on some Ryzen/Threadripper parts).
        assert_eq!(v[TEMP], Value::Num(61.5));
        assert_eq!(v[TEMP_PER_CORE], Value::Nums(vec![58.25, 63.0]));
        assert_eq!(field(&v[INFO], "tempSource"), &Value::from("k10temp Tdie"));
        assert_eq!(field(&v[INFO], "driver"), &Value::from("amd-pstate-epp"));
        // No thermal_throttle counters on AMD: inferred, and not throttling at 61.5 °C.
        assert_eq!(field(&v[THROTTLE], "certain"), &Value::Bool(false));
        assert_eq!(field(&v[THROTTLE], "active"), &Value::Bool(false));
    }

    #[test]
    fn vm_without_sensors_or_cpufreq() {
        let mut cpu = Cpu::new(fixture("synthetic-vm"));
        let v = sample_all(&mut cpu);
        assert_eq!(v[TEMP], Value::unavailable("no-cpu-temperature-sensor"));
        assert_eq!(
            v[FREQ],
            Value::Num(2400.0),
            "clock falls back to /proc/cpuinfo"
        );
        assert_eq!(v[THROTTLE], Value::unavailable("no-throttle-source"));
        assert_eq!(v[PRESSURE], Value::unavailable("psi-disabled"));
    }
}

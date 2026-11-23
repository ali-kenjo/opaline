//! GPUs: DRM enumeration, display mapping, the runtime-PM rule, NVML (NVIDIA), amdgpu sysfs,
//! i915/xe frequency and RC6-based load, and per-process engine time (brief §6 "GPU",
//! ARCHITECTURE §3.2, ADR 0003).
//!
//! **Rule:** every tick starts by reading the card's `power/runtime_status`. If it says
//! `suspended`, the card is reported Asleep and nothing else under the device is read, and NVML
//! is never touched, because that would wake the GPU.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::time::{Duration, Instant};

use opaline_ipc::{Availability, TopicUpdate, Value};

use crate::engine::{Cost, Probe, Provider, ProviderError, SampleCx, TopicDesc, update};
use crate::sysfs::{HotFile, Root};

pub const LIST: &str = "gpu.list";

/// What the NVIDIA backend reports for one GPU. Every field is optional: laptop GPUs don't
/// report fans, some don't report power.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct NvSample {
    pub name: Option<String>,
    pub load: Option<f64>,
    pub temp: Option<f64>,
    pub vram_used: Option<u64>,
    pub vram_total: Option<u64>,
    pub power_w: Option<f64>,
    pub limit_w: Option<f64>,
    pub core_mhz: Option<f64>,
    pub mem_mhz: Option<f64>,
    pub pstate: Option<String>,
    pub fan_percent: Option<f64>,
    pub encoder: Option<f64>,
    pub decoder: Option<f64>,
    /// `(pid, used VRAM in bytes)`.
    pub processes: Vec<(u32, Option<u64>)>,
}

/// Access to NVIDIA GPUs. The real implementation is NVML; tests use a fake that counts calls.
pub trait NvidiaSource: Send {
    /// Samples the GPU at `pci` (`0000:01:00.0`), initialising the library if needed.
    fn sample(&mut self, pci: &str, processes: bool) -> Result<NvSample, Availability>;
    /// Shuts the library down so it holds no `/dev/nvidia*` handle.
    fn release(&mut self);
}

/// NVML, loaded at runtime (`libnvidia-ml.so.1`): absent library = feature hidden.
#[derive(Default)]
pub struct Nvml {
    nvml: Option<nvml_wrapper::Nvml>,
    /// After a failed init, don't retry before this.
    retry_at: Option<Instant>,
    last_error: Option<Availability>,
}

impl std::fmt::Debug for Nvml {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Nvml")
            .field("open", &self.nvml.is_some())
            .finish_non_exhaustive()
    }
}

const NVML_RETRY: Duration = Duration::from_secs(60);

impl NvidiaSource for Nvml {
    fn sample(&mut self, pci: &str, processes: bool) -> Result<NvSample, Availability> {
        use nvml_wrapper::enum_wrappers::device::{Clock, TemperatureSensor};
        use nvml_wrapper::enums::device::UsedGpuMemory;
        use nvml_wrapper::error::NvmlError;

        if self.nvml.is_none() {
            if let (Some(at), Some(error)) = (self.retry_at, &self.last_error)
                && Instant::now() < at
            {
                return Err(error.clone());
            }
            match nvml_wrapper::Nvml::init() {
                Ok(nvml) => {
                    tracing::debug!("NVML initialised");
                    self.nvml = Some(nvml);
                    self.last_error = None;
                }
                Err(error) => {
                    let reason = match error {
                        NvmlError::LibloadingError(_) | NvmlError::LibraryNotFound => {
                            "nvml-missing"
                        }
                        NvmlError::DriverNotLoaded => "nvidia-driver-not-loaded",
                        NvmlError::NoPermission => "nvml-no-permission",
                        _ => "nvml-init-failed",
                    };
                    let why = Availability::Unavailable {
                        reason: reason.into(),
                    };
                    self.retry_at = Some(Instant::now() + NVML_RETRY);
                    self.last_error = Some(why.clone());
                    return Err(why);
                }
            }
        }
        let Some(nvml) = &self.nvml else {
            return Err(Availability::Unavailable {
                reason: "nvml-init-failed".into(),
            });
        };
        let device = nvml
            .device_by_pci_bus_id(pci)
            .map_err(|_| Availability::Unavailable {
                reason: "nvml-device-not-found".into(),
            })?;
        let memory = device.memory_info().ok();
        let utilization = device.utilization_rates().ok();
        let mut s = NvSample {
            name: device.name().ok(),
            load: utilization.as_ref().map(|u| f64::from(u.gpu)),
            temp: device
                .temperature(TemperatureSensor::Gpu)
                .ok()
                .map(f64::from),
            vram_used: memory.as_ref().map(|m| m.used),
            vram_total: memory.as_ref().map(|m| m.total),
            power_w: device.power_usage().ok().map(|mw| f64::from(mw) / 1000.0),
            limit_w: device
                .enforced_power_limit()
                .ok()
                .map(|mw| f64::from(mw) / 1000.0),
            core_mhz: device.clock_info(Clock::Graphics).ok().map(f64::from),
            mem_mhz: device.clock_info(Clock::Memory).ok().map(f64::from),
            pstate: device
                .performance_state()
                .ok()
                .map(|p| format!("P{}", p as u32)),
            fan_percent: device.fan_speed(0).ok().map(f64::from),
            encoder: device
                .encoder_utilization()
                .ok()
                .map(|u| f64::from(u.utilization)),
            decoder: device
                .decoder_utilization()
                .ok()
                .map(|u| f64::from(u.utilization)),
            processes: Vec::new(),
        };
        if processes {
            let mut seen = HashSet::new();
            let graphics = device.running_graphics_processes().unwrap_or_default();
            let compute = device.running_compute_processes().unwrap_or_default();
            for p in graphics.into_iter().chain(compute) {
                if seen.insert(p.pid) {
                    let vram = match p.used_gpu_memory {
                        UsedGpuMemory::Used(b) => Some(b),
                        UsedGpuMemory::Unavailable => None,
                    };
                    s.processes.push((p.pid, vram));
                }
            }
        }
        Ok(s)
    }

    fn release(&mut self) {
        if self.nvml.take().is_some() {
            tracing::debug!("NVML shut down");
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Vendor {
    Nvidia,
    Amd,
    Intel,
    Other,
}

impl Vendor {
    fn from_id(id: u16) -> Self {
        match id {
            0x10de => Self::Nvidia,
            0x1002 => Self::Amd,
            0x8086 => Self::Intel,
            _ => Self::Other,
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Nvidia => "nvidia",
            Self::Amd => "amd",
            Self::Intel => "intel",
            Self::Other => "other",
        }
    }
}

/// Mutter names connectors after the DRM connector type, with HDMI-A shortened to HDMI:
/// `card2-HDMI-A-2` → `HDMI-2`, `card1-eDP-1` → `eDP-1`.
pub fn drm_to_mutter(drm: &str) -> String {
    let name = drm.split_once('-').map_or(drm, |(_, rest)| rest);
    name.replacen("HDMI-A-", "HDMI-", 1)
}

/// Intel Arc (DG2 `0x56xx`, Battlemage `0xe2xx`) is discrete; other Intel GPUs are integrated.
fn intel_discrete(device: u16) -> bool {
    matches!(device >> 8, 0x56 | 0xe2)
}

/// Parses `KEY=value` lines of a sysfs `uevent` file.
fn uevent(text: &str) -> HashMap<&str, &str> {
    text.lines().filter_map(|l| l.split_once('=')).collect()
}

/// Looks a device up in the system's `pci.ids` database: `TU116M [GeForce GTX 1660 Ti Mobile]`.
pub fn pci_name(root: &Root, vendor: u16, device: u16) -> Option<String> {
    let text = ["/usr/share/misc/pci.ids", "/usr/share/hwdata/pci.ids"]
        .iter()
        .find_map(|p| root.read(p).ok())?;
    let vendor_tag = format!("{vendor:04x}  ");
    let device_tag = format!("\t{device:04x}  ");
    let mut in_vendor = false;
    for line in text.lines() {
        if line.starts_with('#') || line.is_empty() {
            continue;
        }
        if !line.starts_with('\t') {
            if in_vendor {
                return None;
            }
            in_vendor = line.starts_with(&vendor_tag);
        } else if in_vendor && let Some(name) = line.strip_prefix(&device_tag) {
            return Some(name.trim().to_owned());
        }
    }
    None
}

/// GPU busy share from an idle-residency counter: `100 × (1 − Δidle / Δwall)`.
pub fn residency_load(prev_idle_ms: u64, idle_ms: u64, wall: Duration) -> Option<f64> {
    let wall_ms = wall.as_secs_f64() * 1000.0;
    let idle = idle_ms.checked_sub(prev_idle_ms)? as f64;
    (wall_ms >= 100.0).then(|| ((1.0 - idle / wall_ms) * 100.0).clamp(0.0, 100.0))
}

/// One DRM client from `/proc/<pid>/fdinfo/<fd>`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DrmClient {
    pub pdev: String,
    pub client_id: u64,
    /// Sum of all `drm-engine-*` counters, in ns.
    pub engine_ns: u64,
    /// `drm-memory-vram` or `drm-total-vram*` in bytes, if reported.
    pub vram: Option<u64>,
}

pub fn parse_fdinfo(text: &str) -> Option<DrmClient> {
    let mut pdev = None;
    let mut client_id = None;
    let mut engine_ns = 0u64;
    let mut vram = None;
    for line in text.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let value = value.trim();
        if key == "drm-pdev" {
            pdev = Some(value.to_owned());
        } else if key == "drm-client-id" {
            client_id = value.parse().ok();
        } else if key.starts_with("drm-engine-") && !key.starts_with("drm-engine-capacity") {
            engine_ns += value
                .split_ascii_whitespace()
                .next()?
                .parse::<u64>()
                .unwrap_or(0);
        } else if key == "drm-memory-vram" || key.starts_with("drm-total-vram") {
            let mut parts = value.split_ascii_whitespace();
            let n: u64 = parts.next()?.parse().ok()?;
            let unit = match parts.next() {
                Some("KiB") => 1024,
                Some("MiB") => 1024 * 1024,
                Some("GiB") => 1024 * 1024 * 1024,
                _ => 1,
            };
            vram = Some(vram.unwrap_or(0) + n * unit);
        }
    }
    Some(DrmClient {
        pdev: pdev?,
        client_id: client_id?,
        engine_ns,
        vram,
    })
}

struct Topics {
    load: &'static str,
    temp: &'static str,
    vram: &'static str,
    power: &'static str,
    clocks: &'static str,
    fan: &'static str,
    encdec: &'static str,
    processes: &'static str,
    state: &'static str,
}

impl Topics {
    fn new(index: usize) -> Self {
        // Topic names live as long as the process; a handful of short strings per GPU.
        let t =
            |m: &str| -> &'static str { Box::leak(format!("gpu.{index}.{m}").into_boxed_str()) };
        Self {
            load: t("load"),
            temp: t("temp"),
            vram: t("vram"),
            power: t("power"),
            clocks: t("clocks"),
            fan: t("fan"),
            encdec: t("encdec"),
            processes: t("processes"),
            state: t("state"),
        }
    }

    fn all(&self) -> [&'static str; 9] {
        [
            self.load,
            self.temp,
            self.vram,
            self.power,
            self.clocks,
            self.fan,
            self.encdec,
            self.processes,
            self.state,
        ]
    }

    fn descs(&self) -> Vec<TopicDesc> {
        self.all()
            .into_iter()
            .map(|name| {
                if name == self.processes {
                    TopicDesc::every(name, Duration::from_secs(2))
                } else {
                    TopicDesc::new(name)
                }
            })
            .collect()
    }
}

/// i915 (`gt_act_freq_mhz`, `gt/gt0/rc6_residency_ms`) or xe (`tile0/gt0/freq0/act_freq`,
/// `tile0/gt0/gtidle/idle_residency_ms`).
struct IntelGt {
    freq: Option<HotFile>,
    max_mhz: Option<f64>,
    idle: Option<HotFile>,
    prev_idle: Option<(u64, Instant)>,
}

struct Amd {
    busy: Option<HotFile>,
    vram_used: Option<HotFile>,
    vram_total: Option<u64>,
    hwmon: Option<String>,
}

struct Card {
    index: usize,
    card: String,
    dev: String,
    pci: String,
    vendor: Vendor,
    driver: String,
    discrete: bool,
    displays: Vec<String>,
    name: String,
    rtd3: Option<String>,
    topics: Topics,
    runtime: Option<HotFile>,
    intel: Option<IntelGt>,
    amd: Option<Amd>,
    /// Engine nanoseconds per `(pid, client id)` at the last process sample.
    prev_engines: HashMap<(u32, u64), u64>,
    prev_engines_at: Option<Instant>,
}

fn read_num<T: std::str::FromStr>(file: &mut Option<HotFile>) -> Option<T> {
    let bytes = file.as_mut()?.read().ok()?;
    std::str::from_utf8(bytes).ok()?.trim().parse().ok()
}

pub struct Gpu {
    root: Root,
    cards: Vec<Card>,
    nvidia: Box<dyn NvidiaSource>,
    topics: Vec<TopicDesc>,
    list: Value,
}

impl std::fmt::Debug for Gpu {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Gpu")
            .field(
                "cards",
                &self
                    .cards
                    .iter()
                    .map(|c| c.card.as_str())
                    .collect::<Vec<_>>(),
            )
            .finish_non_exhaustive()
    }
}

impl Gpu {
    pub fn new(root: Root) -> Self {
        Self::with_nvidia(root, Box::new(Nvml::default()))
    }

    pub fn with_nvidia(root: Root, nvidia: Box<dyn NvidiaSource>) -> Self {
        let entries = root.list("/sys/class/drm");
        let mut found: Vec<(String, u16, u16, String, String, bool)> = entries
            .iter()
            .filter(|e| {
                e.strip_prefix("card")
                    .is_some_and(|n| n.parse::<u32>().is_ok())
            })
            .filter_map(|card| {
                let dev = format!("/sys/class/drm/{card}/device");
                let hex = |f: &str| {
                    root.read_trim(format!("{dev}/{f}"))
                        .and_then(|s| u16::from_str_radix(s.trim_start_matches("0x"), 16).ok())
                };
                let ue = root.read(format!("{dev}/uevent")).unwrap_or_default();
                let ue = uevent(&ue);
                let pci = ue.get("PCI_SLOT_NAME")?.to_string();
                let driver = ue
                    .get("DRIVER")
                    .map_or_else(String::new, |d| (*d).to_owned());
                let boot_vga = root
                    .read_trim(format!("{dev}/boot_vga"))
                    .is_some_and(|b| b == "1");
                Some((
                    card.clone(),
                    hex("vendor")?,
                    hex("device").unwrap_or(0),
                    pci,
                    driver,
                    boot_vga,
                ))
            })
            .collect();
        // Integrated first, then by PCI address, so gpu.0 is the iGPU on hybrid laptops.
        found.sort_by(|a, b| (!a.5, &a.3).cmp(&(!b.5, &b.3)));
        let several = found.len() > 1;

        let cards: Vec<Card> = found
            .into_iter()
            .enumerate()
            .map(
                |(index, (card, vendor_id, device_id, pci, driver, boot_vga))| {
                    let vendor = Vendor::from_id(vendor_id);
                    let dev = format!("/sys/class/drm/{card}/device");
                    let runtime = root.open(format!("{dev}/power/runtime_status")).ok();
                    let awake = root
                        .read_trim(format!("{dev}/power/runtime_status"))
                        .is_none_or(|s| s != "suspended");
                    let discrete = match vendor {
                        Vendor::Nvidia => true,
                        Vendor::Intel => intel_discrete(device_id),
                        // An AMD APU next to a dGPU is the boot VGA device.
                        Vendor::Amd => !(boot_vga && several),
                        Vendor::Other => !boot_vga,
                    };
                    let displays = entries
                        .iter()
                        .filter(|e| e.starts_with(&format!("{card}-")))
                        .filter(|e| {
                            root.read_trim(format!("/sys/class/drm/{e}/status"))
                                .is_some_and(|s| s == "connected")
                        })
                        .map(|e| drm_to_mutter(e))
                        .collect();
                    let rtd3 = (vendor == Vendor::Nvidia)
                        .then(|| {
                            root.read(format!("/proc/driver/nvidia/gpus/{pci}/power"))
                                .ok()
                        })
                        .flatten()
                        .and_then(|t| {
                            t.lines()
                                .find_map(|l| l.strip_prefix("Runtime D3 status:"))
                                .map(|v| v.trim().to_lowercase().replace(' ', "-"))
                        });
                    let name = pci_name(&root, vendor_id, device_id)
                        .unwrap_or_else(|| format!("{} GPU {device_id:04x}", vendor.name()));
                    // Vendor files are opened only while the card is awake (opening is harmless,
                    // but reading them isn't, and a sleeping card gets them on wake-up instead).
                    let intel = (vendor == Vendor::Intel).then(|| intel_files(&root, &card));
                    let amd = (vendor == Vendor::Amd && awake).then(|| amd_files(&root, &dev));
                    Card {
                        topics: Topics::new(index),
                        index,
                        card,
                        dev,
                        pci,
                        vendor,
                        driver,
                        discrete,
                        displays,
                        name,
                        rtd3,
                        runtime,
                        intel,
                        amd,
                        prev_engines: HashMap::new(),
                        prev_engines_at: None,
                    }
                },
            )
            .collect();

        let mut topics = vec![TopicDesc::every(LIST, Duration::from_secs(30))];
        topics.extend(cards.iter().flat_map(|c| c.topics.descs()));
        let list = Value::List(
            cards
                .iter()
                .map(|c| {
                    Value::map([
                        ("index", Value::Num(c.index as f64)),
                        ("card", Value::from(c.card.as_str())),
                        ("pci", Value::from(c.pci.as_str())),
                        ("vendor", Value::from(c.vendor.name())),
                        ("name", Value::from(c.name.as_str())),
                        ("driver", Value::from(c.driver.as_str())),
                        ("discrete", Value::Bool(c.discrete)),
                        (
                            "displays",
                            Value::List(
                                c.displays.iter().map(|d| Value::from(d.as_str())).collect(),
                            ),
                        ),
                    ])
                })
                .collect(),
        );
        Self {
            root,
            cards,
            nvidia,
            topics,
            list,
        }
    }
}

fn intel_files(root: &Root, card: &str) -> IntelGt {
    let base = format!("/sys/class/drm/{card}");
    let xe = format!("{base}/device/tile0/gt0");
    let first = |paths: &[String]| paths.iter().find_map(|p| root.open(p).ok());
    let max = [
        format!("{base}/gt_RP0_freq_mhz"),
        format!("{base}/gt_max_freq_mhz"),
        format!("{xe}/freq0/max_freq"),
    ]
    .iter()
    .find_map(|p| root.read_u64(p))
    .map(|v| v as f64);
    IntelGt {
        freq: first(&[
            format!("{base}/gt_act_freq_mhz"),
            format!("{xe}/freq0/act_freq"),
        ]),
        max_mhz: max,
        idle: first(&[
            format!("{base}/gt/gt0/rc6_residency_ms"),
            format!("{xe}/gtidle/idle_residency_ms"),
        ]),
        prev_idle: None,
    }
}

fn amd_files(root: &Root, dev: &str) -> Amd {
    Amd {
        busy: root.open(format!("{dev}/gpu_busy_percent")).ok(),
        vram_used: root.open(format!("{dev}/mem_info_vram_used")).ok(),
        vram_total: root.read_u64(format!("{dev}/mem_info_vram_total")),
        hwmon: root
            .list(format!("{dev}/hwmon"))
            .first()
            .map(|h| format!("{dev}/hwmon/{h}")),
    }
}

fn not_reported() -> Value {
    Value::unavailable("not-reported")
}

fn num(v: Option<f64>) -> Value {
    v.map_or_else(not_reported, Value::Num)
}

fn vram(used: Option<u64>, total: Option<u64>) -> Value {
    match (used, total) {
        (Some(u), Some(t)) if t > 0 => Value::map([
            ("usedB", Value::Num(u as f64)),
            ("totalB", Value::Num(t as f64)),
            ("percent", Value::Num(u as f64 / t as f64 * 100.0)),
        ]),
        _ => not_reported(),
    }
}

impl Card {
    fn state(&self, runtime_status: &str, extra: Vec<(&str, Value)>) -> Value {
        let mut entries = vec![
            ("awake", Value::Bool(runtime_status != "suspended")),
            ("runtimeStatus", Value::from(runtime_status)),
            ("drivesDisplay", Value::Bool(!self.displays.is_empty())),
        ];
        if let Some(rtd3) = &self.rtd3 {
            entries.push(("rtd3", Value::from(rtd3.as_str())));
        }
        entries.extend(extra);
        Value::map(entries)
    }

    fn process_names(root: &Root, pids: impl Iterator<Item = u32>) -> HashMap<u32, String> {
        pids.map(|pid| {
            let name = root
                .read_trim(format!("/proc/{pid}/comm"))
                .unwrap_or_else(|| pid.to_string());
            (pid, name)
        })
        .collect()
    }

    /// Per-process engine use from DRM fdinfo (the user's own processes; others aren't readable).
    fn fdinfo_processes(&mut self, root: &Root, now: Instant) -> Value {
        let mut clients: HashMap<(u32, u64), (u64, Option<u64>)> = HashMap::new();
        for pid in root
            .list("/proc")
            .into_iter()
            .filter_map(|p| p.parse::<u32>().ok())
        {
            for fd in root.list(format!("/proc/{pid}/fdinfo")) {
                let Ok(text) = root.read(format!("/proc/{pid}/fdinfo/{fd}")) else {
                    continue;
                };
                if let Some(c) = parse_fdinfo(&text).filter(|c| c.pdev == self.pci) {
                    clients.insert((pid, c.client_id), (c.engine_ns, c.vram));
                }
            }
        }
        let wall = self
            .prev_engines_at
            .map(|at| now.duration_since(at).as_nanos() as f64);
        let mut per_pid: BTreeMap<u32, (f64, Option<u64>)> = BTreeMap::new();
        for (&(pid, id), &(ns, vram)) in &clients {
            let busy = match (wall, self.prev_engines.get(&(pid, id))) {
                (Some(w), Some(prev)) if w > 0.0 => ns.saturating_sub(*prev) as f64 / w * 100.0,
                _ => 0.0,
            };
            let entry = per_pid.entry(pid).or_insert((0.0, None));
            entry.0 += busy;
            if let Some(v) = vram {
                entry.1 = Some(entry.1.unwrap_or(0) + v);
            }
        }
        self.prev_engines = clients.into_iter().map(|(k, (ns, _))| (k, ns)).collect();
        self.prev_engines_at = Some(now);
        let names = Self::process_names(root, per_pid.keys().copied());
        let mut list: Vec<(u32, f64, Option<u64>)> = per_pid
            .into_iter()
            .map(|(pid, (busy, vram))| (pid, busy, vram))
            .collect();
        list.sort_by(|a, b| b.1.total_cmp(&a.1));
        Value::List(
            list.into_iter()
                .take(10)
                .map(|(pid, busy, vram)| {
                    Value::map([
                        ("pid", Value::Num(f64::from(pid))),
                        ("name", Value::from(names.get(&pid).cloned())),
                        ("percent", Value::Num(busy.min(100.0))),
                        ("vramB", Value::from(vram.map(|v| v as f64))),
                    ])
                })
                .collect(),
        )
    }
}

impl Provider for Gpu {
    fn id(&self) -> &'static str {
        "gpu"
    }

    fn topics(&self) -> &[TopicDesc] {
        &self.topics
    }

    fn cost_hint(&self) -> Cost {
        if self.cards.iter().any(|c| c.vendor == Vendor::Nvidia) {
            Cost::Moderate
        } else {
            Cost::Cheap
        }
    }

    fn probe(&mut self) -> Probe {
        let mut probe = Probe::default()
            .available(LIST)
            .detail("gpus", self.cards.len().to_string());
        for c in &self.cards {
            probe = probe.detail(
                &format!("gpu.{}", c.index),
                format!(
                    "{} {} ({}, {}, displays: {}, rtd3: {})",
                    c.vendor.name(),
                    c.name,
                    c.driver,
                    if c.discrete { "discrete" } else { "integrated" },
                    if c.displays.is_empty() {
                        "none".to_owned()
                    } else {
                        c.displays.join(", ")
                    },
                    c.rtd3.as_deref().unwrap_or("n/a"),
                ),
            );
            for topic in c.topics.all() {
                probe = probe.available(topic);
            }
        }
        probe
    }

    fn sample(&mut self, cx: &SampleCx<'_>) -> Result<Vec<TopicUpdate>, ProviderError> {
        let mut out = Vec::new();
        if cx.is_due(LIST) {
            out.push(update(LIST, self.list.clone()));
        }
        let root = self.root.clone();
        for card in &mut self.cards {
            let due: Vec<&'static str> = card
                .topics
                .all()
                .into_iter()
                .filter(|t| cx.is_due(t))
                .collect();
            if due.is_empty() {
                continue;
            }
            let t = &card.topics;
            // The runtime-PM rule: this read comes first, and a sleeping card gets nothing else.
            let status = card
                .runtime
                .as_mut()
                .and_then(|f| f.read().ok())
                .and_then(|b| std::str::from_utf8(b).ok())
                .map_or_else(|| "active".to_owned(), |s| s.trim().to_owned());
            if status == "suspended" {
                for topic in &due {
                    let value = if *topic == t.state {
                        card.state(&status, Vec::new())
                    } else {
                        Value::Missing(Availability::Asleep)
                    };
                    out.push(update(topic, value));
                }
                continue;
            }

            let mut values: Vec<(&'static str, Value)> = Vec::new();
            let mut extra_state = Vec::new();
            match card.vendor {
                Vendor::Nvidia => match self.nvidia.sample(&card.pci, due.contains(&t.processes)) {
                    Ok(s) => {
                        values.push((t.load, num(s.load)));
                        values.push((t.temp, num(s.temp)));
                        values.push((t.vram, vram(s.vram_used, s.vram_total)));
                        values.push((
                            t.power,
                            match s.power_w {
                                Some(w) => Value::map([
                                    ("watts", Value::Num(w)),
                                    ("limitW", num(s.limit_w)),
                                ]),
                                None => not_reported(),
                            },
                        ));
                        values.push((
                            t.clocks,
                            Value::map([("coreMHz", num(s.core_mhz)), ("memMHz", num(s.mem_mhz))]),
                        ));
                        values.push((
                            t.fan,
                            s.fan_percent.map_or_else(not_reported, |p| {
                                Value::map([("percent", Value::Num(p))])
                            }),
                        ));
                        values.push((
                            t.encdec,
                            Value::map([("encoder", num(s.encoder)), ("decoder", num(s.decoder))]),
                        ));
                        let names = Card::process_names(&root, s.processes.iter().map(|p| p.0));
                        values.push((
                            t.processes,
                            Value::List(
                                s.processes
                                    .iter()
                                    .map(|(pid, vram)| {
                                        Value::map([
                                            ("pid", Value::Num(f64::from(*pid))),
                                            ("name", Value::from(names.get(pid).cloned())),
                                            ("vramB", Value::from(vram.map(|v| v as f64))),
                                        ])
                                    })
                                    .collect(),
                            ),
                        ));
                        extra_state.push(("pstate", Value::from(s.pstate)));
                        if let Some(name) = s.name {
                            extra_state.push(("name", Value::from(name)));
                        }
                    }
                    Err(why) => {
                        for topic in &due {
                            if *topic != t.state {
                                values.push((topic, Value::Missing(why.clone())));
                            }
                        }
                    }
                },
                Vendor::Amd => {
                    let amd = card.amd.get_or_insert_with(|| amd_files(&root, &card.dev));
                    values.push((t.load, num(read_num::<f64>(&mut amd.busy))));
                    let used = read_num::<u64>(&mut amd.vram_used);
                    values.push((t.vram, vram(used, amd.vram_total)));
                    let hw = amd.hwmon.clone();
                    let read =
                        |f: &str| hw.as_ref().and_then(|h| root.read_i64(format!("{h}/{f}")));
                    values.push((t.temp, num(read("temp1_input").map(|v| v as f64 / 1000.0))));
                    let watts = read("power1_average").or_else(|| read("power1_input"));
                    values.push((
                        t.power,
                        match watts {
                            Some(uw) => Value::map([
                                ("watts", Value::Num(uw as f64 / 1e6)),
                                ("limitW", num(read("power1_cap").map(|v| v as f64 / 1e6))),
                            ]),
                            None => not_reported(),
                        },
                    ));
                    values.push((
                        t.clocks,
                        Value::map([
                            (
                                "coreMHz",
                                num(read("freq1_input").map(|hz| hz as f64 / 1e6)),
                            ),
                            ("memMHz", num(read("freq2_input").map(|hz| hz as f64 / 1e6))),
                        ]),
                    ));
                    let rpm = read("fan1_input");
                    let pwm = read("pwm1").map(|p| p as f64 / 255.0 * 100.0);
                    values.push((
                        t.fan,
                        if rpm.is_none() && pwm.is_none() {
                            not_reported()
                        } else {
                            Value::map([("rpm", num(rpm.map(|r| r as f64))), ("percent", num(pwm))])
                        },
                    ));
                    values.push((t.encdec, not_reported()));
                }
                Vendor::Intel | Vendor::Other => {
                    if let Some(gt) = card.intel.as_mut() {
                        let mhz = read_num::<f64>(&mut gt.freq);
                        values.push((
                            t.clocks,
                            Value::map([("coreMHz", num(mhz)), ("maxCoreMHz", num(gt.max_mhz))]),
                        ));
                        let now = Instant::now();
                        let idle = read_num::<u64>(&mut gt.idle);
                        let load = match (gt.prev_idle, idle) {
                            (Some((prev, at)), Some(cur)) => {
                                residency_load(prev, cur, now.duration_since(at))
                            }
                            _ => None,
                        };
                        if let Some(cur) = idle {
                            gt.prev_idle = Some((cur, now));
                        }
                        // The first reading only sets the baseline.
                        if let Some(load) = load {
                            values.push((t.load, Value::Num(load)));
                        } else if idle.is_none() {
                            values.push((t.load, Value::unavailable("no-busy-counter")));
                        }
                        extra_state.push(("loadApprox", Value::Bool(true)));
                    } else {
                        values.push((t.load, not_reported()));
                        values.push((t.clocks, not_reported()));
                    }
                    let integrated = !card.discrete;
                    values.push((
                        t.vram,
                        if integrated {
                            Value::unavailable("shared-memory")
                        } else {
                            not_reported()
                        },
                    ));
                    values.push((t.temp, not_reported()));
                    values.push((t.power, not_reported()));
                    values.push((t.fan, not_reported()));
                    values.push((t.encdec, not_reported()));
                }
            }
            if card.vendor != Vendor::Nvidia && due.contains(&t.processes) {
                let v = card.fdinfo_processes(&root, cx.now);
                values.push((card.topics.processes, v));
            }
            let t = &card.topics;
            if due.contains(&t.state) {
                values.push((t.state, card.state(&status, extra_state)));
            }
            out.extend(
                values
                    .into_iter()
                    .filter(|(topic, _)| due.contains(topic))
                    .map(|(topic, value)| update(topic, value)),
            );
        }
        Ok(out)
    }

    fn release(&mut self) {
        self.nvidia.release();
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::panic, clippy::float_cmp)]

    use std::sync::Arc;
    use std::sync::atomic::{AtomicU32, Ordering};

    use super::*;
    use crate::sysfs::fixture;

    #[derive(Clone, Default)]
    struct FakeNvidia {
        calls: Arc<AtomicU32>,
        releases: Arc<AtomicU32>,
    }

    impl NvidiaSource for FakeNvidia {
        fn sample(&mut self, pci: &str, _processes: bool) -> Result<NvSample, Availability> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            assert_eq!(pci, "0000:01:00.0");
            Ok(NvSample {
                load: Some(3.0),
                temp: Some(40.0),
                vram_used: Some(33 << 20),
                vram_total: Some(6144 << 20),
                power_w: Some(5.64),
                pstate: Some("P8".into()),
                ..NvSample::default()
            })
        }
        fn release(&mut self) {
            self.releases.fetch_add(1, Ordering::SeqCst);
        }
    }

    fn sample_all(gpu: &mut Gpu) -> HashMap<String, Value> {
        let names: Vec<&'static str> = gpu.topics().iter().map(|t| t.name).collect();
        let cx = SampleCx {
            now: Instant::now(),
            due: &names,
        };
        gpu.sample(&cx)
            .unwrap()
            .into_iter()
            .map(|u| (u.topic.0, u.value))
            .collect()
    }

    fn field<'a>(v: &'a Value, key: &str) -> &'a Value {
        match v {
            Value::Map(m) => m.get(key).unwrap_or_else(|| panic!("no {key} in {m:?}")),
            other => panic!("not a map: {other:?}"),
        }
    }

    #[test]
    fn connector_names_follow_mutter() {
        assert_eq!(drm_to_mutter("card2-HDMI-A-2"), "HDMI-2");
        assert_eq!(drm_to_mutter("card1-eDP-1"), "eDP-1");
        assert_eq!(drm_to_mutter("card0-DP-3"), "DP-3");
    }

    #[test]
    fn residency_math() {
        assert_eq!(
            residency_load(1000, 1750, Duration::from_secs(1)),
            Some(25.0)
        );
        assert_eq!(
            residency_load(1000, 2000, Duration::from_secs(1)),
            Some(0.0)
        );
        assert_eq!(residency_load(2000, 1000, Duration::from_secs(1)), None);
    }

    #[test]
    fn fdinfo_parsing() {
        let c = parse_fdinfo(
            "pos:\t0\ndrm-driver:\ti915\ndrm-pdev:\t0000:00:02.0\ndrm-client-id:\t42\ndrm-engine-render:\t1000 ns\ndrm-engine-video:\t500 ns\ndrm-engine-capacity-video:\t2\ndrm-total-vram0:\t4 MiB\n",
        )
        .unwrap();
        assert_eq!(c.pdev, "0000:00:02.0");
        assert_eq!(c.client_id, 42);
        assert_eq!(c.engine_ns, 1500);
        assert_eq!(c.vram, Some(4 << 20));
        assert_eq!(parse_fdinfo("pos: 0\nflags: 0\n"), None);
    }

    #[test]
    fn reference_laptop() {
        let fake = FakeNvidia::default();
        let mut gpu = Gpu::with_nvidia(fixture("hp-i5-10300h"), Box::new(fake.clone()));
        let v = sample_all(&mut gpu);
        let Value::List(list) = &v[LIST] else {
            panic!()
        };
        assert_eq!(list.len(), 2);
        assert_eq!(field(&list[0], "vendor"), &Value::from("intel"));
        assert_eq!(field(&list[0], "discrete"), &Value::Bool(false));
        assert_eq!(
            field(&list[0], "displays"),
            &Value::List(vec![Value::from("eDP-1")])
        );
        assert_eq!(field(&list[1], "vendor"), &Value::from("nvidia"));
        assert_eq!(field(&list[1], "discrete"), &Value::Bool(true));
        assert_eq!(
            field(&list[1], "displays"),
            &Value::List(vec![Value::from("HDMI-2")])
        );
        // NVIDIA through the (fake) NVML.
        assert_eq!(v["gpu.1.load"], Value::Num(3.0));
        assert_eq!(
            field(&v["gpu.1.vram"], "totalB"),
            &Value::Num(6144.0 * 1048576.0)
        );
        let state = &v["gpu.1.state"];
        assert_eq!(field(state, "awake"), &Value::Bool(true));
        assert_eq!(field(state, "rtd3"), &Value::from("not-supported"));
        assert_eq!(field(state, "drivesDisplay"), &Value::Bool(true));
        assert_eq!(field(state, "pstate"), &Value::from("P8"));
        // Intel: clock from gt_act_freq_mhz, iGPU memory is shared, load needs two readings.
        assert!(matches!(
            field(&v["gpu.0.clocks"], "coreMHz"),
            Value::Num(_)
        ));
        assert_eq!(field(&v["gpu.0.clocks"], "maxCoreMHz"), &Value::Num(1050.0));
        assert_eq!(v["gpu.0.vram"], Value::unavailable("shared-memory"));
        assert!(!v.contains_key("gpu.0.load"));
        gpu.release();
        assert_eq!(fake.releases.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_sleeping_dgpu_is_not_touched() {
        let fake = FakeNvidia::default();
        let root = fixture("synthetic-hybrid-sleeping").recording();
        let mut gpu = Gpu::with_nvidia(root.clone(), Box::new(fake.clone()));
        root.take_accessed();
        let v = sample_all(&mut gpu);
        assert_eq!(v["gpu.1.load"], Value::Missing(Availability::Asleep));
        assert_eq!(v["gpu.1.vram"], Value::Missing(Availability::Asleep));
        assert_eq!(field(&v["gpu.1.state"], "awake"), &Value::Bool(false));
        assert_eq!(
            fake.calls.load(Ordering::SeqCst),
            0,
            "NVML must not be touched"
        );
        // HotFiles were opened at construction; sampling reads through them, so nothing under the
        // sleeping device may even be looked up again.
        let touched: Vec<String> = root
            .take_accessed()
            .into_iter()
            .filter(|p| p.starts_with("/sys/class/drm/card1/device"))
            .collect();
        assert!(touched.is_empty(), "{touched:?}");
    }

    #[test]
    fn amd_desktop() {
        let mut gpu = Gpu::with_nvidia(
            fixture("synthetic-amd-desktop"),
            Box::new(FakeNvidia::default()),
        );
        let v = sample_all(&mut gpu);
        assert_eq!(v["gpu.0.load"], Value::Num(37.0));
        assert_eq!(
            field(&v["gpu.0.vram"], "usedB"),
            &Value::Num(2_147_483_648.0)
        );
        assert_eq!(v["gpu.0.temp"], Value::Num(52.0));
        assert_eq!(field(&v["gpu.0.power"], "watts"), &Value::Num(41.5));
        assert_eq!(field(&v["gpu.0.clocks"], "coreMHz"), &Value::Num(2124.0));
        assert_eq!(field(&v["gpu.0.fan"], "rpm"), &Value::Num(870.0));
        let Value::List(list) = &v[LIST] else {
            panic!()
        };
        assert_eq!(
            field(&list[0], "discrete"),
            &Value::Bool(true),
            "the only AMD GPU is discrete"
        );
    }

    #[test]
    fn intel_arc_on_xe() {
        let mut gpu = Gpu::with_nvidia(
            fixture("synthetic-intel-arc"),
            Box::new(FakeNvidia::default()),
        );
        let v = sample_all(&mut gpu);
        let Value::List(list) = &v[LIST] else {
            panic!()
        };
        assert_eq!(field(&list[0], "discrete"), &Value::Bool(true));
        assert_eq!(field(&list[0], "driver"), &Value::from("xe"));
        assert_eq!(field(&v["gpu.0.clocks"], "coreMHz"), &Value::Num(2400.0));
        assert_eq!(v["gpu.0.vram"], Value::unavailable("not-reported"));
    }

    #[test]
    fn vm_without_gpu() {
        let mut gpu = Gpu::with_nvidia(fixture("synthetic-vm"), Box::new(FakeNvidia::default()));
        let v = sample_all(&mut gpu);
        assert_eq!(v[LIST], Value::List(Vec::new()));
        assert_eq!(gpu.topics().len(), 1);
    }
}

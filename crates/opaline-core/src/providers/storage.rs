//! Storage: real filesystems grouped by physical drive, space, throughput and busy time, NVMe
//! temperatures, IO pressure (brief §6 "Storage"). Health comes from UDisks2 (`udisks.rs`).

use std::collections::{BTreeMap, HashMap};
use std::time::{Duration, Instant};

use opaline_ipc::{Availability, TopicUpdate, Value};

use super::hwmon::{parse_millidegrees, plausible_celsius};
use super::psi::parse_psi;
use crate::engine::{Probe, Provider, ProviderError, SampleCx, TopicDesc, update};
use crate::sysfs::{HotFile, Root};

pub const DRIVES: &str = "storage.drives";
pub const IO: &str = "storage.io";
pub const TEMPS: &str = "storage.temps";
pub const PRESSURE: &str = "storage.pressure";

const TOPICS: &[TopicDesc] = &[
    TopicDesc::every(DRIVES, Duration::from_secs(5)),
    TopicDesc::new(IO),
    TopicDesc::every(TEMPS, Duration::from_secs(2)),
    TopicDesc::new(PRESSURE),
];

/// Pseudo and image filesystems that are never shown (snaps are squashfs on loop devices).
const EXCLUDED_FS: &[&str] = &[
    "squashfs", "tmpfs", "overlay", "devtmpfs", "ramfs", "proc", "sysfs", "cgroup2", "nsfs",
];

/// NVMe drives that report less than this while the machine runs are probably wrong
/// (SENSORS.md: the reference drive reports ~7 °C). The UI adds a hint.
const SUSPECT_LOW_CELSIUS: f64 = 15.0;

/// One line of `/proc/self/mountinfo`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mount {
    pub source: String,
    pub point: String,
    pub fs: String,
    /// The mounted subtree; `/` for a normal mount, something else for bind mounts.
    pub root: String,
}

/// Undoes mountinfo's octal escapes (`\040` = space). Works on bytes so UTF-8 names survive.
fn unescape(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\\'
            && let Some(code) = s
                .get(i + 1..i + 4)
                .and_then(|o| u8::from_str_radix(o, 8).ok())
        {
            out.push(code);
            i += 4;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn parse_mountinfo(text: &str) -> Vec<Mount> {
    text.lines()
        .filter_map(|line| {
            let (left, right) = line.split_once(" - ")?;
            let left: Vec<&str> = left.split(' ').collect();
            let mut right = right.split(' ');
            let fs = right.next()?;
            let source = right.next()?;
            Some(Mount {
                root: unescape(left.get(3)?),
                point: unescape(left.get(4)?),
                fs: fs.to_owned(),
                source: unescape(source),
            })
        })
        .collect()
}

/// Block-device filesystems worth showing: no snaps, pseudo filesystems or bind mounts, and
/// each device only once (its first mount).
pub fn real_mounts(mounts: &[Mount]) -> Vec<Mount> {
    let mut seen = std::collections::HashSet::new();
    mounts
        .iter()
        .filter(|m| m.source.starts_with("/dev/") && m.root == "/")
        .filter(|m| !EXCLUDED_FS.contains(&m.fs.as_str()))
        .filter(|m| !m.source.trim_start_matches("/dev/").starts_with("loop"))
        .filter(|m| seen.insert(m.source.clone()))
        .cloned()
        .collect()
}

/// Space on a filesystem, as `df` computes it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Space {
    pub total: u64,
    pub used: u64,
    /// Available to unprivileged users (`f_bavail`).
    pub avail: u64,
}

/// Reads filesystem space. The product uses `statvfs`; tests use fixed numbers.
pub trait SpaceSource: Send {
    fn space(&self, mount_point: &str) -> Option<Space>;
}

#[derive(Debug, Default)]
pub struct Statvfs;

impl SpaceSource for Statvfs {
    fn space(&self, mount_point: &str) -> Option<Space> {
        let s = rustix::fs::statvfs(mount_point).ok()?;
        let f = s.f_frsize.max(1);
        Some(Space {
            total: s.f_blocks * f,
            used: s.f_blocks.saturating_sub(s.f_bfree) * f,
            avail: s.f_bavail * f,
        })
    }
}

/// Counters of one `/proc/diskstats` line.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct DiskStat {
    pub sectors_read: u64,
    pub sectors_written: u64,
    /// Milliseconds the device had I/O in flight.
    pub io_ticks: u64,
}

pub fn parse_diskstats(text: &str) -> HashMap<String, DiskStat> {
    text.lines()
        .filter_map(|line| {
            let f: Vec<&str> = line.split_ascii_whitespace().collect();
            let n = |i: usize| f.get(i).and_then(|v| v.parse::<u64>().ok());
            Some((
                (*f.get(2)?).to_owned(),
                DiskStat {
                    sectors_read: n(5)?,
                    sectors_written: n(9)?,
                    io_ticks: n(12)?,
                },
            ))
        })
        .collect()
}

/// A physical drive and its partitions, from `/sys/block`.
#[derive(Debug, Clone, PartialEq)]
pub struct Drive {
    pub name: String,
    pub model: Option<String>,
    pub size: u64,
    pub removable: bool,
    pub read_only: bool,
    pub rotational: bool,
    pub partitions: Vec<(String, u64)>,
}

fn bus_of(name: &str) -> &'static str {
    if name.starts_with("nvme") {
        "nvme"
    } else if name.starts_with("mmcblk") {
        "mmc"
    } else if name.starts_with("sd") {
        "scsi"
    } else if name.starts_with("vd") {
        "virtio"
    } else {
        "other"
    }
}

/// Lists physical drives, skipping loop, RAM, zram and device-mapper devices (those are
/// resolved to the drives underneath them).
pub fn discover_drives(root: &Root) -> Vec<Drive> {
    root.list("/sys/block")
        .into_iter()
        .filter(|n| {
            !["loop", "ram", "zram", "dm-", "md", "sr", "fd"]
                .iter()
                .any(|p| n.starts_with(p))
        })
        .map(|name| {
            let dir = format!("/sys/block/{name}");
            let partitions = root
                .list(&dir)
                .into_iter()
                .filter(|p| root.exists(format!("{dir}/{p}/partition")))
                .map(|p| {
                    let size = root.read_u64(format!("{dir}/{p}/size")).unwrap_or(0) * 512;
                    (p, size)
                })
                .collect();
            Drive {
                model: root
                    .read_trim(format!("{dir}/device/model"))
                    .filter(|m| !m.is_empty()),
                size: root.read_u64(format!("{dir}/size")).unwrap_or(0) * 512,
                removable: root
                    .read_trim(format!("{dir}/removable"))
                    .is_some_and(|v| v == "1"),
                read_only: root
                    .read_trim(format!("{dir}/ro"))
                    .is_some_and(|v| v == "1"),
                rotational: root
                    .read_trim(format!("{dir}/queue/rotational"))
                    .is_some_and(|v| v == "1"),
                partitions,
                name,
            }
        })
        .collect()
}

/// The drive a mounted device lives on: a partition's parent, a whole disk itself, or (for
/// `/dev/mapper/*` and `/dev/dm-*`) the drive under the device-mapper target.
fn owner_drive(root: &Root, drives: &[Drive], device: &str) -> Option<(String, String)> {
    let mut name = device.trim_start_matches("/dev/").to_owned();
    if let Some(mapped) = name.strip_prefix("mapper/") {
        name = root
            .list("/sys/block")
            .into_iter()
            .filter(|d| d.starts_with("dm-"))
            .find(|d| {
                root.read_trim(format!("/sys/block/{d}/dm/name")).as_deref() == Some(mapped)
            })?;
    }
    if name.starts_with("dm-") {
        let slave = root
            .list(format!("/sys/block/{name}/slaves"))
            .into_iter()
            .next()?;
        return owner_drive(root, drives, &slave);
    }
    drives.iter().find_map(|d| {
        if d.name == name {
            Some((d.name.clone(), name.clone()))
        } else {
            d.partitions
                .iter()
                .any(|(p, _)| *p == name)
                .then(|| (d.name.clone(), name.clone()))
        }
    })
}

pub struct Storage {
    root: Root,
    space: Box<dyn SpaceSource>,
    diskstats: Option<HotFile>,
    pressure: Option<HotFile>,
    prev: Option<(HashMap<String, DiskStat>, Instant)>,
    temps: Vec<(String, HotFile)>,
    /// Drive names, refreshed with `storage.drives` (listing `/sys/block` walks every loop
    /// device, too slow for the 1 s throughput topic).
    names: Vec<String>,
}

impl std::fmt::Debug for Storage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Storage")
            .field("root", &self.root)
            .finish_non_exhaustive()
    }
}

impl Storage {
    pub fn new(root: Root) -> Self {
        Self::with_space(root, Box::new(Statvfs))
    }

    pub fn with_space(root: Root, space: Box<dyn SpaceSource>) -> Self {
        let temps = discover_drives(&root)
            .into_iter()
            .filter_map(|d| {
                let dev = format!("/sys/block/{}/device", d.name);
                let hwmon = root
                    .list(&dev)
                    .into_iter()
                    .find(|e| e.starts_with("hwmon"))?;
                let file = root.open(format!("{dev}/{hwmon}/temp1_input")).ok()?;
                Some((d.name, file))
            })
            .collect();
        let names = discover_drives(&root).into_iter().map(|d| d.name).collect();
        Self {
            names,
            diskstats: root.open("/proc/diskstats").ok(),
            pressure: root.open("/proc/pressure/io").ok(),
            prev: None,
            temps,
            space,
            root,
        }
    }

    fn drives_value(&mut self) -> Value {
        let drives = discover_drives(&self.root);
        self.names = drives.iter().map(|d| d.name.clone()).collect();
        let mounts = self
            .root
            .read("/proc/self/mountinfo")
            .map(|t| real_mounts(&parse_mountinfo(&t)))
            .unwrap_or_default();
        // partition name -> (mount point, fs, space)
        let mut mounted: HashMap<String, (String, String, Option<Space>)> = HashMap::new();
        for m in &mounts {
            if let Some((_, part)) = owner_drive(&self.root, &drives, &m.source) {
                mounted
                    .entry(part)
                    .or_insert_with(|| (m.point.clone(), m.fs.clone(), self.space.space(&m.point)));
            }
        }
        Value::List(
            drives
                .iter()
                .map(|d| {
                    let mut names: Vec<(String, u64)> = d.partitions.clone();
                    if names.is_empty() {
                        names.push((d.name.clone(), d.size));
                    }
                    let (mut used, mut avail, mut any) = (0u64, 0u64, false);
                    let partitions: Vec<Value> = names
                        .iter()
                        .map(|(name, size)| {
                            let mut e = vec![
                                ("name", Value::from(name.as_str())),
                                ("sizeB", Value::Num(*size as f64)),
                            ];
                            if let Some((point, fs, space)) = mounted.get(name) {
                                any = true;
                                e.push(("mount", Value::from(point.as_str())));
                                e.push(("fs", Value::from(fs.as_str())));
                                if let Some(s) = space {
                                    used += s.used;
                                    avail += s.avail;
                                    let denom = s.used + s.avail;
                                    e.push(("usedB", Value::Num(s.used as f64)));
                                    e.push(("availB", Value::Num(s.avail as f64)));
                                    e.push(("totalB", Value::Num(s.total as f64)));
                                    e.push((
                                        "percent",
                                        Value::Num(if denom == 0 {
                                            0.0
                                        } else {
                                            s.used as f64 / denom as f64 * 100.0
                                        }),
                                    ));
                                }
                            }
                            Value::map(e)
                        })
                        .collect();
                    let mut e = vec![
                        ("name", Value::from(d.name.as_str())),
                        ("model", Value::from(d.model.clone())),
                        ("bus", Value::from(bus_of(&d.name))),
                        ("sizeB", Value::Num(d.size as f64)),
                        ("removable", Value::Bool(d.removable)),
                        ("readOnly", Value::Bool(d.read_only)),
                        ("rotational", Value::Bool(d.rotational)),
                        ("mounted", Value::Bool(any)),
                        ("partitions", Value::List(partitions)),
                    ];
                    if any {
                        e.push(("usedB", Value::Num(used as f64)));
                        e.push(("availB", Value::Num(avail as f64)));
                    }
                    Value::map(e)
                })
                .collect(),
        )
    }

    fn io_value(&mut self, now: Instant) -> Option<Value> {
        let bytes = self.diskstats.as_mut()?.read().ok()?;
        let stats = parse_diskstats(std::str::from_utf8(bytes).ok()?);
        let drives = &self.names;
        let result = self.prev.as_ref().map(|(prev, at)| {
            let secs = now.duration_since(*at).as_secs_f64();
            let mut map = BTreeMap::new();
            for name in drives {
                let (Some(cur), Some(old)) = (stats.get(name), prev.get(name)) else {
                    continue;
                };
                if secs <= 0.0 {
                    continue;
                }
                let rate = |c: u64, o: u64| c.saturating_sub(o) as f64 * 512.0 / secs;
                let busy = (cur.io_ticks.saturating_sub(old.io_ticks) as f64 / (secs * 1000.0)
                    * 100.0)
                    .min(100.0);
                map.insert(
                    name.clone(),
                    Value::map([
                        (
                            "readBps",
                            Value::Num(rate(cur.sectors_read, old.sectors_read)),
                        ),
                        (
                            "writeBps",
                            Value::Num(rate(cur.sectors_written, old.sectors_written)),
                        ),
                        ("busyPercent", Value::Num(busy)),
                    ]),
                );
            }
            Value::Map(map)
        });
        self.prev = Some((stats, now));
        result
    }

    fn temps_value(&mut self) -> Value {
        Value::Map(
            self.temps
                .iter_mut()
                .map(|(name, file)| {
                    let t = file
                        .read()
                        .ok()
                        .and_then(parse_millidegrees)
                        .filter(|t| plausible_celsius(*t));
                    let v = match t {
                        Some(t) => Value::map([
                            ("tempC", Value::Num(t)),
                            ("suspectLow", Value::Bool(t < SUSPECT_LOW_CELSIUS)),
                        ]),
                        None => Value::unavailable("not-reported"),
                    };
                    (name.clone(), v)
                })
                .collect(),
        )
    }
}

impl Provider for Storage {
    fn id(&self) -> &'static str {
        "storage"
    }

    fn topics(&self) -> &[TopicDesc] {
        TOPICS
    }

    fn probe(&mut self) -> Probe {
        let drives = discover_drives(&self.root);
        let mut probe = Probe::default().available(DRIVES).available(IO).detail(
            "drives",
            drives
                .iter()
                .map(|d| d.name.clone())
                .collect::<Vec<_>>()
                .join(", "),
        );
        probe = if self.temps.is_empty() {
            probe.missing(
                TEMPS,
                Availability::Unavailable {
                    reason: "no-drive-temperature-sensor".into(),
                },
            )
        } else {
            probe.available(TEMPS)
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
        if cx.is_due(DRIVES) {
            out.push(update(DRIVES, self.drives_value()));
        }
        if cx.is_due(IO)
            && let Some(v) = self.io_value(cx.now)
        {
            out.push(update(IO, v));
        }
        if cx.is_due(TEMPS) {
            out.push(update(TEMPS, self.temps_value()));
        }
        if cx.is_due(PRESSURE) {
            let value = self
                .pressure
                .as_mut()
                .and_then(|f| f.read().ok())
                .and_then(|b| std::str::from_utf8(b).ok())
                .and_then(parse_psi)
                .map_or_else(|| Value::unavailable("psi-disabled"), |p| p.to_value());
            out.push(update(PRESSURE, value));
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::panic, clippy::float_cmp)]

    use super::*;
    use crate::sysfs::fixture;

    struct FixedSpace;

    impl SpaceSource for FixedSpace {
        fn space(&self, point: &str) -> Option<Space> {
            match point {
                "/" => Some(Space {
                    total: 500 << 30,
                    used: 200 << 30,
                    avail: 275 << 30,
                }),
                "/boot/efi" => Some(Space {
                    total: 1 << 30,
                    used: 6 << 20,
                    avail: (1 << 30) - (6 << 20),
                }),
                _ => None,
            }
        }
    }

    fn field<'a>(v: &'a Value, key: &str) -> &'a Value {
        match v {
            Value::Map(m) => m.get(key).unwrap_or_else(|| panic!("no {key} in {m:?}")),
            other => panic!("not a map: {other:?}"),
        }
    }

    #[test]
    fn mountinfo_keeps_real_filesystems_only() {
        let text = fixture("hp-i5-10300h")
            .read("/proc/self/mountinfo")
            .unwrap();
        let mounts = real_mounts(&parse_mountinfo(&text));
        let points: Vec<&str> = mounts.iter().map(|m| m.point.as_str()).collect();
        assert_eq!(points, ["/", "/boot/efi"]);
    }

    #[test]
    fn escapes_and_bind_mounts() {
        let text = "1 0 8:1 / /media/Mein\\040Laufwerk\\040ä rw - ext4 /dev/sdb1 rw\n2 0 8:1 /sub /mnt/bind rw - ext4 /dev/sdb1 rw\n3 0 7:0 / /snap/x/1 ro - squashfs /dev/loop0 ro\n";
        let mounts = real_mounts(&parse_mountinfo(text));
        assert_eq!(mounts.len(), 1);
        assert_eq!(mounts[0].point, "/media/Mein Laufwerk ä");
    }

    #[test]
    fn reference_laptop_drives() {
        let mut s = Storage::with_space(fixture("hp-i5-10300h"), Box::new(FixedSpace));
        let cx = SampleCx {
            now: Instant::now(),
            due: &[DRIVES, IO, TEMPS, PRESSURE],
        };
        let v: HashMap<String, Value> = s
            .sample(&cx)
            .unwrap()
            .into_iter()
            .map(|u| (u.topic.0, u.value))
            .collect();
        let Value::List(drives) = &v[DRIVES] else {
            panic!()
        };
        let names: Vec<&Value> = drives.iter().map(|d| field(d, "name")).collect();
        assert_eq!(names, [&Value::from("nvme0n1"), &Value::from("sda")]);
        let nvme = &drives[0];
        assert_eq!(field(nvme, "bus"), &Value::from("nvme"));
        assert_eq!(field(nvme, "mounted"), &Value::Bool(true));
        assert_eq!(
            field(nvme, "usedB"),
            &Value::Num((200u64 << 30) as f64 + (6u64 << 20) as f64)
        );
        let Value::List(parts) = field(nvme, "partitions") else {
            panic!()
        };
        assert_eq!(field(&parts[1], "mount"), &Value::from("/"));
        assert_eq!(field(&parts[1], "fs"), &Value::from("ext4"));
        // The internal SATA SSD isn't mounted: health yes, space no.
        let sda = &drives[1];
        assert_eq!(field(sda, "mounted"), &Value::Bool(false));
        // SCSI model strings are 16 bytes in sysfs; UDisks2 has the full name.
        assert_eq!(field(sda, "model"), &Value::from("Samsung SSD 870"));
        // The NVMe reports ~11.85 °C: shown, but flagged.
        let nvme_temp = field(&v[TEMPS], "nvme0n1");
        assert_eq!(field(nvme_temp, "tempC"), &Value::Num(11.85));
        assert_eq!(field(nvme_temp, "suspectLow"), &Value::Bool(true));
        // Throughput needs two readings.
        assert!(!v.contains_key(IO));
    }

    #[test]
    fn diskstats_rates() {
        let a = parse_diskstats(" 259 0 nvme0n1 10 0 1000 0 5 0 2000 0 0 100 0\n");
        assert_eq!(a["nvme0n1"].sectors_read, 1000);
        assert_eq!(a["nvme0n1"].sectors_written, 2000);
        assert_eq!(a["nvme0n1"].io_ticks, 100);
    }
}

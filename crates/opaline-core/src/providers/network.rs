//! Network interfaces and rates from sysfs/procfs (brief §6 "Network"). Wi-Fi, VPN and
//! connectivity come from NetworkManager (`nm.rs`), latency from `latency.rs`, data usage from
//! `usage.rs`.

use std::collections::{BTreeMap, HashMap};
use std::time::{Duration, Instant};

use opaline_ipc::{TopicUpdate, Value};

use crate::engine::{Probe, Provider, ProviderError, SampleCx, TopicDesc, update};
use crate::sysfs::{HotFile, Root};

pub const INTERFACES: &str = "network.interfaces";
pub const RATES: &str = "network.rates";
/// `[rx, tx]` bytes per second summed over physical interfaces (for history and charts).
pub const TOTAL: &str = "network.total";

const TOPICS: &[TopicDesc] = &[
    TopicDesc::every(INTERFACES, Duration::from_secs(5)),
    TopicDesc::new(RATES),
    TopicDesc::new(TOTAL),
];

/// Byte counters per interface from `/proc/net/dev`.
pub fn parse_net_dev(text: &str) -> HashMap<String, [u64; 2]> {
    text.lines()
        .skip(2)
        .filter_map(|line| {
            let (name, rest) = line.split_once(':')?;
            let f: Vec<u64> = rest
                .split_ascii_whitespace()
                .filter_map(|v| v.parse().ok())
                .collect();
            Some((name.trim().to_owned(), [*f.first()?, *f.get(8)?]))
        })
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Loopback,
    Wifi,
    Ethernet,
    Vpn,
    Bridge,
    Virtual,
}

impl Kind {
    pub fn name(self) -> &'static str {
        match self {
            Self::Loopback => "loopback",
            Self::Wifi => "wifi",
            Self::Ethernet => "ethernet",
            Self::Vpn => "vpn",
            Self::Bridge => "bridge",
            Self::Virtual => "virtual",
        }
    }
}

/// Classifies an interface: physical ones have a `device` link; Wi-Fi has `wireless/`.
pub fn classify(root: &Root, name: &str) -> (Kind, bool) {
    let dir = format!("/sys/class/net/{name}");
    let physical = root.exists(format!("{dir}/device"));
    let kind = if name == "lo" {
        Kind::Loopback
    } else if root.exists(format!("{dir}/wireless")) {
        Kind::Wifi
    } else if root.exists(format!("{dir}/tun_flags"))
        || ["wg", "tun", "tap", "tailscale", "nordlynx", "proton", "ppp"]
            .iter()
            .any(|p| name.starts_with(p))
    {
        Kind::Vpn
    } else if root.exists(format!("{dir}/bridge"))
        || name.starts_with("br-")
        || name.starts_with("virbr")
    {
        Kind::Bridge
    } else if physical {
        Kind::Ethernet
    } else {
        Kind::Virtual
    };
    (
        kind,
        physical && matches!(kind, Kind::Wifi | Kind::Ethernet),
    )
}

/// Rates between two counter readings, or `None` after a counter reset.
pub fn rate(prev: [u64; 2], cur: [u64; 2], secs: f64) -> Option<[f64; 2]> {
    if secs <= 0.0 {
        return None;
    }
    Some([
        cur[0].checked_sub(prev[0])? as f64 / secs,
        cur[1].checked_sub(prev[1])? as f64 / secs,
    ])
}

pub struct Network {
    root: Root,
    dev: Option<HotFile>,
    prev: Option<(HashMap<String, [u64; 2]>, Instant)>,
    /// Interface name → (kind, physical); refreshed with `network.interfaces`.
    kinds: BTreeMap<String, (Kind, bool)>,
}

impl std::fmt::Debug for Network {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Network")
            .field("root", &self.root)
            .finish_non_exhaustive()
    }
}

impl Network {
    pub fn new(root: Root) -> Self {
        let mut n = Self {
            dev: root.open("/proc/net/dev").ok(),
            prev: None,
            kinds: BTreeMap::new(),
            root,
        };
        n.refresh_kinds();
        n
    }

    fn refresh_kinds(&mut self) {
        self.kinds = self
            .root
            .list("/sys/class/net")
            .into_iter()
            .map(|name| {
                let c = classify(&self.root, &name);
                (name, c)
            })
            .collect();
    }

    fn interfaces_value(&mut self) -> Value {
        self.refresh_kinds();
        Value::List(
            self.kinds
                .iter()
                .filter(|(_, (kind, _))| *kind != Kind::Loopback)
                .map(|(name, (kind, physical))| {
                    let dir = format!("/sys/class/net/{name}");
                    let state = self.root.read_trim(format!("{dir}/operstate"));
                    // `speed` is -1 (or unreadable) while the link is down.
                    let speed = (*kind == Kind::Ethernet)
                        .then(|| self.root.read_i64(format!("{dir}/speed")))
                        .flatten()
                        .filter(|s| *s > 0);
                    let mut e = vec![
                        ("name", Value::from(name.as_str())),
                        ("kind", Value::from(kind.name())),
                        ("physical", Value::Bool(*physical)),
                        ("up", Value::Bool(state.as_deref() == Some("up"))),
                    ];
                    if let Some(s) = speed {
                        e.push(("speedMbps", Value::Num(s as f64)));
                    }
                    Value::map(e)
                })
                .collect(),
        )
    }
}

impl Provider for Network {
    fn id(&self) -> &'static str {
        "network"
    }

    fn topics(&self) -> &[TopicDesc] {
        TOPICS
    }

    fn probe(&mut self) -> Probe {
        let physical: Vec<&str> = self
            .kinds
            .iter()
            .filter(|(_, (_, p))| *p)
            .map(|(n, (k, _))| if *k == Kind::Wifi { "wifi" } else { n.as_str() })
            .collect();
        Probe::default()
            .available(INTERFACES)
            .available(RATES)
            .available(TOTAL)
            .detail("physicalInterfaces", physical.len().to_string())
    }

    fn sample(&mut self, cx: &SampleCx<'_>) -> Result<Vec<TopicUpdate>, ProviderError> {
        let mut out = Vec::new();
        if cx.is_due(INTERFACES) {
            out.push(update(INTERFACES, self.interfaces_value()));
        }
        if cx.is_due(RATES) || cx.is_due(TOTAL) {
            let bytes = self
                .dev
                .as_mut()
                .ok_or_else(|| ProviderError::Other("/proc/net/dev unreadable".into()))?
                .read()?;
            let counters = parse_net_dev(
                std::str::from_utf8(bytes).map_err(|e| ProviderError::Other(e.to_string()))?,
            );
            if let Some((prev, at)) = &self.prev {
                let secs = cx.now.duration_since(*at).as_secs_f64();
                let mut rates = BTreeMap::new();
                let mut total = [0.0f64; 2];
                for (name, cur) in &counters {
                    let Some((kind, physical)) = self.kinds.get(name) else {
                        continue;
                    };
                    if *kind == Kind::Loopback {
                        continue;
                    }
                    let Some(r) = prev.get(name).and_then(|p| rate(*p, *cur, secs)) else {
                        continue;
                    };
                    if *physical {
                        total[0] += r[0];
                        total[1] += r[1];
                    }
                    rates.insert(
                        name.clone(),
                        Value::map([("rxBps", Value::Num(r[0])), ("txBps", Value::Num(r[1]))]),
                    );
                }
                if cx.is_due(RATES) {
                    out.push(update(RATES, Value::Map(rates)));
                }
                if cx.is_due(TOTAL) {
                    out.push(update(TOTAL, Value::Nums(total.to_vec())));
                }
            }
            self.prev = Some((counters, cx.now));
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::panic, clippy::float_cmp)]

    use super::*;
    use crate::sysfs::fixture;

    #[test]
    fn net_dev_counters() {
        let text = fixture("hp-i5-10300h").read("/proc/net/dev").unwrap();
        let c = parse_net_dev(&text);
        assert_eq!(c["wlo1"], [25_786_504_369, 999_860_177]);
        assert_eq!(c["eno1"], [0, 0]);
    }

    #[test]
    fn classification() {
        let root = fixture("hp-i5-10300h");
        assert_eq!(classify(&root, "wlo1"), (Kind::Wifi, true));
        assert_eq!(classify(&root, "eno1"), (Kind::Ethernet, true));
        assert_eq!(classify(&root, "lo"), (Kind::Loopback, false));
        let none = fixture("synthetic-vm");
        assert_eq!(classify(&none, "docker0").0, Kind::Virtual);
        assert_eq!(classify(&none, "wg0").0, Kind::Vpn);
        assert_eq!(classify(&none, "br-1a2b").0, Kind::Bridge);
        assert_eq!(classify(&none, "veth12ab").0, Kind::Virtual);
    }

    #[test]
    fn rates_and_resets() {
        assert_eq!(rate([100, 200], [300, 400], 2.0), Some([100.0, 100.0]));
        assert_eq!(
            rate([300, 400], [100, 400], 1.0),
            None,
            "a counter reset is not a negative rate"
        );
    }

    #[test]
    fn reference_interfaces() {
        let mut n = Network::new(fixture("hp-i5-10300h"));
        let v = n.interfaces_value();
        let Value::List(list) = v else { panic!() };
        let get = |i: usize, k: &str| match &list[i] {
            Value::Map(m) => m.get(k).cloned(),
            _ => None,
        };
        assert_eq!(list.len(), 2, "loopback is hidden");
        assert_eq!(get(0, "name"), Some(Value::from("eno1")));
        assert_eq!(get(0, "up"), Some(Value::Bool(false)));
        assert_eq!(get(0, "speedMbps"), None, "speed -1 while down");
        assert_eq!(get(1, "kind"), Some(Value::from("wifi")));
        assert_eq!(get(1, "up"), Some(Value::Bool(true)));
    }
}

//! `opaline-privileged`: a D-Bus-activated, read-only system service that gives Opaline the CPU
//! energy counters (RAPL), which current kernels make root-only (ARCHITECTURE §6, ADR 0004).
//!
//! - One method, `GetCpuEnergy()`, reading only a fixed allow-list of powercap files.
//! - Every call is checked with polkit (`io.github.ali_kenjo.opaline.read-sensors`, active
//!   local sessions only) and rate-limited to 4 calls per second per caller.
//! - Exits after 60 s without calls; D-Bus starts it again on the next call.

use std::collections::{HashMap, VecDeque};
use std::path::Path;
use std::process::ExitCode;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use tokio::sync::Notify;
use zbus::message::Header;
use zbus::{Connection, Variant, fdo, interface};

const NAME: &str = "io.github.ali_kenjo.Opaline.Privileged";
const PATH: &str = "/io/github/ali_kenjo/Opaline/Privileged";
const ACTION: &str = "io.github.ali_kenjo.opaline.read-sensors";
const POWERCAP: &str = "/sys/class/powercap";
const IDLE_EXIT: Duration = Duration::from_secs(60);
const RATE_LIMIT: usize = 4;
const RATE_WINDOW: Duration = Duration::from_secs(1);

/// `intel-rapl:N`, `intel-rapl:N:M`, `intel-rapl-mmio:N`, `intel-rapl-mmio:N:M`; nothing else.
pub fn allowed_zone(name: &str) -> bool {
    let rest = name
        .strip_prefix("intel-rapl-mmio:")
        .or_else(|| name.strip_prefix("intel-rapl:"));
    let Some(rest) = rest else { return false };
    let parts: Vec<&str> = rest.split(':').collect();
    (1..=2).contains(&parts.len())
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.len() <= 3 && p.chars().all(|c| c.is_ascii_digit()))
}

/// Reads `(zone, domain name, energy_uj, max_energy_range_uj)` for every allowed zone.
pub fn read_energy(powercap: &Path) -> Vec<(String, String, u64, u64)> {
    let Ok(entries) = std::fs::read_dir(powercap) else {
        return Vec::new();
    };
    let mut zones: Vec<String> = entries
        .flatten()
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|z| allowed_zone(z))
        .collect();
    zones.sort();
    zones
        .into_iter()
        .filter_map(|zone| {
            let dir = powercap.join(&zone);
            let read = |f: &str| std::fs::read_to_string(dir.join(f)).ok();
            let name = read("name")?.trim().to_owned();
            let energy = read("energy_uj")?.trim().parse().ok()?;
            let max = read("max_energy_range_uj")?.trim().parse().ok()?;
            Some((zone, name, energy, max))
        })
        .collect()
}

/// At most `RATE_LIMIT` calls per `RATE_WINDOW` per caller.
#[derive(Debug, Default)]
pub struct RateLimiter {
    calls: HashMap<String, VecDeque<Instant>>,
}

impl RateLimiter {
    pub fn allow(&mut self, caller: &str, now: Instant) -> bool {
        let calls = self.calls.entry(caller.to_owned()).or_default();
        while calls
            .front()
            .is_some_and(|t| now.duration_since(*t) >= RATE_WINDOW)
        {
            calls.pop_front();
        }
        if calls.len() >= RATE_LIMIT {
            return false;
        }
        calls.push_back(now);
        // Forget callers that went quiet.
        self.calls.retain(|_, c| !c.is_empty());
        true
    }
}

struct Service {
    conn: Connection,
    limiter: Mutex<RateLimiter>,
    activity: Arc<Notify>,
}

impl Service {
    async fn authorized(&self, caller: &str) -> fdo::Result<bool> {
        let mut subject_details: HashMap<&str, Variant<'_>> = HashMap::new();
        subject_details.insert("name", Variant::from(caller));
        let details: HashMap<&str, &str> = HashMap::new();
        let reply = self
            .conn
            .call_method(
                Some("org.freedesktop.PolicyKit1"),
                "/org/freedesktop/PolicyKit1/Authority",
                Some("org.freedesktop.PolicyKit1.Authority"),
                "CheckAuthorization",
                &(
                    ("system-bus-name", subject_details),
                    ACTION,
                    details,
                    0u32,
                    "",
                ),
            )
            .await
            .map_err(|e| fdo::Error::Failed(format!("polkit: {e}")))?;
        let (authorized, _challenge, _details): (bool, bool, HashMap<String, String>) = reply
            .body()
            .deserialize()
            .map_err(|e| fdo::Error::Failed(format!("polkit reply: {e}")))?;
        Ok(authorized)
    }
}

#[interface(name = "io.github.ali_kenjo.Opaline.Privileged1")]
impl Service {
    /// RAPL counters: `(domain, energy_uj, max_energy_range_uj)` per zone, in zone order.
    async fn get_cpu_energy(
        &self,
        #[zbus(header)] header: Header<'_>,
    ) -> fdo::Result<Vec<(String, u64, u64)>> {
        self.activity.notify_one();
        let caller = header
            .sender()
            .map(ToString::to_string)
            .ok_or_else(|| fdo::Error::AccessDenied("no sender".into()))?;
        let allowed = self
            .limiter
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .allow(&caller, Instant::now());
        if !allowed {
            return Err(fdo::Error::LimitsExceeded(
                "at most 4 calls per second".into(),
            ));
        }
        if !self.authorized(&caller).await? {
            return Err(fdo::Error::AccessDenied("not authorized by polkit".into()));
        }
        Ok(read_energy(Path::new(POWERCAP))
            .into_iter()
            .map(|(_, name, energy, max)| (name, energy, max))
            .collect())
    }
}

async fn serve() -> zbus::Result<()> {
    let conn = Connection::system().await?;
    let activity = Arc::new(Notify::new());
    let service = Service {
        conn: conn.clone(),
        limiter: Mutex::new(RateLimiter::default()),
        activity: activity.clone(),
    };
    conn.object_server().at(PATH, service).await?;
    conn.request_name(NAME).await?;
    // Exit once nobody has called for a while.
    loop {
        if tokio::time::timeout(IDLE_EXIT, activity.notified())
            .await
            .is_err()
        {
            return Ok(());
        }
    }
}

fn main() -> ExitCode {
    let rt = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(error) => {
            eprintln!("opaline-privileged: {error}");
            return ExitCode::FAILURE;
        }
    };
    match rt.block_on(serve()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("opaline-privileged: {error}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    #[test]
    fn only_rapl_zones() {
        assert!(allowed_zone("intel-rapl:0"));
        assert!(allowed_zone("intel-rapl:0:2"));
        assert!(allowed_zone("intel-rapl-mmio:0"));
        assert!(!allowed_zone("intel-rapl"));
        assert!(!allowed_zone("intel-rapl:"));
        assert!(!allowed_zone("intel-rapl:0:1:2"));
        assert!(!allowed_zone("intel-rapl:../../etc"));
        assert!(!allowed_zone("dtpm:0"));
    }

    #[test]
    fn reads_only_allowed_zones() {
        let dir = std::env::temp_dir().join(format!("opaline-priv-{}", std::process::id()));
        for (zone, name, e) in [
            ("intel-rapl:0", "package-0", "1000"),
            ("intel-rapl:0:0", "core", "500"),
            ("evil", "x", "1"),
        ] {
            let z = dir.join(zone);
            std::fs::create_dir_all(&z).unwrap();
            std::fs::write(z.join("name"), format!("{name}\n")).unwrap();
            std::fs::write(z.join("energy_uj"), e).unwrap();
            std::fs::write(z.join("max_energy_range_uj"), "262143328850").unwrap();
        }
        let got = read_energy(&dir);
        std::fs::remove_dir_all(&dir).unwrap();
        let names: Vec<&str> = got.iter().map(|z| z.1.as_str()).collect();
        assert_eq!(names, ["package-0", "core"]);
        assert_eq!(got[0].2, 1000);
    }

    #[test]
    fn rate_limit() {
        let mut l = RateLimiter::default();
        let t = Instant::now();
        for _ in 0..4 {
            assert!(l.allow(":1.5", t));
        }
        assert!(!l.allow(":1.5", t), "fifth call in the same second");
        assert!(l.allow(":1.6", t), "per caller");
        assert!(l.allow(":1.5", t + Duration::from_millis(1001)));
    }
}

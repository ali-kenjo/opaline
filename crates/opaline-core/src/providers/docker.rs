//! Docker / Podman: endpoint resolution (ADR 0005), containers with Compose grouping, CPU and
//! memory, start/stop/restart, and starting Docker Desktop (brief §6 "Docker / Podman").

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use bollard::Docker;
use bollard::models::{ContainerStatsResponse, ContainerSummary};
use bollard::query_parameters::{ListContainersOptionsBuilder, StatsOptionsBuilder};
use futures_util::StreamExt;
use opaline_ipc::{TopicUpdate, Value};

use crate::engine::{update, while_subscribed};
use crate::hub::Hub;

pub const STATE: &str = "docker.state";
pub const CONTAINERS: &str = "docker.containers";
pub const TOPICS: &[&str] = &[STATE, CONTAINERS];
const PERIOD: Duration = Duration::from_secs(5);
const TIMEOUT_S: u64 = 5;
const DESKTOP_UNIT: &str = "docker-desktop.service";
const COMPOSE_PROJECT: &str = "com.docker.compose.project";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Candidate {
    /// `unix:///path` or `tcp://host:port`.
    pub host: String,
    /// Where it came from: `DOCKER_HOST`, `context:<name>`, `default`, `podman`.
    pub source: String,
    pub podman: bool,
}

fn context_endpoints(home: &Path) -> (Option<String>, Vec<(String, String)>) {
    let current = std::fs::read_to_string(home.join(".docker/config.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| v.get("currentContext")?.as_str().map(str::to_owned));
    let meta_dir = home.join(".docker/contexts/meta");
    let contexts = std::fs::read_dir(meta_dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let text = std::fs::read_to_string(e.path().join("meta.json")).ok()?;
            let v: serde_json::Value = serde_json::from_str(&text).ok()?;
            let name = v.get("Name")?.as_str()?.to_owned();
            let host = v
                .get("Endpoints")?
                .get("docker")?
                .get("Host")?
                .as_str()?
                .to_owned();
            Some((name, host))
        })
        .collect();
    (current, contexts)
}

fn socket_exists(host: &str) -> bool {
    host.strip_prefix("unix://")
        .is_some_and(|p| Path::new(p).exists())
}

/// Endpoints to try, in ADR 0005's order.
pub fn candidates(
    docker_host: Option<&str>,
    home: &Path,
    runtime_dir: Option<&Path>,
) -> Vec<Candidate> {
    let mut out = Vec::new();
    let mut push = |host: String, source: String, podman: bool| {
        if !out.iter().any(|c: &Candidate| c.host == host) {
            out.push(Candidate {
                host,
                source,
                podman,
            });
        }
    };
    if let Some(h) = docker_host.filter(|h| !h.is_empty()) {
        push(h.to_owned(), "DOCKER_HOST".into(), false);
    }
    let (current, contexts) = context_endpoints(home);
    let default_sock = "unix:///var/run/docker.sock".to_owned();
    match current.as_deref() {
        Some("default") | None => push(default_sock.clone(), "default".into(), false),
        Some(name) => {
            if let Some((_, host)) = contexts.iter().find(|(n, _)| n == name) {
                push(host.clone(), format!("context:{name}"), false);
            }
        }
    }
    for (name, host) in &contexts {
        if socket_exists(host) {
            push(host.clone(), format!("context:{name}"), false);
        }
    }
    push(default_sock, "default".into(), false);
    if let Some(rt) = runtime_dir {
        push(
            format!("unix://{}", rt.join("podman/podman.sock").display()),
            "podman".into(),
            true,
        );
    }
    out
}

/// Why no engine answered.
pub fn no_engine_state(candidates: &[Candidate], desktop_unit_exists: bool) -> &'static str {
    let denied = candidates.iter().any(|c| {
        c.host.strip_prefix("unix://").is_some_and(|p| {
            std::os::unix::net::UnixStream::connect(p)
                .err()
                .is_some_and(|e| e.kind() == std::io::ErrorKind::PermissionDenied)
        })
    });
    if denied {
        "permission-denied"
    } else if desktop_unit_exists {
        "desktop-stopped"
    } else {
        "not-installed"
    }
}

fn desktop_unit_exists(home: &Path) -> bool {
    [
        PathBuf::from("/usr/lib/systemd/user").join(DESKTOP_UNIT),
        PathBuf::from("/etc/systemd/user").join(DESKTOP_UNIT),
        home.join(".config/systemd/user").join(DESKTOP_UNIT),
    ]
    .iter()
    .any(|p| p.exists())
}

fn connect(c: &Candidate) -> Option<Docker> {
    if c.host.starts_with("unix://") {
        if !socket_exists(&c.host) {
            return None;
        }
        Docker::connect_with_unix(&c.host, TIMEOUT_S, bollard::API_DEFAULT_VERSION).ok()
    } else if let Some(rest) = c.host.strip_prefix("tcp://") {
        Docker::connect_with_http(
            &format!("http://{rest}"),
            TIMEOUT_S,
            bollard::API_DEFAULT_VERSION,
        )
        .ok()
    } else {
        None
    }
}

/// One container's resource use.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Usage {
    /// Share of the machine, in percent.
    pub cpu: Option<f64>,
    pub mem: Option<u64>,
    pub limit: Option<u64>,
}

/// `(total_usage, system_cpu_usage)` of one stats reading, for the next delta.
pub type CpuCounters = (u64, u64);

/// CPU as a share of the machine between two stats readings, and memory like `docker stats`
/// (usage minus inactive file cache).
pub fn usage(
    prev: Option<CpuCounters>,
    s: &ContainerStatsResponse,
) -> (Usage, Option<CpuCounters>) {
    let cpu = s.cpu_stats.as_ref();
    let total = cpu.and_then(|c| c.cpu_usage.as_ref()?.total_usage);
    let system = cpu.and_then(|c| c.system_cpu_usage);
    let now = total.zip(system);
    let percent = match (prev, now) {
        (Some((pt, ps)), Some((t, s))) if s > ps => {
            Some(t.saturating_sub(pt) as f64 / (s - ps) as f64 * 100.0)
        }
        _ => None,
    };
    let mem = s.memory_stats.as_ref();
    let used = mem.and_then(|m| {
        let cache = m
            .stats
            .as_ref()
            .and_then(|st| st.get("inactive_file").copied())
            .unwrap_or(0);
        Some(m.usage?.saturating_sub(cache))
    });
    (
        Usage {
            cpu: percent,
            mem: used,
            limit: mem.and_then(|m| m.limit),
        },
        now,
    )
}

pub fn container_value(
    c: &ContainerSummary,
    cpu: Option<f64>,
    mem: Option<u64>,
    limit: Option<u64>,
) -> Value {
    let name = c
        .names
        .as_ref()
        .and_then(|n| n.first())
        .map(|n| n.trim_start_matches('/').to_owned());
    let project = c
        .labels
        .as_ref()
        .and_then(|l| l.get(COMPOSE_PROJECT).cloned());
    let state = c.state.map(|s| s.to_string().to_lowercase());
    let mut ports: Vec<String> = c
        .ports
        .as_ref()
        .into_iter()
        .flatten()
        .filter_map(|p| {
            let pub_port = p.public_port?;
            Some(format!("{pub_port}:{}", p.private_port))
        })
        .collect();
    ports.sort();
    ports.dedup();
    Value::map([
        (
            "id",
            Value::from(
                c.id.as_ref()
                    .map(|i| i.chars().take(12).collect::<String>()),
            ),
        ),
        ("name", Value::from(name)),
        ("image", Value::from(c.image.clone())),
        ("state", Value::from(state)),
        ("status", Value::from(c.status.clone())),
        ("project", Value::from(project)),
        (
            "ports",
            Value::List(ports.into_iter().map(Value::from).collect()),
        ),
        ("cpu", Value::from(cpu)),
        ("memB", Value::from(mem.map(|m| m as f64))),
        ("memLimitB", Value::from(limit.map(|m| m as f64))),
    ])
}

#[derive(Debug, Default)]
struct Memory {
    prev: HashMap<String, (u64, u64)>,
}

/// Container IDs (full) from the last listing, with the endpoint they belong to.
static KNOWN: Mutex<Option<(Candidate, HashSet<String>)>> = Mutex::new(None);

fn home() -> PathBuf {
    std::env::var_os("HOME").map_or_else(|| PathBuf::from("/"), PathBuf::from)
}

fn find_engine() -> Result<(Candidate, Docker), (Vec<Candidate>, &'static str)> {
    let rt = std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from);
    let list = candidates(
        std::env::var("DOCKER_HOST").ok().as_deref(),
        &home(),
        rt.as_deref(),
    );
    for c in &list {
        if let Some(d) = connect(c) {
            return Ok((c.clone(), d));
        }
    }
    let state = no_engine_state(&list, desktop_unit_exists(&home()));
    Err((list, state))
}

async fn fetch(memory: &Mutex<Memory>) -> Result<Vec<TopicUpdate>, String> {
    let (candidate, docker) = match find_engine() {
        Ok(v) => v,
        Err((_, state)) => {
            return Ok(vec![
                update(STATE, Value::map([("status", Value::from(state))])),
                update(CONTAINERS, Value::unavailable(state)),
            ]);
        }
    };
    let version = match docker.version().await {
        Ok(v) => v.version,
        Err(_) => {
            let state = if candidate.source.starts_with("context:desktop")
                && desktop_unit_exists(&home())
            {
                "desktop-stopped"
            } else {
                "unreachable"
            };
            return Ok(vec![
                update(STATE, Value::map([("status", Value::from(state))])),
                update(CONTAINERS, Value::unavailable(state)),
            ]);
        }
    };
    let list = docker
        .list_containers(Some(
            ListContainersOptionsBuilder::default().all(true).build(),
        ))
        .await
        .map_err(|e| e.to_string())?;
    let running: Vec<String> = list
        .iter()
        .filter(|c| {
            c.state
                .is_some_and(|s| s.to_string().eq_ignore_ascii_case("running"))
        })
        .filter_map(|c| c.id.clone())
        .collect();
    let stats = futures_util::future::join_all(running.iter().map(|id| {
        let docker = docker.clone();
        let id = id.clone();
        async move {
            let opts = StatsOptionsBuilder::default()
                .stream(false)
                .one_shot(true)
                .build();
            let s = docker
                .stats(&id, Some(opts))
                .next()
                .await
                .and_then(Result::ok);
            (id, s)
        }
    }))
    .await;
    let mut usage_by_id: BTreeMap<String, Usage> = BTreeMap::new();
    {
        let mut mem = memory.lock().unwrap_or_else(PoisonError::into_inner);
        for (id, s) in stats {
            if let Some(s) = s {
                let (u, now) = usage(mem.prev.get(&id).copied(), &s);
                if let Some(now) = now {
                    mem.prev.insert(id.clone(), now);
                }
                usage_by_id.insert(id, u);
            }
        }
        mem.prev.retain(|id, _| running.contains(id));
    }
    *KNOWN.lock().unwrap_or_else(PoisonError::into_inner) = Some((
        candidate.clone(),
        list.iter().filter_map(|c| c.id.clone()).collect(),
    ));
    let containers = list
        .iter()
        .map(|c| {
            let u =
                c.id.as_ref()
                    .and_then(|id| usage_by_id.get(id).copied())
                    .unwrap_or_default();
            container_value(c, u.cpu, u.mem, u.limit)
        })
        .collect();
    Ok(vec![
        update(
            STATE,
            Value::map([
                ("status", Value::from("running")),
                (
                    "engine",
                    Value::from(if candidate.podman { "podman" } else { "docker" }),
                ),
                ("endpoint", Value::from(candidate.source.as_str())),
                ("version", Value::from(version)),
            ]),
        ),
        update(CONTAINERS, Value::List(containers)),
    ])
}

pub async fn run(hub: Arc<Hub>) -> Result<(), String> {
    let memory = Arc::new(Mutex::new(Memory::default()));
    while_subscribed(&hub, TOPICS, PERIOD, || {
        let memory = memory.clone();
        async move { fetch(&memory).await }
    })
    .await
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContainerAction {
    Start,
    Stop,
    Restart,
}

/// Starts, stops or restarts a container from the current listing (12-character or full ID).
pub async fn container_action(id: &str, action: ContainerAction) -> Result<(), String> {
    let (candidate, full) = {
        let known = KNOWN.lock().unwrap_or_else(PoisonError::into_inner);
        let (candidate, ids) = known.as_ref().ok_or("unknown-container")?;
        let full = ids
            .iter()
            .find(|full| id.len() >= 12 && full.starts_with(id))
            .cloned()
            .ok_or("unknown-container")?;
        (candidate.clone(), full)
    };
    let docker = connect(&candidate).ok_or("engine-unreachable")?;
    match action {
        ContainerAction::Start => docker.start_container(&full, None).await,
        ContainerAction::Stop => docker.stop_container(&full, None).await,
        ContainerAction::Restart => docker.restart_container(&full, None).await,
    }
    .map_err(|e| e.to_string())
}

/// Starts Docker Desktop through the user's systemd (`StartUnit`).
pub async fn start_desktop() -> Result<(), String> {
    if !desktop_unit_exists(&home()) {
        return Err("docker-desktop-not-installed".into());
    }
    let conn = zbus::Connection::session()
        .await
        .map_err(|e| e.to_string())?;
    conn.call_method(
        Some("org.freedesktop.systemd1"),
        "/org/freedesktop/systemd1",
        Some("org.freedesktop.systemd1.Manager"),
        "StartUnit",
        &(DESKTOP_UNIT, "replace"),
    )
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::panic)]

    use bollard::models::{
        ContainerCpuStats, ContainerCpuUsage, ContainerMemoryStats, ContainerSummaryStateEnum,
    };

    use super::*;

    fn write(dir: &Path, rel: &str, text: &str) {
        let p = dir.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }

    #[test]
    fn resolution_order_follows_adr_0005() {
        let home = tempfile::tempdir().unwrap();
        let sock = home.path().join(".docker/desktop/docker.sock");
        write(
            home.path(),
            ".docker/config.json",
            r#"{"currentContext":"default"}"#,
        );
        write(
            home.path(),
            ".docker/contexts/meta/abc/meta.json",
            &format!(
                r#"{{"Name":"desktop-linux","Endpoints":{{"docker":{{"Host":"unix://{}"}}}}}}"#,
                sock.display()
            ),
        );
        // Docker Desktop not running: its socket doesn't exist, so it isn't a candidate.
        let c = candidates(None, home.path(), Some(Path::new("/run/user/1000")));
        let sources: Vec<&str> = c.iter().map(|c| c.source.as_str()).collect();
        assert_eq!(sources, ["default", "podman"]);
        // Running: its socket exists and comes right after the current context.
        write(home.path(), ".docker/desktop/docker.sock", "");
        let c = candidates(Some("tcp://10.0.0.2:2375"), home.path(), None);
        let sources: Vec<&str> = c.iter().map(|c| c.source.as_str()).collect();
        assert_eq!(sources, ["DOCKER_HOST", "default", "context:desktop-linux"]);
        // The reference laptop: nothing answers and the user unit exists.
        assert_eq!(
            no_engine_state(&candidates(None, home.path(), None)[..1], true),
            "desktop-stopped"
        );
        assert_eq!(no_engine_state(&[], false), "not-installed");
    }

    #[test]
    fn container_values() {
        let c = ContainerSummary {
            id: Some("0123456789abcdef0123".into()),
            names: Some(vec!["/web-1".into()]),
            image: Some("nginx:1.27".into()),
            state: Some(ContainerSummaryStateEnum::RUNNING),
            status: Some("Up 3 minutes".into()),
            ports: Some(vec![bollard::models::PortSummary {
                private_port: 80,
                public_port: Some(8080),
                ..bollard::models::PortSummary::default()
            }]),
            labels: Some(
                [(COMPOSE_PROJECT.to_owned(), "shop".to_owned())]
                    .into_iter()
                    .collect(),
            ),
            ..ContainerSummary::default()
        };
        let Value::Map(m) = container_value(&c, Some(2.5), Some(50 << 20), None) else {
            panic!()
        };
        assert_eq!(m["id"], Value::from("0123456789ab"));
        assert_eq!(m["name"], Value::from("web-1"));
        assert_eq!(m["state"], Value::from("running"));
        assert_eq!(m["project"], Value::from("shop"));
        assert_eq!(m["ports"], Value::List(vec![Value::from("8080:80")]));
        assert_eq!(m["cpu"], Value::Num(2.5));
    }

    #[test]
    fn cpu_between_readings_and_memory_without_cache() {
        let stats = |total: u64, system: u64| ContainerStatsResponse {
            cpu_stats: Some(ContainerCpuStats {
                cpu_usage: Some(ContainerCpuUsage {
                    total_usage: Some(total),
                    ..ContainerCpuUsage::default()
                }),
                system_cpu_usage: Some(system),
                ..ContainerCpuStats::default()
            }),
            memory_stats: Some(ContainerMemoryStats {
                usage: Some(300),
                limit: Some(1000),
                stats: Some([("inactive_file".to_owned(), 100)].into_iter().collect()),
                ..ContainerMemoryStats::default()
            }),
            ..ContainerStatsResponse::default()
        };
        let (u, now) = usage(None, &stats(1000, 10_000));
        assert_eq!((u.cpu, u.mem, u.limit), (None, Some(200), Some(1000)));
        let (u, _) = usage(now, &stats(1500, 20_000));
        assert_eq!(u.cpu, Some(5.0));
    }
}

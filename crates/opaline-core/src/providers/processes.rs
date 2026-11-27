//! Processes: CPU and memory per process, grouped into apps by their systemd scope (with names
//! and icons from `.desktop` files), PSS for the top few, and End task / Force quit with a
//! PID-reuse check (brief §6 "Processes", ARCHITECTURE §3.7).

use std::collections::{BTreeMap, HashMap};
use std::time::{Duration, Instant};

use opaline_ipc::{TopicUpdate, Value};

use crate::engine::{Cost, Probe, Provider, ProviderError, SampleCx, TopicDesc, update};
use crate::icons::IconResolver;
use crate::sysfs::Root;

pub const APPS: &str = "processes.apps";
pub const LIST: &str = "processes.list";
const TOPICS: &[TopicDesc] = &[
    TopicDesc::every(APPS, Duration::from_secs(2)),
    TopicDesc::every(LIST, Duration::from_secs(2)),
];
const TOP_APPS: usize = 15;
const TOP_PROCESSES: usize = 30;
const PSS_TOP: usize = 10;
const PSS_EVERY: Duration = Duration::from_secs(10);
const DESKTOP_REFRESH: Duration = Duration::from_secs(600);

/// The fields of `/proc/<pid>/stat` we use.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Stat {
    pub comm: String,
    pub state: char,
    /// utime + stime in clock ticks.
    pub cpu_ticks: u64,
    /// Start time after boot in clock ticks: with the PID, a process's identity.
    pub start: u64,
    pub rss_pages: u64,
}

/// Parses `/proc/<pid>/stat`. The name is between the first `(` and the *last* `)`, because it
/// can contain spaces and parentheses.
pub fn parse_stat(text: &str) -> Option<Stat> {
    let open = text.find('(')?;
    let close = text.rfind(')')?;
    let comm = text.get(open + 1..close)?.to_owned();
    let rest: Vec<&str> = text.get(close + 2..)?.split_ascii_whitespace().collect();
    // `rest[0]` is field 3 (state); field N is rest[N - 3].
    let field = |n: usize| rest.get(n - 3).and_then(|v| v.parse::<u64>().ok());
    Some(Stat {
        comm,
        state: rest.first()?.chars().next()?,
        cpu_ticks: field(14)? + field(15)?,
        start: field(22)?,
        rss_pages: field(24)?,
    })
}

/// Undoes systemd's `\xNN` unit-name escaping.
fn unescape_unit(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\\'
            && bytes.get(i + 1) == Some(&b'x')
            && let Some(b) = s
                .get(i + 2..i + 4)
                .and_then(|h| u8::from_str_radix(h, 16).ok())
        {
            out.push(b);
            i += 4;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Removes a trailing `-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` (snap scopes end in a UUID), or
/// else the last `-` segment.
fn strip_uuid(s: &str) -> &str {
    let parts: Vec<&str> = s.rsplitn(6, '-').collect();
    let is_uuid = parts.len() == 6
        && parts[..5]
            .iter()
            .rev()
            .zip([8, 4, 4, 4, 12])
            .all(|(p, n)| p.len() == n && p.chars().all(|c| c.is_ascii_hexdigit()));
    if is_uuid {
        parts[5]
    } else {
        s.rsplit_once('-').map_or(s, |(b, _)| b)
    }
}

/// Where a process belongs.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum AppKey {
    /// A desktop app: its application ID (`org.gnome.Nautilus`, `com.anthropic.Claude`).
    App(String),
    /// A snap: `<snap>_<app>`, which is also its desktop file name.
    Snap(String),
    /// Session services, system services, kernel threads.
    System,
}

/// Reads the app from a cgroup v2 path: `…/app.slice/app-[<launcher>-]<app-id>-<random>.scope`
/// (systemd's desktop-environment naming) or `…/snap.<snap>.<app>-<uuid>.scope`.
pub fn app_from_cgroup(cgroup: &str) -> AppKey {
    let path = cgroup
        .lines()
        .find_map(|l| l.strip_prefix("0::"))
        .unwrap_or(cgroup);
    for unit in path.rsplit('/') {
        let name = unit
            .strip_suffix(".scope")
            .or_else(|| unit.strip_suffix(".service"));
        let Some(name) = name else { continue };
        if let Some(snap) = name.strip_prefix("snap.") {
            let base = strip_uuid(snap);
            if let Some((s, a)) = base.split_once('.') {
                return AppKey::Snap(format!("{s}_{a}"));
            }
        }
        if let Some(rest) = name.strip_prefix("app-") {
            let rest = match rest.split_once('-') {
                Some((launcher, tail))
                    if ["gnome", "flatpak", "kde", "dbus", "xdg"].contains(&launcher) =>
                {
                    tail
                }
                _ => rest,
            };
            // Drop the random suffix (a PID or a UUID-like token), and `@instance` for services.
            let id = rest.rsplit_once('-').map_or(rest, |(id, _)| id);
            let id = id.split('@').next().unwrap_or(id);
            if !id.is_empty() {
                return AppKey::App(unescape_unit(id));
            }
        }
    }
    AppKey::System
}

/// A desktop file's display name and icon.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DesktopEntry {
    pub name: String,
    pub icon: Option<String>,
}

/// Parses the `[Desktop Entry]` group, preferring `Name[<lang>]`.
pub fn parse_desktop(text: &str, lang: Option<&str>) -> Option<DesktopEntry> {
    let mut in_main = false;
    let (mut name, mut localized, mut icon) = (None, None, None);
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_main = line == "[Desktop Entry]";
            continue;
        }
        if !in_main {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        match key.trim() {
            "Name" => name = Some(value.trim().to_owned()),
            "Icon" => icon = Some(value.trim().to_owned()),
            k if lang.is_some_and(|l| k == format!("Name[{l}]")) => {
                localized = Some(value.trim().to_owned())
            }
            _ => {}
        }
    }
    Some(DesktopEntry {
        name: localized.or(name)?,
        icon,
    })
}

fn desktop_dirs(root: &Root) -> Vec<String> {
    let mut dirs = vec![
        "/usr/share/applications".to_owned(),
        "/usr/local/share/applications".to_owned(),
        "/var/lib/snapd/desktop/applications".to_owned(),
        "/var/lib/flatpak/exports/share/applications".to_owned(),
    ];
    if let Some(home) = std::env::var_os("HOME").filter(|_| root.is_system()) {
        let home = home.to_string_lossy();
        dirs.push(format!("{home}/.local/share/applications"));
        dirs.push(format!(
            "{home}/.local/share/flatpak/exports/share/applications"
        ));
    }
    dirs
}

/// Desktop files by basename without `.desktop` (lower-cased as a second key).
fn index_desktop_files(root: &Root) -> HashMap<String, DesktopEntry> {
    let lang = std::env::var("LANG")
        .ok()
        .and_then(|l| l.split(['_', '.']).next().map(str::to_owned));
    let mut index = HashMap::new();
    for dir in desktop_dirs(root) {
        for file in root
            .list(&dir)
            .into_iter()
            .filter(|f| f.ends_with(".desktop"))
        {
            let Ok(text) = root.read(format!("{dir}/{file}")) else {
                continue;
            };
            if let Some(entry) = parse_desktop(&text, lang.as_deref()) {
                let id = file.trim_end_matches(".desktop").to_owned();
                index
                    .entry(id.to_lowercase())
                    .or_insert_with(|| entry.clone());
                index.entry(id).or_insert(entry);
            }
        }
    }
    index
}

#[derive(Debug, Clone)]
struct Proc {
    pid: u32,
    stat: Stat,
    app: AppKey,
    own: bool,
    cpu: f64,
}

pub struct Processes {
    root: Root,
    uid: u32,
    page: u64,
    prev_total: Option<u64>,
    /// `(pid, start)` → cpu ticks at the last sample.
    prev: HashMap<(u32, u64), u64>,
    /// `(pid, start)` → app, read once per process.
    apps: HashMap<(u32, u64), (AppKey, bool)>,
    desktop: HashMap<String, DesktopEntry>,
    desktop_at: Option<Instant>,
    icons: IconResolver,
    pss: HashMap<(u32, u64), u64>,
    pss_at: Option<Instant>,
}

impl std::fmt::Debug for Processes {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Processes")
            .field("tracked", &self.prev.len())
            .finish_non_exhaustive()
    }
}

impl Processes {
    pub fn new(root: Root) -> Self {
        let icons = if root.is_system() {
            IconResolver::system()
        } else {
            IconResolver::default()
        };
        Self {
            uid: rustix::process::getuid().as_raw(),
            page: rustix::param::page_size() as u64,
            prev_total: None,
            prev: HashMap::new(),
            apps: HashMap::new(),
            desktop: HashMap::new(),
            desktop_at: None,
            icons,
            pss: HashMap::new(),
            pss_at: None,
            root,
        }
    }

    fn owner(&self, pid: u32) -> Option<u32> {
        let status = self.root.read(format!("/proc/{pid}/status")).ok()?;
        status
            .lines()
            .find_map(|l| l.strip_prefix("Uid:"))?
            .split_ascii_whitespace()
            .next()?
            .parse()
            .ok()
    }

    fn scan(&mut self, now: Instant) -> Vec<Proc> {
        let total = self
            .root
            .read("/proc/stat")
            .ok()
            .and_then(|t| super::cpu::parse_stat(&t).first().copied())
            .map(|t| t.total);
        let dt = match (self.prev_total, total) {
            (Some(p), Some(t)) if t > p => Some((t - p) as f64),
            _ => None,
        };
        let mut seen = HashMap::new();
        let mut procs = Vec::new();
        for pid in self
            .root
            .list("/proc")
            .into_iter()
            .filter_map(|p| p.parse::<u32>().ok())
        {
            let Some(stat) = self
                .root
                .read(format!("/proc/{pid}/stat"))
                .ok()
                .and_then(|t| parse_stat(&t))
            else {
                continue;
            };
            let key = (pid, stat.start);
            let (app, own) = match self.apps.get(&key) {
                Some(v) => v.clone(),
                None => {
                    let app = self
                        .root
                        .read(format!("/proc/{pid}/cgroup"))
                        .map_or(AppKey::System, |c| app_from_cgroup(&c));
                    let own = self.owner(pid) == Some(self.uid);
                    self.apps.insert(key, (app.clone(), own));
                    (app, own)
                }
            };
            let cpu = match (dt, self.prev.get(&key)) {
                (Some(dt), Some(prev)) => stat.cpu_ticks.saturating_sub(*prev) as f64 / dt * 100.0,
                _ => 0.0,
            };
            seen.insert(key, stat.cpu_ticks);
            procs.push(Proc {
                pid,
                stat,
                app,
                own,
                cpu,
            });
        }
        self.apps.retain(|k, _| seen.contains_key(k));
        self.pss.retain(|k, _| seen.contains_key(k));
        self.prev = seen;
        self.prev_total = total;

        if self
            .pss_at
            .is_none_or(|at| now.duration_since(at) >= PSS_EVERY)
        {
            let mut by_rss: Vec<&Proc> = procs.iter().filter(|p| p.own).collect();
            by_rss.sort_by_key(|p| std::cmp::Reverse(p.stat.rss_pages));
            for p in by_rss.into_iter().take(PSS_TOP) {
                let pss = self
                    .root
                    .read(format!("/proc/{}/smaps_rollup", p.pid))
                    .ok()
                    .and_then(|t| {
                        t.lines()
                            .find_map(|l| l.strip_prefix("Pss:"))
                            .and_then(|v| v.split_ascii_whitespace().next()?.parse::<u64>().ok())
                    });
                if let Some(kib) = pss {
                    self.pss.insert((p.pid, p.stat.start), kib * 1024);
                }
            }
            self.pss_at = Some(now);
        }
        procs
    }

    fn entry(&self, key: &AppKey) -> Option<&DesktopEntry> {
        let id = match key {
            AppKey::App(id) | AppKey::Snap(id) => id,
            AppKey::System => return None,
        };
        self.desktop
            .get(id)
            .or_else(|| self.desktop.get(&id.to_lowercase()))
    }

    fn app_label(&self, key: &AppKey, fallback: &str) -> (String, String, Option<String>) {
        let id = match key {
            AppKey::App(id) | AppKey::Snap(id) => id.clone(),
            AppKey::System => "system".to_owned(),
        };
        let entry = self.entry(key);
        let name = match (key, entry) {
            (_, Some(e)) => e.name.clone(),
            // The UI translates this from `system: true`.
            (AppKey::System, None) => "System".to_owned(),
            (_, None) => fallback.to_owned(),
        };
        (id, name, entry.and_then(|e| e.icon.clone()))
    }
}

impl Provider for Processes {
    fn id(&self) -> &'static str {
        "processes"
    }

    fn topics(&self) -> &[TopicDesc] {
        TOPICS
    }

    fn cost_hint(&self) -> Cost {
        Cost::Expensive
    }

    fn probe(&mut self) -> Probe {
        Probe::default().available(APPS).available(LIST)
    }

    fn sample(&mut self, cx: &SampleCx<'_>) -> Result<Vec<TopicUpdate>, ProviderError> {
        if self
            .desktop_at
            .is_none_or(|at| cx.now.duration_since(at) >= DESKTOP_REFRESH)
        {
            self.desktop = index_desktop_files(&self.root);
            self.desktop_at = Some(cx.now);
        }
        let procs = self.scan(cx.now);
        let page = self.page;
        let mem = |pss: &HashMap<(u32, u64), u64>, p: &Proc| {
            pss.get(&(p.pid, p.stat.start))
                .copied()
                .unwrap_or(p.stat.rss_pages * page)
        };
        let mut out = Vec::new();
        if cx.is_due(APPS) {
            let mut groups: BTreeMap<AppKey, (f64, u64, Vec<&Proc>)> = BTreeMap::new();
            for p in &procs {
                let g = groups.entry(p.app.clone()).or_insert((0.0, 0, Vec::new()));
                g.0 += p.cpu;
                g.1 += mem(&self.pss, p);
                g.2.push(p);
            }
            let mut list: Vec<_> = groups.into_iter().collect();
            list.sort_by(|a, b| b.1.0.total_cmp(&a.1.0).then(b.1.1.cmp(&a.1.1)));
            let apps = list
                .into_iter()
                .take(TOP_APPS)
                .map(|(key, (cpu, mem_b, members))| {
                    let leader = members
                        .iter()
                        .max_by_key(|p| p.stat.rss_pages)
                        .map_or("", |p| p.stat.comm.as_str());
                    let (id, name, icon) = self.app_label(&key, leader);
                    let icon_url = icon.as_deref().and_then(|name| self.icons.resolve(name));
                    Value::map([
                        ("id", Value::from(id)),
                        ("name", Value::from(name)),
                        ("icon", Value::from(icon)),
                        ("iconUrl", Value::from(icon_url)),
                        ("system", Value::Bool(key == AppKey::System)),
                        ("cpu", Value::Num(cpu)),
                        ("memB", Value::Num(mem_b as f64)),
                        ("processes", Value::Num(members.len() as f64)),
                    ])
                })
                .collect();
            out.push(update(APPS, Value::List(apps)));
        }
        if cx.is_due(LIST) {
            let mut sorted: Vec<&Proc> = procs.iter().collect();
            sorted.sort_by(|a, b| {
                b.cpu
                    .total_cmp(&a.cpu)
                    .then(b.stat.rss_pages.cmp(&a.stat.rss_pages))
            });
            let list = sorted
                .into_iter()
                .take(TOP_PROCESSES)
                .map(|p| {
                    let (app, _, _) = self.app_label(&p.app, &p.stat.comm);
                    Value::map([
                        ("pid", Value::Num(f64::from(p.pid))),
                        ("start", Value::Num(p.stat.start as f64)),
                        ("name", Value::from(p.stat.comm.as_str())),
                        ("app", Value::from(app)),
                        ("own", Value::Bool(p.own)),
                        ("cpu", Value::Num(p.cpu)),
                        ("memB", Value::Num(mem(&self.pss, p) as f64)),
                    ])
                })
                .collect();
            out.push(update(LIST, Value::List(list)));
        }
        Ok(out)
    }
}

/// Sends SIGTERM (End task) or SIGKILL (Force quit) to one of the user's own processes, only if
/// it is still the same process (PID and start time match).
pub fn signal(pid: u32, start: u64, force: bool) -> Result<(), String> {
    let root = Root::system();
    let stat = root
        .read(format!("/proc/{pid}/stat"))
        .ok()
        .and_then(|t| parse_stat(&t))
        .ok_or("no-such-process")?;
    if stat.start != start {
        return Err("process-changed".into());
    }
    let p = Processes::new(root);
    if p.owner(pid) != Some(p.uid) {
        return Err("not-your-process".into());
    }
    let pid = i32::try_from(pid)
        .ok()
        .and_then(rustix::process::Pid::from_raw)
        .ok_or("no-such-process")?;
    let sig = if force {
        rustix::process::Signal::KILL
    } else {
        rustix::process::Signal::TERM
    };
    rustix::process::kill_process(pid, sig).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::panic)]

    use super::*;

    #[test]
    fn stat_with_awkward_names() {
        let s = parse_stat("1234 (Web Content (1)) S 1 1234 1234 0 -1 4194560 100 0 0 0 250 50 0 0 20 0 30 0 987654 1000000 2500 18446744073709551615").unwrap();
        assert_eq!(s.comm, "Web Content (1)");
        assert_eq!(s.state, 'S');
        assert_eq!(s.cpu_ticks, 300);
        assert_eq!(s.start, 987_654);
        assert_eq!(s.rss_pages, 2500);
    }

    #[test]
    fn apps_from_cgroups() {
        let base = "0::/user.slice/user-1000.slice/user@1000.service/app.slice/";
        assert_eq!(
            app_from_cgroup(&format!("{base}app-com.anthropic.Claude-877724.scope")),
            AppKey::App("com.anthropic.Claude".into())
        );
        assert_eq!(
            app_from_cgroup(&format!(
                "{base}app-gnome-org.gnome.Evolution\\x2dalarm\\x2dnotify-687715.scope"
            )),
            AppKey::App("org.gnome.Evolution-alarm-notify".into())
        );
        assert_eq!(
            app_from_cgroup(&format!("{base}app-gnome-update\\x2dnotifier-687776.scope")),
            AppKey::App("update-notifier".into())
        );
        assert_eq!(
            app_from_cgroup(&format!(
                "{base}snap.firefox.firefox-3f2a1b9c-8d7e-4f60-9a1b-2c3d4e5f6a7b.scope"
            )),
            AppKey::Snap("firefox_firefox".into())
        );
        assert_eq!(
            app_from_cgroup(
                "0::/user.slice/user-1000.slice/user@1000.service/session.slice/org.gnome.Shell@ubuntu.service"
            ),
            AppKey::System
        );
        assert_eq!(
            app_from_cgroup("0::/system.slice/NetworkManager.service"),
            AppKey::System
        );
    }

    #[test]
    fn desktop_entries() {
        let text = "[Desktop Entry]\nName=Files\nName[de]=Dateien\nIcon=org.gnome.Nautilus\n[Desktop Action new-window]\nName=New Window\n";
        assert_eq!(
            parse_desktop(text, Some("de")),
            Some(DesktopEntry {
                name: "Dateien".into(),
                icon: Some("org.gnome.Nautilus".into()),
            })
        );
        assert_eq!(parse_desktop(text, None).unwrap().name, "Files");
    }

    #[test]
    fn signals_refuse_changed_or_foreign_processes() {
        let me = std::process::id();
        assert_eq!(signal(me, 1, false), Err("process-changed".into()));
        assert!(signal(1, 0, false).is_err(), "pid 1 is not ours");
        assert_eq!(
            signal(u32::MAX - 7, 0, false),
            Err("no-such-process".into())
        );
    }

    #[test]
    fn scans_real_proc() {
        let mut p = Processes::new(Root::system());
        let cx = SampleCx {
            now: Instant::now(),
            due: &[APPS, LIST],
        };
        let v = p.sample(&cx).unwrap();
        let Value::List(list) = &v.iter().find(|u| u.topic.as_str() == LIST).unwrap().value else {
            panic!()
        };
        assert!(!list.is_empty());
    }
}

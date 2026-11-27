//! Live configuration file watching with content-hash self-write suppression (brief §5.4,
//! PLAN-2 task 3.5, Spike S9).
//!
//! Uses Linux `inotify` directly through `rustix::fs::inotify` (zero unsafe code, zero extra
//! dependencies) to watch `~/.config/opaline/` (`settings.json`, `layouts.json`, `user.css`),
//! theme directories, and future `widgets/`, `sources/`, and `profiles/` directories.
//!
//! Every write Opaline performs records its SHA-256 hash in [`WriteLedger`]. When an inotify event
//! fires, if the file's current hash matches a recorded self-write, the event is suppressed so
//! Opaline never enters a reload loop.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, PoisonError};
use std::time::{Duration, Instant};

use rustix::fs::inotify::{self, CreateFlags, ReadFlags, Reader, WatchFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::hub::Hub;

pub const PROBLEMS_TOPIC: &str = "config.problems";
const LEDGER_TTL: Duration = Duration::from_secs(10);
const DEBOUNCE: Duration = Duration::from_millis(120);

/// A non-blocking configuration problem surfaced as a toast/status without blanking the desktop.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigProblem {
    pub file: String,
    pub at: String,
    pub message: String,
}

/// Content-hash ledger preventing Opaline's own atomic writes from triggering live reloads (S9).
#[derive(Debug, Default)]
pub struct WriteLedger {
    entries: Mutex<HashMap<PathBuf, ([u8; 32], Instant)>>,
}

impl WriteLedger {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn hash(bytes: &[u8]) -> [u8; 32] {
        let mut h = Sha256::new();
        h.update(bytes);
        h.finalize().into()
    }

    /// Records the exact bytes Opaline just wrote to `path`.
    pub fn record(&self, path: &Path, bytes: &[u8]) {
        let now = Instant::now();
        let digest = Self::hash(bytes);
        let mut map = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
        map.retain(|_, (_, ts)| now.duration_since(*ts) < LEDGER_TTL);
        map.insert(canonical_or_raw(path), (digest, now));
    }

    /// Returns `true` (and consumes the entry) if `bytes` matches our own recent write to `path`.
    pub fn is_self_write(&self, path: &Path, bytes: &[u8]) -> bool {
        let key = canonical_or_raw(path);
        let digest = Self::hash(bytes);
        let now = Instant::now();
        let mut map = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
        map.retain(|_, (_, ts)| now.duration_since(*ts) < LEDGER_TTL);
        if map.get(&key).is_some_and(|(d, _)| *d == digest) {
            map.remove(&key);
            true
        } else {
            false
        }
    }
}

fn canonical_or_raw(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

static GLOBAL_LEDGER: OnceLock<WriteLedger> = OnceLock::new();

/// Process-wide write ledger shared by `store`, `layouts`, and the file watcher.
pub fn ledger() -> &'static WriteLedger {
    GLOBAL_LEDGER.get_or_init(WriteLedger::new)
}

/// Records an atomic write in the global ledger before/after writing to disk.
pub fn write_atomic_tracked(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    ledger().record(path, bytes);
    crate::paths::write_atomic(path, bytes)
}

/// What changed on disk after a debounced batch of inotify events.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct ReloadMask {
    pub settings: bool,
    pub layouts: bool,
    pub themes: bool,
    pub user_css: bool,
    pub sources: bool,
}

impl ReloadMask {
    pub fn any(self) -> bool {
        self.settings || self.layouts || self.themes || self.user_css || self.sources
    }
}

/// Applies an outside edit to `settings.json`, keeping the last good state on any error.
pub fn reload_settings_file(
    hub: &Hub,
    path: &Path,
    ledger: &WriteLedger,
) -> Result<bool, ConfigProblem> {
    let bytes = std::fs::read(path).map_err(|e| ConfigProblem {
        file: path.display().to_string(),
        at: "/".into(),
        message: format!("could not read settings.json: {e}"),
    })?;
    if ledger.is_self_write(path, &bytes) {
        return Ok(false);
    }
    let val: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| ConfigProblem {
        file: path.display().to_string(),
        at: "/".into(),
        message: format!("invalid JSON: {e}"),
    })?;
    let next: crate::store::Settings = serde_json::from_value(val).map_err(|e| ConfigProblem {
        file: path.display().to_string(),
        at: "/".into(),
        message: format!("invalid settings: {e}"),
    })?;
    next.validate().map_err(|reason| ConfigProblem {
        file: path.display().to_string(),
        at: "/".into(),
        message: reason,
    })?;
    hub.set_settings(next);
    Ok(true)
}

/// Applies an outside edit to `layouts.json`, keeping the last good state on any error.
pub fn reload_layouts_file(
    hub: &Hub,
    path: &Path,
    ledger: &WriteLedger,
) -> Result<bool, ConfigProblem> {
    let bytes = std::fs::read(path).map_err(|e| ConfigProblem {
        file: path.display().to_string(),
        at: "/".into(),
        message: format!("could not read layouts.json: {e}"),
    })?;
    if ledger.is_self_write(path, &bytes) {
        return Ok(false);
    }
    let val: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| ConfigProblem {
        file: path.display().to_string(),
        at: "/".into(),
        message: format!("invalid JSON: {e}"),
    })?;
    let next: crate::layouts::Layouts = serde_json::from_value(val).map_err(|e| ConfigProblem {
        file: path.display().to_string(),
        at: "/".into(),
        message: format!("invalid layouts: {e}"),
    })?;
    next.validate().map_err(|reason| ConfigProblem {
        file: path.display().to_string(),
        at: "/".into(),
        message: reason,
    })?;
    hub.set_layouts(next);
    Ok(true)
}

/// Recomputes and publishes the active theme catalog, user/theme CSS bundle, and any problems.
pub fn refresh_themes_and_css(hub: &Hub, extra_problems: Vec<ConfigProblem>) {
    let safe_mode = hub.safe_mode();
    let active_id = hub.settings().theme.clone();
    let catalog =
        crate::themes::load_catalog(&crate::themes::search_roots(), &active_id, safe_mode);
    let theme_css = catalog
        .active
        .as_ref()
        .map(|t| t.css.clone())
        .unwrap_or_default();

    let (user_css, css_probs) = crate::paths::config_dir()
        .map(|dir| crate::css::load_user_css(&dir, safe_mode))
        .unwrap_or_default();

    let mut all_problems = extra_problems;
    for p in &catalog.problems {
        all_problems.push(ConfigProblem {
            file: p.file.clone(),
            at: p.at.clone(),
            message: p.message.clone(),
        });
    }
    for p in &css_probs {
        all_problems.push(ConfigProblem {
            file: p.file.clone(),
            at: format!("line {}", p.line),
            message: p.message.clone(),
        });
    }

    let css_bundle = crate::css::CssBundle {
        theme_css,
        user_css,
        safe_mode,
        problems: css_probs,
    };

    let mut updates = Vec::with_capacity(3);
    if let Ok(v) = serde_json::to_value(&catalog) {
        updates.push(opaline_ipc::TopicUpdate {
            topic: opaline_ipc::Topic::new(crate::themes::TOPIC),
            value: crate::json::from_json(&v),
        });
    }
    if let Ok(v) = serde_json::to_value(&css_bundle) {
        updates.push(opaline_ipc::TopicUpdate {
            topic: opaline_ipc::Topic::new(crate::css::TOPIC),
            value: crate::json::from_json(&v),
        });
    }
    if let Ok(v) = serde_json::to_value(&all_problems) {
        updates.push(opaline_ipc::TopicUpdate {
            topic: opaline_ipc::Topic::new(PROBLEMS_TOPIC),
            value: crate::json::from_json(&v),
        });
    }
    hub.publish(updates);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WatchKind {
    ConfigRoot,
    ThemesDir,
    SourcesOrWidgetsDir,
}

/// Runs the Linux `inotify` watcher loop on a dedicated blocking task, reloading `settings.json`,
/// `layouts.json`, themes, `sources/`, `widgets/`, and `user.css` live when edited outside Opaline.
pub async fn run(hub: Arc<Hub>) {
    // Initial publish of themes + user.css right at startup.
    refresh_themes_and_css(&hub, Vec::new());

    let Ok(config_dir) = crate::paths::config_dir() else {
        tracing::warn!("config watcher disabled: no config directory");
        return;
    };
    let _ = std::fs::create_dir_all(&config_dir);
    let _ = std::fs::create_dir_all(config_dir.join("themes"));
    let _ = std::fs::create_dir_all(config_dir.join("sources"));
    let _ = std::fs::create_dir_all(config_dir.join("widgets"));

    let mut watch_dirs: Vec<(PathBuf, WatchKind)> = vec![
        (config_dir.clone(), WatchKind::ConfigRoot),
        (config_dir.join("sources"), WatchKind::SourcesOrWidgetsDir),
        (config_dir.join("widgets"), WatchKind::SourcesOrWidgetsDir),
    ];
    for (root, _) in crate::themes::search_roots() {
        if root.is_dir() {
            watch_dirs.push((root.clone(), WatchKind::ThemesDir));
            if let Ok(entries) = std::fs::read_dir(&root) {
                for entry in entries.flatten() {
                    if entry.path().is_dir() {
                        watch_dirs.push((entry.path(), WatchKind::ThemesDir));
                    }
                }
            }
        }
    }

    let hub_clone = hub.clone();
    let _ =
        tokio::task::spawn_blocking(move || watch_loop(hub_clone, config_dir, watch_dirs)).await;
}

fn watch_loop(hub: Arc<Hub>, config_dir: PathBuf, dirs: Vec<(PathBuf, WatchKind)>) {
    let fd = match inotify::init(CreateFlags::CLOEXEC | CreateFlags::NONBLOCK) {
        Ok(fd) => fd,
        Err(error) => {
            tracing::warn!(%error, "could not initialize inotify watcher");
            return;
        }
    };

    let flags = WatchFlags::CLOSE_WRITE
        | WatchFlags::MOVED_TO
        | WatchFlags::CREATE
        | WatchFlags::DELETE
        | WatchFlags::MODIFY;
    let mut wds: HashMap<i32, WatchKind> = HashMap::new();
    for (dir, kind) in &dirs {
        match inotify::add_watch(&fd, dir, flags) {
            Ok(wd) => {
                wds.insert(wd, *kind);
            }
            Err(error) => {
                tracing::debug!(dir = %dir.display(), %error, "skipped watching directory");
            }
        }
    }

    let mut buf = [std::mem::MaybeUninit::uninit(); 4096];
    let mut pending = ReloadMask::default();
    let mut last_event: Option<Instant> = None;

    loop {
        let mut reader = Reader::new(&fd, &mut buf);
        let mut got_any = false;
        while let Ok(ev) = reader.next() {
            if ev.events().contains(ReadFlags::QUEUE_OVERFLOW) {
                pending = ReloadMask {
                    settings: true,
                    layouts: true,
                    themes: true,
                    user_css: true,
                    sources: true,
                };
                got_any = true;
                continue;
            }
            let Some(&kind) = wds.get(&ev.wd()) else {
                continue;
            };
            let name = ev.file_name().and_then(|n| n.to_str().ok()).unwrap_or("");
            if name.ends_with(".tmp") {
                continue;
            }
            got_any = true;
            match kind {
                WatchKind::ConfigRoot => match name {
                    "settings.json" => pending.settings = true,
                    "layouts.json" => pending.layouts = true,
                    "user.css" => pending.user_css = true,
                    "themes" => pending.themes = true,
                    "sources" | "widgets" | "source-trust.json" | "variables.json" => {
                        pending.sources = true;
                    }
                    _ => {}
                },
                WatchKind::ThemesDir => {
                    pending.themes = true;
                }
                WatchKind::SourcesOrWidgetsDir => {
                    pending.sources = true;
                }
            }
        }

        if got_any {
            last_event = Some(Instant::now());
        }

        if pending.any() && last_event.is_some_and(|t| t.elapsed() >= DEBOUNCE) {
            let mask = std::mem::take(&mut pending);
            last_event = None;
            apply_reload(&hub, &config_dir, mask);
        }

        std::thread::sleep(Duration::from_millis(80));
    }
}

fn apply_reload(hub: &Hub, config_dir: &Path, mask: ReloadMask) {
    let mut problems = Vec::new();
    let mut need_theme_refresh = mask.themes || mask.user_css;

    if mask.settings {
        let p = config_dir.join("settings.json");
        match reload_settings_file(hub, &p, ledger()) {
            Ok(true) => {
                tracing::info!("reloaded settings.json after external edit");
                need_theme_refresh = true;
            }
            Ok(false) => {}
            Err(prob) => {
                tracing::warn!(file = %prob.file, msg = %prob.message, "kept last good settings");
                problems.push(prob);
            }
        }
    }

    if mask.layouts {
        let p = config_dir.join("layouts.json");
        match reload_layouts_file(hub, &p, ledger()) {
            Ok(true) => tracing::info!("reloaded layouts.json after external edit"),
            Ok(false) => {}
            Err(prob) => {
                tracing::warn!(file = %prob.file, msg = %prob.message, "kept last good layouts");
                problems.push(prob);
            }
        }
    }

    if mask.sources
        && let Some(mgr) = hub.sources()
    {
        let src_probs = mgr.reload_from_disk(hub.safe_mode());
        problems.extend(src_probs);
        mgr.publish_catalog(hub);
    }

    if need_theme_refresh || !problems.is_empty() {
        refresh_themes_and_css(hub, problems);
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use opaline_ipc::BackendKind;

    use super::*;

    #[test]
    fn self_write_does_not_trigger_reload_s9() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let ledger = WriteLedger::new();
        let hub = Hub::new(BackendKind::Instant, Vec::new());

        let mut s = crate::store::Settings::default();
        s.network.billing_day = 12;
        let bytes = serde_json::to_vec_pretty(&s).unwrap();
        ledger.record(&path, &bytes);
        std::fs::write(&path, &bytes).unwrap();

        // First reload sees our recorded hash and suppresses the reload.
        assert_eq!(reload_settings_file(&hub, &path, &ledger), Ok(false));

        // An external edit with different bytes DOES reload into the hub.
        s.network.billing_day = 19;
        let external = serde_json::to_vec_pretty(&s).unwrap();
        std::fs::write(&path, &external).unwrap();
        assert_eq!(reload_settings_file(&hub, &path, &ledger), Ok(true));
        assert_eq!(hub.settings().network.billing_day, 19);
    }

    #[test]
    fn broken_external_edit_keeps_last_good_state() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let ledger = WriteLedger::new();
        let hub = Hub::new(BackendKind::Instant, Vec::new());

        let mut good = crate::store::Settings::default();
        good.network.billing_day = 7;
        hub.set_settings(good);

        std::fs::write(&path, b"{ not valid json").unwrap();
        let err = reload_settings_file(&hub, &path, &ledger).unwrap_err();
        assert!(err.message.contains("invalid JSON"));
        assert_eq!(
            hub.settings().network.billing_day,
            7,
            "last good settings must be preserved"
        );

        // Semantically invalid edit is also rejected while keeping last good state.
        let mut bad = crate::store::Settings::default();
        bad.network.billing_day = 99;
        std::fs::write(&path, serde_json::to_vec(&bad).unwrap()).unwrap();
        let err = reload_settings_file(&hub, &path, &ledger).unwrap_err();
        assert_eq!(err.message, "billing-day-out-of-range");
        assert_eq!(hub.settings().network.billing_day, 7);
    }
}

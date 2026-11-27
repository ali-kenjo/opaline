//! Runtime manager for custom data sources, trust approvals, persisted variables, and custom
//! widget packages (brief §4.4–4.5, PLAN-2 tasks 6.1–6.7).

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use opaline_ipc::{Topic, TopicUpdate, Value};
use rustix::fs::inotify::{self, CreateFlags, Reader, WatchFlags};
use serde::{Deserialize, Serialize};
use tokio::sync::watch;

use crate::hub::Hub;

use super::model::{
    CustomWidgetPackage, DbusMode, SourceDiagnoseEntry, SourceKind, SourceLogEntry,
    SourceRuntimeStatus, SourceSpec, SourceState, TrustStore, validate_id,
};
use super::mqtt::{MqttConnectConfig, connect_and_subscribe};
use super::runners::{
    HttpCacheEntry, expand_user_path, run_command, run_dbus_property, run_file, run_http,
};

pub const SOURCES_CATALOG_TOPIC: &str = "sources.catalog";
pub const CUSTOM_WIDGETS_TOPIC: &str = "widgets.custom";

const MAX_LOG_ENTRIES: usize = 20;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

#[derive(Debug, Default)]
struct SourceStateInner {
    specs: BTreeMap<String, SourceSpec>,
    trust: TrustStore,
    statuses: BTreeMap<String, SourceRuntimeStatus>,
    http_cache: HashMap<String, HttpCacheEntry>,
    variables: BTreeMap<String, serde_json::Value>,
    custom_widgets: BTreeMap<String, CustomWidgetPackage>,
    last_polled: HashMap<String, Instant>,
    /// Incremented whenever sources reload so long-lived MQTT/File tasks restart cleanly.
    generation: u64,
}

/// Snapshot returned to Settings → Data sources and published on `sources.catalog`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourcesCatalog {
    pub safe_mode: bool,
    pub specs: Vec<SourceSpec>,
    pub statuses: Vec<SourceRuntimeStatus>,
}

/// Process-wide manager for custom sources, variables, and custom widgets.
#[derive(Debug)]
pub struct SourceManager {
    config_dir: PathBuf,
    inner: Mutex<SourceStateInner>,
    reload_tx: watch::Sender<u64>,
}

impl SourceManager {
    pub fn new(config_dir: PathBuf) -> Arc<Self> {
        let (reload_tx, _) = watch::channel(0);
        let mgr = Arc::new(Self {
            config_dir,
            inner: Mutex::new(SourceStateInner::default()),
            reload_tx,
        });
        mgr.reload_from_disk(false);
        mgr
    }

    pub fn sources_dir(&self) -> PathBuf {
        self.config_dir.join("sources")
    }

    pub fn widgets_dir(&self) -> PathBuf {
        self.config_dir.join("widgets")
    }

    fn trust_path(&self) -> PathBuf {
        self.config_dir.join("source-trust.json")
    }

    fn variables_path(&self) -> PathBuf {
        self.config_dir.join("variables.json")
    }

    /// Loads all `sources/*.json`, `source-trust.json`, `variables.json`, and `widgets/*.json`.
    pub fn reload_from_disk(&self, safe_mode: bool) -> Vec<crate::watcher::ConfigProblem> {
        let mut problems = Vec::new();
        let trust = TrustStore::load(&self.trust_path());

        let mut specs = BTreeMap::new();
        if let Ok(entries) = std::fs::read_dir(self.sources_dir()) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) != Some("json") {
                    continue;
                }
                match read_json_file::<SourceSpec>(&path) {
                    Ok(spec) => match spec.validate() {
                        Ok(()) => {
                            specs.insert(spec.id.clone(), spec);
                        }
                        Err(msg) => problems.push(crate::watcher::ConfigProblem {
                            file: path.display().to_string(),
                            at: "/".into(),
                            message: msg,
                        }),
                    },
                    Err(msg) => problems.push(crate::watcher::ConfigProblem {
                        file: path.display().to_string(),
                        at: "/".into(),
                        message: msg,
                    }),
                }
            }
        }

        let mut custom_widgets = BTreeMap::new();
        if let Ok(entries) = std::fs::read_dir(self.widgets_dir()) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) != Some("json") {
                    continue;
                }
                match read_json_file::<CustomWidgetPackage>(&path) {
                    Ok(pkg) => match pkg.validate() {
                        Ok(()) => {
                            custom_widgets.insert(pkg.id.clone(), pkg);
                        }
                        Err(msg) => problems.push(crate::watcher::ConfigProblem {
                            file: path.display().to_string(),
                            at: "/".into(),
                            message: msg,
                        }),
                    },
                    Err(msg) => problems.push(crate::watcher::ConfigProblem {
                        file: path.display().to_string(),
                        at: "/".into(),
                        message: msg,
                    }),
                }
            }
        }

        let persisted_vars: BTreeMap<String, serde_json::Value> =
            std::fs::read(self.variables_path())
                .ok()
                .and_then(|b| serde_json::from_slice(&b).ok())
                .unwrap_or_default();

        let next_gen = {
            let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
            inner.trust = trust;
            inner.specs = specs;
            inner.custom_widgets = custom_widgets;
            for (k, v) in persisted_vars {
                inner.variables.entry(k).or_insert(v);
            }
            // Refresh status records while preserving run history for unchanged IDs.
            let old_statuses = std::mem::take(&mut inner.statuses);
            let mut next_statuses = BTreeMap::new();
            for (id, spec) in &inner.specs {
                let prev = old_statuses.get(id);
                let state = initial_state(spec, &inner.trust, safe_mode, prev);
                next_statuses.insert(
                    id.clone(),
                    SourceRuntimeStatus {
                        id: spec.id.clone(),
                        name: spec.name.clone(),
                        kind: spec.kind_label().into(),
                        topic: spec.topic_name(),
                        state,
                        enabled: spec.enabled,
                        origin: spec.origin.clone(),
                        trust_summary: spec.trust_summary(),
                        trust_fingerprint: spec.trust_fingerprint(),
                        last_run_ms: prev.and_then(|p| p.last_run_ms),
                        last_duration_us: prev.and_then(|p| p.last_duration_us),
                        run_count: prev.map_or(0, |p| p.run_count),
                        error: prev.and_then(|p| p.error.clone()),
                        logs: prev.map_or_else(Vec::new, |p| p.logs.clone()),
                    },
                );
            }
            inner.statuses = next_statuses;
            inner.generation += 1;
            inner.generation
        };
        let _ = self.reload_tx.send(next_gen);
        problems
    }

    pub fn catalog(&self, safe_mode: bool) -> SourcesCatalog {
        let inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        SourcesCatalog {
            safe_mode,
            specs: inner.specs.values().cloned().collect(),
            statuses: inner.statuses.values().cloned().collect(),
        }
    }

    pub fn custom_widgets(&self) -> Vec<CustomWidgetPackage> {
        let inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        inner.custom_widgets.values().cloned().collect()
    }

    /// Redacted per-source inventory for `--diagnose` and `Settings → Diagnostics`.
    pub fn diagnose_entries(&self) -> BTreeMap<String, SourceDiagnoseEntry> {
        let inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        inner
            .statuses
            .iter()
            .map(|(id, st)| {
                (
                    id.clone(),
                    SourceDiagnoseEntry {
                        kind: st.kind.clone(),
                        state: st.state,
                        imported: !matches!(st.origin, super::model::SourceOrigin::User),
                        last_duration_us: st.last_duration_us,
                        run_count: st.run_count,
                    },
                )
            })
            .collect()
    }

    /// Publishes `sources.catalog`, `widgets.custom`, and any current Variable values to `hub`.
    pub fn publish_catalog(&self, hub: &Hub) {
        let safe_mode = hub.safe_mode();
        let cat = self.catalog(safe_mode);
        let widgets = self.custom_widgets();
        let mut updates = Vec::new();
        if let Ok(v) = serde_json::to_value(&cat) {
            updates.push(TopicUpdate {
                topic: Topic::new(SOURCES_CATALOG_TOPIC),
                value: crate::json::from_json(&v),
            });
        }
        if let Ok(v) = serde_json::to_value(&widgets) {
            updates.push(TopicUpdate {
                topic: Topic::new(CUSTOM_WIDGETS_TOPIC),
                value: crate::json::from_json(&v),
            });
        }
        // Publish variable defaults / current values immediately.
        {
            let inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
            for (id, spec) in &inner.specs {
                if let SourceKind::Variable { default_value, .. } = &spec.kind
                    && let Some(val) = inner.variables.get(id).or(default_value.as_ref())
                {
                    updates.push(TopicUpdate {
                        topic: Topic::new(spec.topic_name()),
                        value: crate::json::from_json(val),
                    });
                }
            }
            for (name, val) in &inner.variables {
                updates.push(TopicUpdate {
                    topic: Topic::new(format!("var.{name}")),
                    value: crate::json::from_json(val),
                });
            }
        }
        hub.publish(updates);
    }

    /// Validates and saves a custom source to `~/.config/opaline/sources/<id>.json`.
    pub fn save_source(&self, mut spec: SourceSpec, hub: &Hub) -> Result<(), String> {
        spec.validate()?;
        if spec.schema.is_none() {
            spec.schema = Some("/usr/share/opaline/schemas/source.schema.json".into());
        }
        let path = self.sources_dir().join(format!("{}.json", spec.id));
        let bytes = serde_json::to_vec_pretty(&spec).map_err(|e| e.to_string())?;
        crate::watcher::write_atomic_tracked(&path, &bytes).map_err(|e| e.to_string())?;
        self.reload_from_disk(hub.safe_mode());
        self.publish_catalog(hub);
        Ok(())
    }

    /// Deletes a custom source file and revokes any trust record for it.
    pub fn delete_source(&self, id: &str, hub: &Hub) -> Result<(), String> {
        validate_id(id)?;
        let path = self.sources_dir().join(format!("{id}.json"));
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        {
            let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
            inner.trust.revoke(id);
            let _ = inner.trust.save(&self.trust_path());
        }
        self.reload_from_disk(hub.safe_mode());
        self.publish_catalog(hub);
        Ok(())
    }

    /// Approves an imported source for its current package version + trust fingerprint.
    pub fn approve_source(&self, id: &str, hub: &Hub) -> Result<(), String> {
        validate_id(id)?;
        {
            let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
            let spec = inner
                .specs
                .get(id)
                .cloned()
                .ok_or_else(|| format!("unknown source '{id}'"))?;
            inner.trust.approve(&spec, now_ms());
            inner.trust.save(&self.trust_path())?;
        }
        self.reload_from_disk(hub.safe_mode());
        self.publish_catalog(hub);
        Ok(())
    }

    /// Revokes approval for an imported source so it stops executing immediately.
    pub fn revoke_source(&self, id: &str, hub: &Hub) -> Result<(), String> {
        validate_id(id)?;
        {
            let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
            inner.trust.revoke(id);
            inner.trust.save(&self.trust_path())?;
        }
        self.reload_from_disk(hub.safe_mode());
        self.publish_catalog(hub);
        Ok(())
    }

    /// Updates a named variable (`var.<name>`) and persists it if configured.
    pub fn set_variable(
        &self,
        name: &str,
        value: serde_json::Value,
        hub: &Hub,
    ) -> Result<(), String> {
        validate_id(name)?;
        let persist = {
            let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
            inner.variables.insert(name.to_owned(), value.clone());
            let should_persist = inner.specs.get(name).is_none_or(|s| match s.kind {
                SourceKind::Variable { persist, .. } => persist,
                _ => true,
            });
            if let Some(st) = inner.statuses.get_mut(name) {
                st.state = SourceState::Ok;
                st.last_run_ms = Some(now_ms());
                st.run_count += 1;
                st.error = None;
                push_log(&mut st.logs, "info", "Variable updated");
            }
            if should_persist {
                serde_json::to_vec_pretty(&inner.variables).ok()
            } else {
                None
            }
        };
        if let Some(bytes) = persist {
            let _ = crate::watcher::write_atomic_tracked(&self.variables_path(), &bytes);
        }
        hub.publish(vec![TopicUpdate {
            topic: Topic::new(format!("var.{name}")),
            value: crate::json::from_json(&value),
        }]);
        self.publish_catalog(hub);
        Ok(())
    }

    /// Validates and saves a custom widget definition (`~/.config/opaline/widgets/<id>.json`).
    pub fn save_custom_widget(
        &self,
        mut pkg: CustomWidgetPackage,
        hub: &Hub,
    ) -> Result<(), String> {
        pkg.validate()?;
        if pkg.schema.is_none() {
            pkg.schema = Some("/usr/share/opaline/schemas/custom-widget.schema.json".into());
        }
        let path = self.widgets_dir().join(format!("{}.json", pkg.id));
        let bytes = serde_json::to_vec_pretty(&pkg).map_err(|e| e.to_string())?;
        crate::watcher::write_atomic_tracked(&path, &bytes).map_err(|e| e.to_string())?;
        self.reload_from_disk(hub.safe_mode());
        self.publish_catalog(hub);
        Ok(())
    }

    /// Deletes a custom widget file (`~/.config/opaline/widgets/<id>.json`).
    pub fn delete_custom_widget(&self, id: &str, hub: &Hub) -> Result<(), String> {
        validate_id(id)?;
        let path = self.widgets_dir().join(format!("{id}.json"));
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        self.reload_from_disk(hub.safe_mode());
        self.publish_catalog(hub);
        Ok(())
    }

    /// Executes one custom source immediately ("Run now") and publishes its result to `hub`.
    pub async fn run_now(&self, id: &str, hub: &Hub) -> Result<Value, String> {
        if hub.safe_mode() {
            return Err("custom sources are disabled in safe mode".into());
        }
        let (spec, trusted) = {
            let inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
            let spec = inner
                .specs
                .get(id)
                .cloned()
                .ok_or_else(|| format!("unknown source '{id}'"))?;
            let trusted = inner.trust.is_trusted(&spec);
            (spec, trusted)
        };
        if !trusted {
            return Err("source requires user approval before running".into());
        }
        self.execute_one(&spec, hub).await
    }

    async fn execute_one(&self, spec: &SourceSpec, hub: &Hub) -> Result<Value, String> {
        let start = Instant::now();
        let res = match &spec.kind {
            SourceKind::Command {
                argv,
                shell,
                timeout_ms,
                max_bytes,
                env_allowlist,
                format,
                regex,
                ..
            } => {
                run_command(
                    argv,
                    *shell,
                    *timeout_ms,
                    *max_bytes,
                    env_allowlist,
                    *format,
                    regex.as_deref(),
                )
                .await
            }
            SourceKind::File {
                path,
                max_bytes,
                format,
                json_path,
            } => run_file(path, *max_bytes, *format, json_path.as_deref()).await,
            SourceKind::Http {
                url,
                allow_local_http,
                timeout_ms,
                max_bytes,
                headers,
                format,
                json_path,
                ..
            } => {
                let mut cache_entry = {
                    let inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
                    inner.http_cache.get(&spec.id).cloned().unwrap_or_default()
                };
                let r = run_http(
                    url,
                    *allow_local_http,
                    headers,
                    *timeout_ms,
                    *max_bytes,
                    *format,
                    json_path.as_deref(),
                    &mut cache_entry,
                )
                .await;
                if r.is_ok() {
                    let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
                    inner.http_cache.insert(spec.id.clone(), cache_entry);
                }
                r
            }
            SourceKind::Dbus {
                bus,
                destination,
                path,
                interface,
                member,
                ..
            } => run_dbus_property(*bus, destination, path, interface, member).await,
            SourceKind::Mqtt { .. } => {
                return Err("mqtt sources stream continuously; check broker status".into());
            }
            SourceKind::Variable { default_value, .. } => {
                let inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
                let v = inner
                    .variables
                    .get(&spec.id)
                    .or(default_value.as_ref())
                    .cloned()
                    .unwrap_or(serde_json::Value::Null);
                Ok(crate::json::from_json(&v))
            }
        };

        let dur_us = u64::try_from(start.elapsed().as_micros()).unwrap_or(u64::MAX);
        self.record_outcome(&spec.id, &spec.topic_name(), dur_us, &res, hub);
        res
    }

    fn record_outcome(
        &self,
        id: &str,
        topic: &str,
        dur_us: u64,
        res: &Result<Value, String>,
        hub: &Hub,
    ) {
        {
            let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
            inner.last_polled.insert(id.to_owned(), Instant::now());
            if let Some(st) = inner.statuses.get_mut(id) {
                st.last_run_ms = Some(now_ms());
                st.last_duration_us = Some(dur_us);
                st.run_count += 1;
                match res {
                    Ok(_) => {
                        st.state = SourceState::Ok;
                        st.error = None;
                        push_log(
                            &mut st.logs,
                            "info",
                            &format!("Updated in {:.1} ms", dur_us as f64 / 1000.0),
                        );
                    }
                    Err(e) => {
                        st.state = SourceState::Error;
                        st.error = Some(e.clone());
                        push_log(&mut st.logs, "error", e);
                    }
                }
            }
        }
        if let Ok(val) = res {
            hub.publish(vec![TopicUpdate {
                topic: Topic::new(topic),
                value: val.clone(),
            }]);
        }
        self.publish_catalog(hub);
    }

    /// Background supervisor running interval sources, file watchers, and MQTT subscriptions.
    pub async fn run(self: Arc<Self>, hub: Arc<Hub>) {
        self.reload_from_disk(hub.safe_mode());
        self.publish_catalog(&hub);
        if hub.safe_mode() {
            tracing::info!("custom sources runtime skipped in safe mode");
            return;
        }

        let mut reload_rx = self.reload_tx.subscribe();
        let mut active_tasks: Vec<(watch::Sender<bool>, tokio::task::JoinHandle<()>)> = Vec::new();
        self.spawn_streaming_tasks(&hub, &mut active_tasks);

        let mut tick = tokio::time::interval(Duration::from_secs(1));
        loop {
            tokio::select! {
                _ = tick.tick() => {
                    if hub.paused() {
                        continue;
                    }
                    let due = self.collect_due_polled();
                    for spec in due {
                        let mgr = self.clone();
                        let h = hub.clone();
                        tokio::spawn(async move {
                            let _ = mgr.execute_one(&spec, &h).await;
                        });
                    }
                }
                changed = reload_rx.changed() => {
                    if changed.is_err() {
                        break;
                    }
                    for (stop, handle) in active_tasks.drain(..) {
                        let _ = stop.send(true);
                        handle.abort();
                    }
                    self.spawn_streaming_tasks(&hub, &mut active_tasks);
                }
            }
        }
    }

    fn collect_due_polled(&self) -> Vec<SourceSpec> {
        let now = Instant::now();
        let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        let mut due = Vec::new();
        let specs: Vec<SourceSpec> = inner.specs.values().cloned().collect();
        for spec in specs {
            if !spec.enabled || !inner.trust.is_trusted(&spec) {
                continue;
            }
            let interval = match &spec.kind {
                SourceKind::Command { interval_s, .. } | SourceKind::Http { interval_s, .. } => {
                    Some(Duration::from_secs(*interval_s))
                }
                SourceKind::Dbus {
                    mode: DbusMode::Property,
                    interval_s,
                    ..
                } => Some(Duration::from_secs(*interval_s)),
                _ => None,
            };
            let Some(iv) = interval else { continue };
            let should_run = inner
                .last_polled
                .get(&spec.id)
                .is_none_or(|t| now.duration_since(*t) >= iv);
            if should_run {
                inner.last_polled.insert(spec.id.clone(), now);
                due.push(spec);
            }
        }
        due
    }

    fn spawn_streaming_tasks(
        self: &Arc<Self>,
        hub: &Arc<Hub>,
        tasks: &mut Vec<(watch::Sender<bool>, tokio::task::JoinHandle<()>)>,
    ) {
        let specs: Vec<SourceSpec> = {
            let inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
            inner
                .specs
                .values()
                .filter(|s| s.enabled && inner.trust.is_trusted(s))
                .cloned()
                .collect()
        };

        for spec in specs {
            match &spec.kind {
                SourceKind::File { .. } => {
                    let (stop_tx, stop_rx) = watch::channel(false);
                    let mgr = self.clone();
                    let h = hub.clone();
                    let handle = tokio::spawn(async move {
                        mgr.run_file_watcher(spec, h, stop_rx).await;
                    });
                    tasks.push((stop_tx, handle));
                }
                SourceKind::Mqtt { .. } => {
                    let (stop_tx, stop_rx) = watch::channel(false);
                    let mgr = self.clone();
                    let h = hub.clone();
                    let handle = tokio::spawn(async move {
                        mgr.run_mqtt_loop(spec, h, stop_rx).await;
                    });
                    tasks.push((stop_tx, handle));
                }
                _ => {}
            }
        }
    }

    async fn run_file_watcher(
        self: Arc<Self>,
        spec: SourceSpec,
        hub: Arc<Hub>,
        stop_rx: watch::Receiver<bool>,
    ) {
        // Initial read right away.
        let _ = self.execute_one(&spec, &hub).await;

        let SourceKind::File { ref path, .. } = spec.kind else {
            return;
        };
        let target = expand_user_path(path);
        let Some(parent) = target.parent().map(Path::to_path_buf) else {
            return;
        };
        let target_name = target
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_owned();

        let (tx, mut rx) = tokio::sync::mpsc::channel::<()>(4);
        let stop_watch = stop_rx.clone();
        let watcher = tokio::task::spawn_blocking(move || {
            let Ok(fd) = inotify::init(CreateFlags::CLOEXEC | CreateFlags::NONBLOCK) else {
                return;
            };
            let flags = WatchFlags::CLOSE_WRITE | WatchFlags::MOVED_TO | WatchFlags::MODIFY;
            if inotify::add_watch(&fd, &parent, flags).is_err() {
                return;
            }
            let mut buf = [std::mem::MaybeUninit::uninit(); 2048];
            while !*stop_watch.borrow() {
                let mut reader = Reader::new(&fd, &mut buf);
                let mut matched = false;
                while let Ok(ev) = reader.next() {
                    if ev.file_name().and_then(|n| n.to_str().ok()) == Some(target_name.as_str()) {
                        matched = true;
                    }
                }
                if matched {
                    let _ = tx.try_send(());
                }
                std::thread::sleep(Duration::from_millis(120));
            }
        });

        let mut stop = stop_rx;
        loop {
            tokio::select! {
                _ = stop.changed() => {
                    if *stop.borrow() { break; }
                }
                msg = rx.recv() => {
                    if msg.is_none() { break; }
                    let _ = self.execute_one(&spec, &hub).await;
                }
            }
        }
        watcher.abort();
    }

    async fn run_mqtt_loop(
        self: Arc<Self>,
        spec: SourceSpec,
        hub: Arc<Hub>,
        mut stop_rx: watch::Receiver<bool>,
    ) {
        let SourceKind::Mqtt {
            ref host,
            port,
            tls,
            ref topic,
            ref client_id,
            ref username_secret,
            ref password_secret,
            format,
            ref json_path,
        } = spec.kind
        else {
            return;
        };

        let mut backoff_s = 2u64;
        while !*stop_rx.borrow() {
            let username = match username_secret {
                Some(name) => match crate::secrets::get_secret(name).await {
                    Ok(v) => v,
                    Err(e) => {
                        self.record_outcome(&spec.id, &spec.topic_name(), 0, &Err(e), &hub);
                        tokio::time::sleep(Duration::from_secs(backoff_s)).await;
                        backoff_s = (backoff_s * 2).min(60);
                        continue;
                    }
                },
                None => None,
            };
            let password = match password_secret {
                Some(name) => match crate::secrets::get_secret(name).await {
                    Ok(v) => v,
                    Err(e) => {
                        self.record_outcome(&spec.id, &spec.topic_name(), 0, &Err(e), &hub);
                        tokio::time::sleep(Duration::from_secs(backoff_s)).await;
                        backoff_s = (backoff_s * 2).min(60);
                        continue;
                    }
                },
                None => None,
            };

            let cfg = MqttConnectConfig {
                host: host.clone(),
                port,
                tls,
                topic: topic.clone(),
                client_id: client_id
                    .clone()
                    .unwrap_or_else(|| format!("opaline-{}", spec.id)),
                username,
                password,
            };

            let mgr = self.clone();
            let h = hub.clone();
            let sid = spec.id.clone();
            let out_topic = spec.topic_name();
            let jp = json_path.clone();

            let res = connect_and_subscribe(
                &cfg,
                move |_mqtt_topic, payload| {
                    let parsed =
                        super::parsers::parse_payload(&payload, format, None, jp.as_deref());
                    mgr.record_outcome(&sid, &out_topic, 0, &parsed, &h);
                },
                stop_rx.clone(),
            )
            .await;

            if let Err(e) = res {
                self.record_outcome(&spec.id, &spec.topic_name(), 0, &Err(e), &hub);
            }
            if *stop_rx.borrow() {
                break;
            }
            tokio::select! {
                _ = stop_rx.changed() => {}
                _ = tokio::time::sleep(Duration::from_secs(backoff_s)) => {}
            }
            backoff_s = (backoff_s * 2).min(60);
        }
    }
}

fn initial_state(
    spec: &SourceSpec,
    trust: &TrustStore,
    safe_mode: bool,
    prev: Option<&SourceRuntimeStatus>,
) -> SourceState {
    if safe_mode || !spec.enabled {
        return SourceState::Disabled;
    }
    if !trust.is_trusted(spec) {
        return SourceState::NeedsApproval;
    }
    if matches!(spec.kind, SourceKind::Variable { .. }) {
        return SourceState::Ok;
    }
    match prev.map(|p| p.state) {
        Some(SourceState::Ok) => SourceState::Ok,
        Some(SourceState::Error) => SourceState::Error,
        _ => SourceState::Waiting,
    }
}

fn push_log(logs: &mut Vec<SourceLogEntry>, level: &str, message: &str) {
    if logs.len() >= MAX_LOG_ENTRIES {
        logs.remove(0);
    }
    logs.push(SourceLogEntry {
        at_ms: now_ms(),
        level: level.to_owned(),
        message: message.to_owned(),
    });
}

fn read_json_file<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("could not read file: {e}"))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("invalid JSON: {e}"))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use opaline_ipc::BackendKind;
    use serde_json::json;

    use super::*;
    use crate::sources::model::{OutputFormat, SourceOrigin};

    #[tokio::test]
    async fn imported_source_is_blocked_until_approved_and_runs_after_approval() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = SourceManager::new(dir.path().to_path_buf());
        let hub = Hub::new(BackendKind::Instant, Vec::new());

        let spec = SourceSpec {
            schema: None,
            version: 1,
            id: "imported-echo".into(),
            name: "Imported Echo".into(),
            description: None,
            enabled: true,
            origin: SourceOrigin::Imported {
                package_id: "demo-pack".into(),
                package_version: "1.0.0".into(),
            },
            kind: SourceKind::Command {
                argv: vec!["printf".into(), "hello-opaline".into()],
                shell: false,
                interval_s: 30,
                timeout_ms: 3000,
                max_bytes: 4096,
                env_allowlist: Vec::new(),
                format: OutputFormat::Text,
                regex: None,
            },
        };
        mgr.save_source(spec, &hub).unwrap();

        // Status must be NeedsApproval and run_now must refuse.
        let cat = mgr.catalog(false);
        assert_eq!(cat.statuses[0].state, SourceState::NeedsApproval);
        assert!(mgr.run_now("imported-echo", &hub).await.is_err());

        // Approve -> run_now executes and publishes to `source.imported-echo`.
        mgr.approve_source("imported-echo", &hub).unwrap();
        let val = mgr.run_now("imported-echo", &hub).await.unwrap();
        assert_eq!(val, Value::Text("hello-opaline".into()));
        assert_eq!(
            hub.latest(&Topic::new("source.imported-echo")),
            Some(Value::Text("hello-opaline".into()))
        );

        // Diagnose report is redacted: contains kind & state, never the command string.
        let diag = serde_json::to_string(&mgr.diagnose_entries()).unwrap();
        assert!(diag.contains("command"));
        assert!(!diag.contains("hello-opaline"));
        assert!(!diag.contains("printf"));
    }

    #[test]
    fn variable_persists_and_publishes_immediately() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = SourceManager::new(dir.path().to_path_buf());
        let hub = Hub::new(BackendKind::Instant, Vec::new());

        mgr.set_variable("build_status", json!("green"), &hub)
            .unwrap();
        assert_eq!(
            hub.latest(&Topic::new("var.build_status")),
            Some(Value::Text("green".into()))
        );

        // Reload from disk preserves the persisted variable.
        let mgr2 = SourceManager::new(dir.path().to_path_buf());
        let hub2 = Hub::new(BackendKind::Instant, Vec::new());
        mgr2.publish_catalog(&hub2);
        assert_eq!(
            hub2.latest(&Topic::new("var.build_status")),
            Some(Value::Text("green".into()))
        );
    }
}

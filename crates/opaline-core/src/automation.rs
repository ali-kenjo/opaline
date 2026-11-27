//! Automation rules engine on `opaline-expr` (`~/.config/opaline/automation.json`, PLAN-2 8.2, brief §10).
//!
//! Evaluates user-defined rules ("when <expression> -> activate profile / set look / set theme /
//! set variable / notify / run widget action") against all live Hub topics plus desktop context
//! (`desktop.workspace`, `desktop.focusedApp`, `desktop.fullscreen`, `desktop.docked`,
//! `desktop.monitorCount`, `desktop.locked`, `desktop.idle`, `desktop.dnd`, `time.*`).
//! Enforces `minDurationS` and `hysteresisS` so rules never flap, and pauses automatic profile/look
//! switching on manual override until the user triggers "Resume automation".

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use chrono::{Datelike, Local, Timelike};
use opaline_expr::{Host as ExprHost, Key as ExprKey, Locale, Program, Value as ExprValue};
use opaline_ipc::{Topic, TopicUpdate, Value as IpcValue};
use serde::{Deserialize, Serialize};
use serde_json::{Value as Json, json};

use crate::hub::{DbusSignal, Hub};
use crate::store::DesktopLook;

pub const VERSION: u32 = 1;
pub const TOPIC: &str = "automation.state";
const MAX_RULES: usize = 64;

/// Action executed when a rule activates.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum RuleAction {
    #[serde(rename_all = "camelCase")]
    ActivateProfile { profile_id: String },
    #[serde(rename_all = "camelCase")]
    SetLook { look: DesktopLook },
    #[serde(rename_all = "camelCase")]
    SetTheme { theme: String },
    #[serde(rename_all = "camelCase")]
    SetVariable { name: String, value: Json },
    #[serde(rename_all = "camelCase")]
    Notify { title: String, body: String },
    #[serde(rename_all = "camelCase")]
    WidgetAction { widget_id: String, action: String },
}

/// Persisted automation rule definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRule {
    pub id: String,
    pub name: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub priority: i32,
    /// Expression compiled with `opaline_expr::Program::expression`.
    pub condition: String,
    /// Condition must stay true for at least this many seconds before activating.
    #[serde(default)]
    pub min_duration_s: u32,
    /// Once active, stays active until condition has been false for at least this many seconds.
    #[serde(default = "default_hysteresis")]
    pub hysteresis_s: u32,
    pub action: RuleAction,
}

fn default_true() -> bool {
    true
}

fn default_hysteresis() -> u32 {
    5
}

/// Persisted file (`~/.config/opaline/automation.json`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AutomationFile {
    pub version: u32,
    pub enabled: bool,
    pub rules: Vec<AutomationRule>,
}

impl Default for AutomationFile {
    fn default() -> Self {
        Self {
            version: VERSION,
            enabled: true,
            rules: Vec::new(),
        }
    }
}

/// Live desktop & environment context exposed to rules under `desktop.*` and `time.*`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopContext {
    pub workspace: i32,
    pub focused_app: String,
    pub fullscreen: bool,
    pub monitor_count: u32,
    pub docked: bool,
    pub locked: bool,
    pub idle: bool,
}

/// Per-rule runtime tracking for hysteresis & minimum duration.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleRuntime {
    pub active: bool,
    pub condition_now: bool,
    pub true_since_ms: Option<u64>,
    pub false_since_ms: Option<u64>,
    pub last_fired_ms: Option<u64>,
    pub compile_error: Option<String>,
}

/// Snapshot returned to Settings, D-Bus `AutomationStatus`, and CLI `opaline ctl automation status`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationStatus {
    pub enabled: bool,
    pub manual_override: bool,
    pub manual_override_reason: Option<String>,
    pub active_rule_id: Option<String>,
    pub rules: Vec<AutomationRule>,
    pub runtime: BTreeMap<String, RuleRuntime>,
    pub context: DesktopContext,
}

/// Pure deterministic rule evaluator (no I/O) used by both runtime and unit tests.
#[derive(Debug, Default)]
pub struct RulesEvaluator {
    compiled: BTreeMap<String, Result<Program, String>>,
    runtime: BTreeMap<String, RuleRuntime>,
    active_winner: Option<String>,
}

impl RulesEvaluator {
    /// Evaluates `rules` at `now_ms` against `host`. Returns newly triggered actions.
    ///
    /// Rules are sorted by descending `priority`, then original order. Only rules whose condition
    /// stays true for `min_duration_s` activate; once active, they remain active until false for
    /// `hysteresis_s`. When multiple rules are active, the highest-priority active rule wins for
    /// profile/look/theme actions; non-profile rules (notifications, variables, widget actions)
    /// fire once on rising edge (`!was_active && now_active`).
    pub fn step(
        &mut self,
        rules: &[AutomationRule],
        now_ms: u64,
        host: &dyn ExprHost,
        manual_override: bool,
    ) -> Vec<(String, RuleAction)> {
        // Keep compile cache in sync with current rules.
        let mut active_ids = Vec::new();
        for rule in rules {
            let entry = self
                .compiled
                .entry(rule.id.clone())
                .or_insert_with(|| Program::expression(&rule.condition).map_err(|e| e.to_string()));
            // Recompile if the condition string changed? Callers clear cache on rule save.
            let rt = self.runtime.entry(rule.id.clone()).or_default();
            if !rule.enabled {
                rt.active = false;
                rt.condition_now = false;
                rt.true_since_ms = None;
                rt.false_since_ms = None;
                continue;
            }
            let cond = match entry {
                Ok(prog) => {
                    rt.compile_error = None;
                    expr_truthy(&prog.eval(host).value)
                }
                Err(err) => {
                    rt.compile_error = Some(err.clone());
                    false
                }
            };
            rt.condition_now = cond;
            let min_ms = u64::from(rule.min_duration_s) * 1000;
            let hyst_ms = u64::from(rule.hysteresis_s) * 1000;

            if cond {
                rt.false_since_ms = None;
                let since = *rt.true_since_ms.get_or_insert(now_ms);
                if !rt.active && now_ms.saturating_sub(since) >= min_ms {
                    rt.active = true;
                }
            } else {
                rt.true_since_ms = None;
                if rt.active {
                    let since = *rt.false_since_ms.get_or_insert(now_ms);
                    if now_ms.saturating_sub(since) >= hyst_ms {
                        rt.active = false;
                        rt.false_since_ms = None;
                    }
                }
            }
            if rt.active {
                active_ids.push(rule.id.clone());
            }
        }

        // Prune removed rules.
        self.runtime
            .retain(|id, _| rules.iter().any(|r| &r.id == id));
        self.compiled
            .retain(|id, _| rules.iter().any(|r| &r.id == id));

        let mut actions = Vec::new();

        // Pick highest-priority active rule for stateful visual actions (profile/look/theme).
        let mut visual_candidates: Vec<&AutomationRule> = rules
            .iter()
            .filter(|r| {
                r.enabled
                    && self.runtime.get(&r.id).is_some_and(|rt| rt.active)
                    && is_visual_action(&r.action)
            })
            .collect();
        visual_candidates.sort_by_key(|a| std::cmp::Reverse(a.priority));

        let new_winner = visual_candidates.first().map(|r| r.id.clone());
        if !manual_override && new_winner != self.active_winner {
            self.active_winner.clone_from(&new_winner);
            if let Some(winner) = visual_candidates.first() {
                if let Some(rt) = self.runtime.get_mut(&winner.id) {
                    rt.last_fired_ms = Some(now_ms);
                }
                actions.push((winner.id.clone(), winner.action.clone()));
            }
        } else if manual_override {
            // Keep tracking the winner without firing so resuming can immediately apply it.
            self.active_winner = None;
        }

        // Non-visual actions (Notify / SetVariable / WidgetAction) fire once on rising edge.
        for rule in rules {
            if !rule.enabled || is_visual_action(&rule.action) {
                continue;
            }
            if let Some(rt) = self.runtime.get_mut(&rule.id) {
                if rt.active && rt.last_fired_ms.is_none() {
                    rt.last_fired_ms = Some(now_ms);
                    actions.push((rule.id.clone(), rule.action.clone()));
                } else if !rt.active {
                    rt.last_fired_ms = None;
                }
            }
        }

        actions
    }

    pub fn invalidate(&mut self) {
        self.compiled.clear();
    }

    pub fn clear_winner(&mut self) {
        self.active_winner = None;
    }
}

fn is_visual_action(action: &RuleAction) -> bool {
    matches!(
        action,
        RuleAction::ActivateProfile { .. }
            | RuleAction::SetLook { .. }
            | RuleAction::SetTheme { .. }
    )
}

/// Validates a rule before saving.
pub fn validate_rule(rule: &AutomationRule) -> Result<(), String> {
    if rule.id.is_empty()
        || rule.id.len() > 48
        || !rule
            .id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
    {
        return Err("rule id must be 1..=48 lowercase alphanumeric/'-'/'_' chars".into());
    }
    if rule.name.trim().is_empty() || rule.name.len() > 80 {
        return Err("rule name must be 1..=80 characters".into());
    }
    if rule.condition.trim().is_empty() {
        return Err("rule condition cannot be empty".into());
    }
    Program::expression(&rule.condition).map_err(|e| format!("invalid-expression: {e}"))?;
    if rule.min_duration_s > 86_400 || rule.hysteresis_s > 86_400 {
        return Err("durations must be <= 86400 seconds".into());
    }
    Ok(())
}

fn expr_truthy(v: &ExprValue) -> bool {
    match v {
        ExprValue::Null => false,
        ExprValue::Bool(b) => *b,
        ExprValue::Num(n) => *n != 0.0 && !n.is_nan(),
        ExprValue::Str(s) => !s.is_empty(),
        ExprValue::List(l) => !l.is_empty(),
        ExprValue::Map(m) => !m.is_empty(),
    }
}

/// Converts an IPC `Value` to an `opaline_expr::Value`.
pub fn ipc_to_expr(v: &IpcValue) -> ExprValue {
    match v {
        IpcValue::Missing(_) => ExprValue::Null,
        IpcValue::Bool(b) => ExprValue::Bool(*b),
        IpcValue::Num(n) => ExprValue::Num(*n),
        IpcValue::Nums(ns) => ExprValue::List(ns.iter().map(|n| ExprValue::Num(*n)).collect()),
        IpcValue::Text(s) => ExprValue::Str(s.clone()),
        IpcValue::List(items) => ExprValue::List(items.iter().map(ipc_to_expr).collect()),
        IpcValue::Map(map) => ExprValue::Map(
            map.iter()
                .map(|(k, v)| (k.clone(), ipc_to_expr(v)))
                .collect(),
        ),
    }
}

/// `opaline_expr::Host` backed by a snapshot of Hub topics + live desktop/time context.
#[derive(Debug)]
pub struct SnapshotExprHost {
    topics: BTreeMap<String, ExprValue>,
    now_ms: f64,
}

impl SnapshotExprHost {
    pub fn from_hub(hub: &Hub, ctx: &DesktopContext, now_ms: u64) -> Self {
        let mut topics: BTreeMap<String, ExprValue> = hub
            .latest_snapshot()
            .into_iter()
            .map(|(t, v)| (t.as_str().to_owned(), ipc_to_expr(&v)))
            .collect();

        // Synthesize `desktop.*` topics.
        topics.insert(
            "desktop.workspace".into(),
            ExprValue::Num(f64::from(ctx.workspace)),
        );
        topics.insert(
            "desktop.focusedApp".into(),
            ExprValue::Str(ctx.focused_app.clone()),
        );
        topics.insert("desktop.fullscreen".into(), ExprValue::Bool(ctx.fullscreen));
        topics.insert(
            "desktop.monitorCount".into(),
            ExprValue::Num(f64::from(ctx.monitor_count)),
        );
        topics.insert("desktop.docked".into(), ExprValue::Bool(ctx.docked));
        topics.insert("desktop.locked".into(), ExprValue::Bool(ctx.locked));
        topics.insert("desktop.idle".into(), ExprValue::Bool(ctx.idle));

        // Synthesize `time.*` topics from local wall clock.
        let now = Local::now();
        let hour = now.hour();
        topics.insert("time.hour".into(), ExprValue::Num(f64::from(hour)));
        topics.insert(
            "time.minute".into(),
            ExprValue::Num(f64::from(now.minute())),
        );
        topics.insert(
            "time.weekday".into(),
            ExprValue::Num(f64::from(now.weekday().number_from_monday())),
        );
        topics.insert(
            "time.isNight".into(),
            ExprValue::Bool(!(6..21).contains(&hour)),
        );

        // Expose `desktop.dnd` from controls.state when available.
        let dnd = topics
            .get("controls.state")
            .and_then(|v| match v {
                ExprValue::Map(m) => m.get("dnd").cloned(),
                _ => None,
            })
            .unwrap_or(ExprValue::Bool(false));
        topics.insert("desktop.dnd".into(), dnd);

        Self {
            topics,
            now_ms: now_ms as f64,
        }
    }
}

impl ExprHost for SnapshotExprHost {
    fn has_topic(&self, name: &str) -> bool {
        self.topics.contains_key(name)
    }

    fn topic(&self, name: &str, keys: &[ExprKey]) -> ExprValue {
        self.topics
            .get(name)
            .map_or(ExprValue::Null, |v| v.at(keys))
    }

    fn now_ms(&self) -> Option<f64> {
        Some(self.now_ms)
    }

    fn locale(&self) -> Locale {
        Locale::En
    }
}

#[derive(Debug)]
struct Inner {
    file: AutomationFile,
    evaluator: RulesEvaluator,
    manual_override: bool,
    manual_override_reason: Option<String>,
    context: DesktopContext,
}

/// Thread-safe automation rules manager held on `Hub`.
#[derive(Debug)]
pub struct AutomationManager {
    path: PathBuf,
    inner: Mutex<Inner>,
}

impl AutomationManager {
    pub fn new(config_dir: PathBuf) -> Arc<Self> {
        let path = config_dir.join("automation.json");
        let file = load_from(&path);
        Arc::new(Self {
            path,
            inner: Mutex::new(Inner {
                file,
                evaluator: RulesEvaluator::default(),
                manual_override: false,
                manual_override_reason: None,
                context: DesktopContext::default(),
            }),
        })
    }

    pub fn status(&self) -> AutomationStatus {
        let guard = lock(&self.inner);
        AutomationStatus {
            enabled: guard.file.enabled,
            manual_override: guard.manual_override,
            manual_override_reason: guard.manual_override_reason.clone(),
            active_rule_id: guard.evaluator.active_winner.clone(),
            rules: guard.file.rules.clone(),
            runtime: guard.evaluator.runtime.clone(),
            context: guard.context.clone(),
        }
    }

    pub fn set_enabled(&self, hub: &Hub, enabled: bool) -> Result<(), String> {
        let file = {
            let mut guard = lock(&self.inner);
            guard.file.enabled = enabled;
            guard.file.clone()
        };
        save_to(&self.path, &file)?;
        self.publish_state(hub);
        Ok(())
    }

    pub fn save_rule(&self, hub: &Hub, mut rule: AutomationRule) -> Result<AutomationRule, String> {
        rule.name = rule.name.trim().to_owned();
        validate_rule(&rule)?;
        let file = {
            let mut guard = lock(&self.inner);
            if let Some(existing) = guard.file.rules.iter_mut().find(|r| r.id == rule.id) {
                *existing = rule.clone();
            } else {
                if guard.file.rules.len() >= MAX_RULES {
                    return Err(format!("maximum of {MAX_RULES} automation rules reached"));
                }
                guard.file.rules.push(rule.clone());
            }
            guard.evaluator.invalidate();
            guard.file.clone()
        };
        save_to(&self.path, &file)?;
        self.publish_state(hub);
        Ok(rule)
    }

    pub fn delete_rule(&self, hub: &Hub, id: &str) -> Result<bool, String> {
        let (removed, file) = {
            let mut guard = lock(&self.inner);
            let before = guard.file.rules.len();
            guard.file.rules.retain(|r| r.id != id);
            let removed = guard.file.rules.len() != before;
            guard.evaluator.invalidate();
            (removed, guard.file.clone())
        };
        if removed {
            save_to(&self.path, &file)?;
            self.publish_state(hub);
        }
        Ok(removed)
    }

    pub fn set_manual_override(&self, hub: &Hub, reason: Option<String>) {
        {
            let mut guard = lock(&self.inner);
            guard.manual_override = true;
            guard.manual_override_reason = reason;
        }
        self.publish_state(hub);
    }

    /// Clears manual override so rules take effect again immediately on the next tick.
    pub fn resume(&self, hub: &Hub) {
        {
            let mut guard = lock(&self.inner);
            guard.manual_override = false;
            guard.manual_override_reason = None;
            guard.evaluator.clear_winner();
        }
        self.publish_state(hub);
    }

    /// Updates live desktop context from Shell1 v2 or Instant EWMH watcher.
    pub fn set_workspace(&self, hub: &Hub, workspace: i32) {
        let changed = {
            let mut guard = lock(&self.inner);
            if guard.context.workspace == workspace {
                false
            } else {
                guard.context.workspace = workspace;
                true
            }
        };
        if changed {
            hub.publish(vec![TopicUpdate {
                topic: Topic::new("desktop.workspace"),
                value: IpcValue::Num(f64::from(workspace)),
            }]);
            self.publish_state(hub);
        }
    }

    pub fn set_focused_app(&self, hub: &Hub, app_id: String) {
        let changed = {
            let mut guard = lock(&self.inner);
            if guard.context.focused_app == app_id {
                false
            } else {
                guard.context.focused_app = app_id.clone();
                true
            }
        };
        if changed {
            hub.publish(vec![TopicUpdate {
                topic: Topic::new("desktop.focusedApp"),
                value: IpcValue::Text(app_id),
            }]);
            self.publish_state(hub);
        }
    }

    pub fn set_fullscreen(&self, hub: &Hub, fullscreen: bool) {
        let changed = {
            let mut guard = lock(&self.inner);
            if guard.context.fullscreen == fullscreen {
                false
            } else {
                guard.context.fullscreen = fullscreen;
                true
            }
        };
        if changed {
            hub.publish(vec![TopicUpdate {
                topic: Topic::new("desktop.fullscreen"),
                value: IpcValue::Bool(fullscreen),
            }]);
            self.publish_state(hub);
        }
    }

    /// Runs one evaluation pass against the current Hub state and executes any triggered actions.
    pub async fn tick(&self, hub: &Arc<Hub>) {
        let monitors = hub.monitors();
        let monitor_count = u32::try_from(monitors.len()).unwrap_or(u32::MAX);
        let docked = monitors.len() > 1 || monitors.iter().any(|m| !m.builtin);
        let locked = hub.is_locked();
        let idle = hub.all_covered();
        let now_ms = crate::hub::now_ms();

        let actions = {
            let mut guard = lock(&self.inner);
            guard.context.monitor_count = monitor_count;
            guard.context.docked = docked;
            guard.context.locked = locked;
            guard.context.idle = idle;
            if !guard.file.enabled || guard.file.rules.is_empty() {
                Vec::new()
            } else {
                let host = SnapshotExprHost::from_hub(hub, &guard.context, now_ms);
                let rules = guard.file.rules.clone();
                let manual = guard.manual_override;
                guard.evaluator.step(&rules, now_ms, &host, manual)
            }
        };

        if !actions.is_empty() {
            for (rule_id, action) in actions {
                tracing::info!(%rule_id, ?action, "automation rule triggered");
                execute_action(hub, action).await;
            }
            self.publish_state(hub);
        }
    }

    /// Background automation loop: evaluates rules every second (and publishes initial state).
    pub async fn run(self: Arc<Self>, hub: Arc<Hub>) {
        self.publish_state(&hub);
        let mut interval = tokio::time::interval(Duration::from_secs(1));
        loop {
            interval.tick().await;
            self.tick(&hub).await;
        }
    }

    pub fn publish_state(&self, hub: &Hub) {
        let status = self.status();
        if let Ok(val) = serde_json::to_value(&status) {
            hub.publish(vec![TopicUpdate {
                topic: Topic::new(TOPIC),
                value: crate::json::from_json(&val),
            }]);
        }
    }
}

async fn execute_action(hub: &Arc<Hub>, action: RuleAction) {
    match action {
        RuleAction::ActivateProfile { profile_id } => {
            if let Some(profiles) = hub.profiles()
                && let Err(error) = profiles.activate(hub, &profile_id, false).await
            {
                tracing::warn!(%profile_id, %error, "automation profile switch failed");
            }
        }
        RuleAction::SetLook { look } => {
            if let Ok(v) = serde_json::to_value(look)
                && let Err(error) =
                    crate::store::update(hub, json!({ "appearance": { "look": v } })).await
            {
                tracing::warn!(%error, "automation look switch failed");
            }
        }
        RuleAction::SetTheme { theme } => {
            if let Err(error) = crate::store::update(hub, json!({ "theme": theme })).await {
                tracing::warn!(%error, "automation theme switch failed");
            } else {
                hub.emit_dbus(DbusSignal::ThemeChanged { theme_id: theme });
            }
        }
        RuleAction::SetVariable { name, value } => {
            if let Some(sources) = hub.sources() {
                if let Err(error) = sources.set_variable(&name, value.clone(), hub) {
                    tracing::warn!(%name, %error, "automation set variable failed");
                } else {
                    hub.emit_dbus(DbusSignal::VariableChanged {
                        name,
                        value_json: value.to_string(),
                    });
                }
            }
        }
        RuleAction::Notify { title, body } => {
            let _ = send_rule_notification(&title, &body).await;
        }
        RuleAction::WidgetAction { widget_id, action } => {
            hub.emit_dbus(DbusSignal::WidgetAction { widget_id, action });
        }
    }
}

async fn send_rule_notification(title: &str, body: &str) -> Result<(), String> {
    let conn = zbus::Connection::session()
        .await
        .map_err(|e| e.to_string())?;
    let actions: Vec<&str> = Vec::new();
    let hints: std::collections::HashMap<&str, zbus::Variant<'_>> =
        std::collections::HashMap::new();
    let _ = conn
        .call_method(
            Some("org.freedesktop.Notifications"),
            "/org/freedesktop/Notifications",
            Some("org.freedesktop.Notifications"),
            "Notify",
            &(
                "Opaline",
                0u32,
                "io.github.ali_kenjo.Opaline",
                title,
                body,
                actions,
                hints,
                5000i32,
            ),
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn load_from(path: &Path) -> AutomationFile {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return AutomationFile::default();
    };
    match serde_json::from_str::<AutomationFile>(&raw) {
        Ok(mut f) => {
            f.rules.retain(|r| validate_rule(r).is_ok());
            f
        }
        Err(error) => {
            tracing::warn!(%error, path = %path.display(), "invalid automation.json; starting empty");
            AutomationFile::default()
        }
    }
}

fn save_to(path: &Path, file: &AutomationFile) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(file).map_err(|e| e.to_string())?;
    crate::paths::write_atomic(path, &bytes).map_err(|e| e.to_string())
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;
    use opaline_expr::MapHost;

    fn make_host(entries: &[(&str, ExprValue)]) -> MapHost {
        let mut h = MapHost::default();
        for (k, v) in entries {
            h.topics.insert((*k).to_owned(), v.clone());
        }
        h
    }

    #[test]
    fn min_duration_and_hysteresis_prevent_flapping() {
        let mut eval = RulesEvaluator::default();
        let rules = vec![AutomationRule {
            id: "coding".into(),
            name: "Coding workspace".into(),
            enabled: true,
            priority: 10,
            condition: r#"desktop.focusedApp == "code" && desktop.workspace == 2"#.into(),
            min_duration_s: 3,
            hysteresis_s: 5,
            action: RuleAction::ActivateProfile {
                profile_id: "dev".into(),
            },
        }];

        let matched = make_host(&[
            ("desktop.focusedApp", ExprValue::Str("code".into())),
            ("desktop.workspace", ExprValue::Num(2.0)),
        ]);
        let unmatched = make_host(&[
            ("desktop.focusedApp", ExprValue::Str("firefox".into())),
            ("desktop.workspace", ExprValue::Num(1.0)),
        ]);

        // t=0..2s: still under min_duration_s=3 -> must not fire.
        assert!(eval.step(&rules, 1_000, &matched, false).is_empty());
        assert!(eval.step(&rules, 3_000, &matched, false).is_empty());
        // t=4s (3s elapsed): activates!
        let fired = eval.step(&rules, 4_000, &matched, false);
        assert_eq!(fired.len(), 1);
        assert_eq!(fired[0].0, "coding");

        // Brief 2s drop (< hysteresis_s=5) does NOT deactivate or re-fire!
        assert!(eval.step(&rules, 6_000, &unmatched, false).is_empty());
        assert!(eval.runtime.get("coding").unwrap().active);
        assert!(eval.step(&rules, 8_000, &matched, false).is_empty());
        assert!(eval.runtime.get("coding").unwrap().active);

        // Sustained 6s drop (>= hysteresis_s=5) deactivates cleanly.
        assert!(eval.step(&rules, 10_000, &unmatched, false).is_empty());
        assert!(eval.step(&rules, 16_000, &unmatched, false).is_empty());
        assert!(!eval.runtime.get("coding").unwrap().active);
    }

    #[test]
    fn manual_override_pauses_visual_rules_until_resumed() {
        let mut eval = RulesEvaluator::default();
        let rules = vec![AutomationRule {
            id: "night".into(),
            name: "Night look".into(),
            enabled: true,
            priority: 5,
            condition: "time.isNight".into(),
            min_duration_s: 0,
            hysteresis_s: 0,
            action: RuleAction::SetLook {
                look: DesktopLook::Dark,
            },
        }];
        let host = make_host(&[("time.isNight", ExprValue::Bool(true))]);

        // While manual_override is true, rule does not fire.
        assert!(eval.step(&rules, 1_000, &host, true).is_empty());
        // Once resumed (manual_override=false), rule fires immediately.
        let fired = eval.step(&rules, 2_000, &host, false);
        assert_eq!(fired.len(), 1);
        assert_eq!(fired[0].0, "night");
    }

    #[test]
    fn higher_priority_rule_wins_on_overlap() {
        let mut eval = RulesEvaluator::default();
        let rules = vec![
            AutomationRule {
                id: "low".into(),
                name: "Docked".into(),
                enabled: true,
                priority: 1,
                condition: "desktop.docked".into(),
                min_duration_s: 0,
                hysteresis_s: 0,
                action: RuleAction::ActivateProfile {
                    profile_id: "desk".into(),
                },
            },
            AutomationRule {
                id: "high".into(),
                name: "Presenting".into(),
                enabled: true,
                priority: 20,
                condition: "desktop.fullscreen".into(),
                min_duration_s: 0,
                hysteresis_s: 0,
                action: RuleAction::ActivateProfile {
                    profile_id: "minimal".into(),
                },
            },
        ];
        let host = make_host(&[
            ("desktop.docked", ExprValue::Bool(true)),
            ("desktop.fullscreen", ExprValue::Bool(true)),
        ]);
        let fired = eval.step(&rules, 1_000, &host, false);
        assert_eq!(fired.len(), 1);
        assert_eq!(fired[0].0, "high");
    }
}

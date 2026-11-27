//! Named desktop profiles (`~/.config/opaline/profiles.json`, PLAN-2 8.1, brief §10).
//!
//! A profile snapshots per-monitor layouts, theme, Desktop look, appearance state, performance
//! mode, and hidden widget IDs. Activating a profile applies its settings and layouts atomically
//! so widgets smoothly animate to their new places via `SpringSlot`.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};

use opaline_ipc::{Topic, TopicUpdate};
use serde::{Deserialize, Serialize};
use serde_json::{Value as Json, json};

use crate::hub::Hub;
use crate::layouts::Layouts;
use crate::store::{AppearanceState, DesktopLook, PerformanceMode};

pub const VERSION: u32 = 1;
pub const TOPIC: &str = "profiles.state";
const MAX_PROFILES: usize = 32;

/// A named desktop configuration (layout, theme, look, appearance, performance, visibility).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub look: Option<DesktopLook>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub appearance_state: Option<AppearanceState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub performance_mode: Option<PerformanceMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layouts: Option<Layouts>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hidden_widgets: Vec<String>,
}

/// On-disk profiles file (`~/.config/opaline/profiles.json`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ProfilesFile {
    pub version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_id: Option<String>,
    pub profiles: Vec<Profile>,
}

impl Default for ProfilesFile {
    fn default() -> Self {
        Self {
            version: VERSION,
            active_id: None,
            profiles: Vec::new(),
        }
    }
}

/// Validates a profile identifier (`[a-z0-9_-]`, 1..=48 chars).
pub fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 48 {
        return Err("profile id must be 1..=48 characters".into());
    }
    if !id
        .bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
    {
        return Err("profile id may contain only lowercase letters, digits, '-' and '_'".into());
    }
    Ok(())
}

/// Validates a profile struct before saving.
pub fn validate_profile(p: &Profile) -> Result<(), String> {
    validate_id(&p.id)?;
    let name = p.name.trim();
    if name.is_empty() || name.len() > 80 {
        return Err("profile name must be 1..=80 characters".into());
    }
    if let Some(theme) = &p.theme
        && (theme.trim().is_empty() || theme.len() > 64)
    {
        return Err("invalid profile theme id".into());
    }
    if p.hidden_widgets.len() > 256 {
        return Err("too many hidden widgets".into());
    }
    Ok(())
}

/// Thread-safe manager for Opaline profiles held on `Hub`.
#[derive(Debug)]
pub struct ProfilesManager {
    path: PathBuf,
    state: Mutex<ProfilesFile>,
}

impl ProfilesManager {
    /// Creates a manager backed by `<config_dir>/profiles.json`.
    pub fn new(config_dir: PathBuf) -> Arc<Self> {
        let path = config_dir.join("profiles.json");
        let file = load_from(&path);
        Arc::new(Self {
            path,
            state: Mutex::new(file),
        })
    }

    /// Snapshot of all profiles and the currently active profile id.
    pub fn snapshot(&self) -> ProfilesFile {
        lock(&self.state).clone()
    }

    pub fn active_id(&self) -> Option<String> {
        lock(&self.state).active_id.clone()
    }

    pub fn list(&self) -> Vec<Profile> {
        lock(&self.state).profiles.clone()
    }

    pub fn get(&self, id: &str) -> Option<Profile> {
        lock(&self.state)
            .profiles
            .iter()
            .find(|p| p.id == id)
            .cloned()
    }

    /// Creates or replaces a profile, saves atomically, and publishes `"profiles.state"`.
    pub fn save(&self, hub: &Hub, mut profile: Profile) -> Result<Profile, String> {
        profile.name = profile.name.trim().to_owned();
        validate_profile(&profile)?;
        let snapshot = {
            let mut guard = lock(&self.state);
            if let Some(existing) = guard.profiles.iter_mut().find(|p| p.id == profile.id) {
                *existing = profile.clone();
            } else {
                if guard.profiles.len() >= MAX_PROFILES {
                    return Err(format!("maximum of {MAX_PROFILES} profiles reached"));
                }
                guard.profiles.push(profile.clone());
            }
            guard.clone()
        };
        save_to(&self.path, &snapshot)?;
        publish_state(hub, &snapshot);
        Ok(profile)
    }

    /// Captures the current desktop state (theme, look, appearance, performance, layouts) as a profile.
    pub fn snapshot_current(&self, hub: &Hub, id: &str, name: &str) -> Result<Profile, String> {
        let settings = hub.settings();
        let layouts = (*hub.layouts()).clone();
        let existing_hidden = self.get(id).map(|p| p.hidden_widgets).unwrap_or_default();
        let profile = Profile {
            id: id.to_owned(),
            name: name.trim().to_owned(),
            theme: Some(settings.theme.clone()),
            look: Some(settings.appearance.look),
            appearance_state: Some(settings.appearance.state),
            performance_mode: Some(settings.performance.mode),
            layouts: Some(layouts),
            hidden_widgets: existing_hidden,
        };
        self.save(hub, profile)
    }

    /// Deletes a profile by id.
    pub fn delete(&self, hub: &Hub, id: &str) -> Result<bool, String> {
        validate_id(id)?;
        let (removed, snapshot) = {
            let mut guard = lock(&self.state);
            let before = guard.profiles.len();
            guard.profiles.retain(|p| p.id != id);
            let removed = guard.profiles.len() != before;
            if guard.active_id.as_deref() == Some(id) {
                guard.active_id = None;
            }
            (removed, guard.clone())
        };
        if removed {
            save_to(&self.path, &snapshot)?;
            publish_state(hub, &snapshot);
        }
        Ok(removed)
    }

    /// Activates a profile by id, applying its settings and layouts atomically.
    /// When `manual` is true, records a manual override in the automation engine until resumed.
    pub async fn activate(
        &self,
        hub: &Arc<Hub>,
        id: &str,
        manual: bool,
    ) -> Result<Profile, String> {
        validate_id(id)?;
        let profile = self
            .get(id)
            .ok_or_else(|| format!("profile-not-found: {id}"))?;

        let prev_theme = hub.settings().theme.clone();
        let mut patch = serde_json::Map::new();
        if let Some(theme) = &profile.theme {
            patch.insert("theme".into(), Json::String(theme.clone()));
        }
        let mut appearance = serde_json::Map::new();
        if let Some(look) = profile.look
            && let Ok(v) = serde_json::to_value(look)
        {
            appearance.insert("look".into(), v);
        }
        if let Some(state) = profile.appearance_state
            && let Ok(v) = serde_json::to_value(state)
        {
            appearance.insert("state".into(), v);
        }
        if !appearance.is_empty() {
            patch.insert("appearance".into(), Json::Object(appearance));
        }
        if let Some(perf) = profile.performance_mode
            && let Ok(v) = serde_json::to_value(perf)
        {
            patch.insert("performance".into(), json!({ "mode": v }));
        }
        if !patch.is_empty() {
            crate::store::update(hub, Json::Object(patch)).await?;
        }
        if let Some(layouts) = &profile.layouts {
            let raw = serde_json::to_value(layouts).map_err(|e| e.to_string())?;
            crate::layouts::update(hub, raw).await?;
        }

        let snapshot = {
            let mut guard = lock(&self.state);
            guard.active_id = Some(profile.id.clone());
            guard.clone()
        };
        save_to(&self.path, &snapshot)?;
        publish_state(hub, &snapshot);

        hub.emit_dbus(crate::hub::DbusSignal::ProfileChanged {
            profile_id: profile.id.clone(),
        });
        if let Some(theme) = &profile.theme
            && theme != &prev_theme
        {
            hub.emit_dbus(crate::hub::DbusSignal::ThemeChanged {
                theme_id: theme.clone(),
            });
        }
        if manual && let Some(auto) = hub.automation() {
            auto.set_manual_override(hub, Some(format!("Manual switch to '{}'", profile.name)));
        }
        Ok(profile)
    }

    /// Cycles to the next saved profile (for keyboard shortcut / CLI).
    pub async fn cycle_next(&self, hub: &Arc<Hub>) -> Result<Option<Profile>, String> {
        let next_id = {
            let guard = lock(&self.state);
            if guard.profiles.is_empty() {
                None
            } else {
                let idx = guard
                    .active_id
                    .as_deref()
                    .and_then(|cur| guard.profiles.iter().position(|p| p.id == cur))
                    .map_or(0, |i| (i + 1) % guard.profiles.len());
                guard.profiles.get(idx).map(|p| p.id.clone())
            }
        };
        match next_id {
            Some(id) => self.activate(hub, &id, true).await.map(Some),
            None => Ok(None),
        }
    }

    /// Toggles a widget id's visibility in the active profile (or in an ad-hoc hidden set).
    /// Returns `true` if the widget is now visible, `false` if hidden.
    pub fn toggle_widget_visibility(&self, hub: &Hub, widget_id: &str) -> Result<bool, String> {
        if widget_id.trim().is_empty() || widget_id.len() > 80 {
            return Err("invalid-widget-id".into());
        }
        let (visible, snapshot) = {
            let mut guard = lock(&self.state);
            let active = guard.active_id.clone();
            if let Some(profile) = active
                .as_deref()
                .and_then(|id| guard.profiles.iter_mut().find(|p| p.id == id))
            {
                if let Some(pos) = profile.hidden_widgets.iter().position(|w| w == widget_id) {
                    profile.hidden_widgets.remove(pos);
                    (true, guard.clone())
                } else {
                    profile.hidden_widgets.push(widget_id.to_owned());
                    (false, guard.clone())
                }
            } else {
                // No active profile yet: create a default profile to persist visibility toggle.
                let profile = Profile {
                    id: "default".into(),
                    name: "Default".into(),
                    theme: None,
                    look: None,
                    appearance_state: None,
                    performance_mode: None,
                    layouts: None,
                    hidden_widgets: vec![widget_id.to_owned()],
                };
                guard.profiles.push(profile);
                guard.active_id = Some("default".into());
                (false, guard.clone())
            }
        };
        save_to(&self.path, &snapshot)?;
        publish_state(hub, &snapshot);
        Ok(visible)
    }

    /// Publishes the initial `"profiles.state"` snapshot on startup.
    pub fn publish_initial(&self, hub: &Hub) {
        let snapshot = self.snapshot();
        publish_state(hub, &snapshot);
    }
}

fn publish_state(hub: &Hub, file: &ProfilesFile) {
    let hidden: Vec<String> = file
        .active_id
        .as_deref()
        .and_then(|id| file.profiles.iter().find(|p| p.id == id))
        .map(|p| p.hidden_widgets.clone())
        .unwrap_or_default();
    let summaries: Vec<Json> = file
        .profiles
        .iter()
        .map(|p| {
            json!({
                "id": p.id,
                "name": p.name,
                "theme": p.theme,
                "look": p.look,
                "appearanceState": p.appearance_state,
                "performanceMode": p.performance_mode,
                "hasLayouts": p.layouts.is_some(),
                "hiddenWidgets": p.hidden_widgets,
            })
        })
        .collect();
    let payload = json!({
        "activeId": file.active_id,
        "hiddenWidgets": hidden,
        "profiles": summaries,
    });
    hub.publish(vec![TopicUpdate {
        topic: Topic::new(TOPIC),
        value: crate::json::from_json(&payload),
    }]);
}

fn load_from(path: &Path) -> ProfilesFile {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return ProfilesFile::default();
    };
    match serde_json::from_str::<ProfilesFile>(&raw) {
        Ok(mut f) => {
            f.profiles.retain(|p| validate_profile(p).is_ok());
            f
        }
        Err(error) => {
            tracing::warn!(%error, path = %path.display(), "invalid profiles.json; starting empty");
            ProfilesFile::default()
        }
    }
}

fn save_to(path: &Path, file: &ProfilesFile) -> Result<(), String> {
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
    use opaline_ipc::BackendKind;

    #[test]
    fn profile_id_validation() {
        assert!(validate_id("work-desk_1").is_ok());
        assert!(validate_id("").is_err());
        assert!(validate_id("Bad Upper").is_err());
        assert!(validate_id("../escape").is_err());
    }

    #[tokio::test]
    async fn snapshot_activate_cycle_and_toggle_visibility() {
        let dir = tempfile::tempdir().unwrap();
        let hub = Hub::new(BackendKind::Instant, Vec::new());
        hub.init_settings(crate::store::Settings::default(), false);
        hub.init_layouts(Layouts::default(), false);

        let mgr = ProfilesManager::new(dir.path().to_path_buf());
        let work = Profile {
            id: "work".into(),
            name: "Work".into(),
            theme: None,
            look: None,
            appearance_state: None,
            performance_mode: None,
            layouts: None,
            hidden_widgets: vec![],
        };
        let night = Profile {
            id: "night".into(),
            name: "Night".into(),
            theme: None,
            look: None,
            appearance_state: None,
            performance_mode: None,
            layouts: None,
            hidden_widgets: vec!["w-clock".into()],
        };
        mgr.save(&hub, work).unwrap();
        mgr.save(&hub, night).unwrap();
        assert_eq!(mgr.list().len(), 2);

        // Activate "work" (non-writable store still updates hub in memory in tests? Let's verify).
        let active = mgr.activate(&hub, "work", false).await.unwrap();
        assert_eq!(active.id, "work");
        assert_eq!(mgr.active_id().as_deref(), Some("work"));

        // Cycle advances to "night".
        let next = mgr.cycle_next(&hub).await.unwrap().unwrap();
        assert_eq!(next.id, "night");

        // Toggle visibility removes then re-adds w-clock.
        assert!(mgr.toggle_widget_visibility(&hub, "w-clock").unwrap());
        assert!(!mgr.toggle_widget_visibility(&hub, "w-clock").unwrap());

        // Persists across reload.
        let reloaded = ProfilesManager::new(dir.path().to_path_buf());
        assert_eq!(reloaded.list().len(), 2);
        assert_eq!(reloaded.active_id().as_deref(), Some("night"));
    }
}

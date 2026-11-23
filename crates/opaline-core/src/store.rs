//! Settings: `~/.config/opaline/settings.json`, versioned, written atomically, with core as the
//! only writer (ARCHITECTURE §3.6). Changes arrive as JSON merge patches and are validated by
//! deserialising the result before anything is saved. Widget style and configs (ADR 0011) live in
//! `style.rs`. Layouts join in Phase 5.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::hub::Hub;
use crate::style::{Style, WidgetConfig};

pub const VERSION: u32 = 1;
pub const TOPIC: &str = "settings";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub version: u32,
    pub weather: Weather,
    pub network: Network,
    pub calendar: Calendar,
    pub privacy: Privacy,
    pub alerts: Vec<crate::alerts::Rule>,
    /// Global widget style (Settings → Appearance); each widget may override any field.
    pub style: Style,
    /// Named styles the user saved ("Night", "Minimal").
    pub styles: BTreeMap<String, Style>,
    /// Placed widgets by instance id.
    pub widgets: BTreeMap<String, WidgetConfig>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: VERSION,
            weather: Weather::default(),
            network: Network::default(),
            calendar: Calendar::default(),
            privacy: Privacy::default(),
            alerts: crate::alerts::default_rules(),
            style: Style::default(),
            styles: BTreeMap::new(),
            widgets: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Location {
    pub name: String,
    pub latitude: f64,
    pub longitude: f64,
    #[serde(default)]
    pub country: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Weather {
    /// Chosen in onboarding or Settings (city search); `None` = weather not set up.
    pub location: Option<Location>,
    /// Use the Location portal instead (asked for first).
    pub automatic: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Network {
    pub billing_day: u32,
    pub latency_target: String,
    /// Opt-in (brief §2.8): off by default.
    pub public_ip: bool,
}

impl Default for Network {
    fn default() -> Self {
        Self {
            billing_day: 1,
            latency_target: "1.1.1.1".into(),
            public_ip: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Calendar {
    /// Read GNOME's calendars (Evolution Data Server).
    pub system: bool,
    /// ICS / webcal subscription URLs.
    pub subscriptions: Vec<String>,
}

impl Default for Calendar {
    fn default() -> Self {
        Self {
            system: true,
            subscriptions: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Privacy {
    pub update_checks: bool,
    /// "Show CPU power and full SSD health" (brief §2.8): uses the privileged helper.
    pub privileged_sensors: bool,
}

impl Default for Privacy {
    fn default() -> Self {
        Self {
            update_checks: true,
            privileged_sensors: false,
        }
    }
}

impl Settings {
    /// Checks values that serde can't (ranges, URL schemes).
    pub fn validate(&self) -> Result<(), String> {
        let mut ids = std::collections::HashSet::new();
        if self
            .alerts
            .iter()
            .any(|r| !ids.insert(r.id.as_str()) || r.series.is_empty() || !r.threshold.is_finite())
        {
            return Err("invalid-alert-rule".into());
        }
        if !(1..=31).contains(&self.network.billing_day) {
            return Err("billing-day-out-of-range".into());
        }
        if self
            .network
            .latency_target
            .parse::<std::net::IpAddr>()
            .is_err()
        {
            return Err("latency-target-not-an-ip".into());
        }
        if let Some(l) = &self.weather.location
            && (!(-90.0..=90.0).contains(&l.latitude) || !(-180.0..=180.0).contains(&l.longitude))
        {
            return Err("location-out-of-range".into());
        }
        if self
            .calendar
            .subscriptions
            .iter()
            .any(|u| !(u.starts_with("https://") || u.starts_with("webcal://")))
        {
            return Err("subscription-must-be-https-or-webcal".into());
        }
        self.style.validate()?;
        crate::style::validate_widgets(&self.widgets, &self.styles)?;
        Ok(())
    }
}

/// RFC 7396 JSON merge patch.
pub fn merge(target: &mut serde_json::Value, patch: &serde_json::Value) {
    match (target, patch) {
        (serde_json::Value::Object(t), serde_json::Value::Object(p)) => {
            for (k, v) in p {
                if v.is_null() {
                    t.remove(k);
                } else {
                    merge(t.entry(k.clone()).or_insert(serde_json::Value::Null), v);
                }
            }
        }
        (t, p) => *t = p.clone(),
    }
}

/// Applies a patch to settings, returning the validated result.
pub fn patched(current: &Settings, patch: &serde_json::Value) -> Result<Settings, String> {
    let mut json = serde_json::to_value(current).map_err(|e| e.to_string())?;
    merge(&mut json, patch);
    let next: Settings =
        serde_json::from_value(json).map_err(|e| format!("invalid-settings: {e}"))?;
    if next.version != VERSION {
        return Err("version-is-read-only".into());
    }
    next.validate()?;
    Ok(next)
}

/// Upgrades a stored file to the current version. A newer file than we understand is read
/// with defaults for anything unknown, and never overwritten by this older build.
pub fn migrate(mut json: serde_json::Value) -> (Settings, bool) {
    let version = json
        .get("version")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    if version == 0
        && let Some(obj) = json.as_object_mut()
    {
        // v0 (unversioned) → v1: nothing renamed yet; just stamp the version.
        obj.insert("version".into(), serde_json::json!(1));
    }
    let writable = version <= u64::from(VERSION);
    crate::style::sanitize(&mut json);
    let mut settings: Settings = serde_json::from_value(json).unwrap_or_default();
    settings.version = VERSION;
    if settings.validate().is_err() {
        tracing::warn!("stored settings failed validation; using defaults for this run");
        return (Settings::default(), false);
    }
    (settings, writable)
}

fn path() -> Option<PathBuf> {
    crate::paths::config_dir()
        .ok()
        .map(|d| d.join("settings.json"))
}

/// Loads settings (defaults if there's no file) and whether this build may write the file.
pub fn load() -> (Settings, bool) {
    let Some(text) = path().and_then(|p| std::fs::read_to_string(p).ok()) else {
        return (Settings::default(), true);
    };
    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(json) => migrate(json),
        Err(error) => {
            tracing::warn!(%error, "settings.json is not valid JSON; using defaults, keeping the file");
            (Settings::default(), false)
        }
    }
}

fn save(settings: &Settings) -> Result<(), String> {
    let path = path().ok_or("no-config-dir")?;
    let bytes = serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?;
    crate::paths::write_atomic(&path, &bytes).map_err(|e| e.to_string())
}

/// Applies a patch from a command: validates, saves, and publishes the new settings.
pub async fn update(hub: &Arc<Hub>, patch: serde_json::Value) -> Result<(), String> {
    let next = patched(&hub.settings(), &patch)?;
    if !hub.settings_writable() {
        return Err("settings-file-is-newer".into());
    }
    let to_save = next.clone();
    tokio::task::spawn_blocking(move || save(&to_save))
        .await
        .map_err(|e| e.to_string())??;
    hub.set_settings(next);
    Ok(())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use serde_json::json;

    use super::*;

    #[test]
    fn patches_merge_and_validate() {
        let s = Settings::default();
        let next = patched(&s, &json!({"network": {"billingDay": 15}})).unwrap();
        assert_eq!(next.network.billing_day, 15);
        assert_eq!(
            next.network.latency_target, "1.1.1.1",
            "untouched fields stay"
        );
        assert_eq!(
            patched(&s, &json!({"network": {"billingDay": 40}})),
            Err("billing-day-out-of-range".into())
        );
        assert!(patched(&s, &json!({"network": {"billingDay": "x"}})).is_err());
        assert_eq!(
            patched(&s, &json!({"version": 2})),
            Err("version-is-read-only".into())
        );
        let loc = json!({"weather": {"location": {"name": "Berlin", "latitude": 52.52, "longitude": 13.41}}});
        assert_eq!(
            patched(&s, &loc).unwrap().weather.location.unwrap().name,
            "Berlin"
        );
        let cleared = patched(
            &patched(&s, &loc).unwrap(),
            &json!({"weather": {"location": null}}),
        )
        .unwrap();
        assert!(cleared.weather.location.is_none());
        assert!(
            patched(
                &s,
                &json!({"calendar": {"subscriptions": ["http://x/a.ics"]}})
            )
            .is_err()
        );
    }

    #[test]
    fn widget_style_patches() {
        let s = Settings::default();
        let next = patched(
            &s,
            &json!({"style": {"transparency": 70}, "widgets": {"cpu-1": {"kind": "cpu", "style": {"fontFamily": "Inter"}}}}),
        )
        .unwrap();
        assert_eq!(next.style.transparency, Some(70.0));
        assert_eq!(
            next.widgets["cpu-1"].style.font_family.as_deref(),
            Some("Inter")
        );
        let reset = patched(
            &next,
            &json!({"widgets": {"cpu-1": {"style": {"fontFamily": null}}}}),
        )
        .unwrap();
        assert_eq!(
            reset.widgets["cpu-1"].style.font_family, None,
            "null resets a field to inherit"
        );
        assert!(patched(&s, &json!({"style": {"blur": 500}})).is_err());
        let removed = patched(&next, &json!({"widgets": {"cpu-1": null}})).unwrap();
        assert!(removed.widgets.is_empty());
    }

    #[test]
    fn a_bad_style_value_keeps_the_other_settings() {
        let (s, writable) = migrate(json!({
            "version": 1, "network": {"billingDay": 9}, "style": {"blur": 999, "rim": 20}
        }));
        assert_eq!(s.network.billing_day, 9);
        assert_eq!(s.style.rim, Some(20.0));
        assert_eq!(s.style.blur, None);
        assert!(writable);
    }

    #[test]
    fn migration() {
        let (s, writable) = migrate(json!({"network": {"publicIp": true}}));
        assert!(s.network.public_ip);
        assert_eq!(s.version, VERSION);
        assert!(writable);
        let (_, writable) = migrate(json!({"version": 99, "futureThing": 1}));
        assert!(!writable, "never overwrite a file from a newer Opaline");
        let (s, writable) = migrate(json!({"version": 1, "network": {"billingDay": 0}}));
        assert_eq!(s, Settings::default());
        assert!(!writable);
    }
}

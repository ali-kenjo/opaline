//! Settings: `~/.config/opaline/settings.json`, versioned, written atomically, with core as the
//! only writer (ARCHITECTURE §3.6). Changes arrive as JSON merge patches and are validated by
//! deserialising the result before anything is saved. Widget style and configs (ADR 0011) live in
//! `style.rs`. Layouts join in Phase 5.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::hub::Hub;
use crate::style::{Style, WidgetConfig};

pub const VERSION: u32 = 2;
pub const TOPIC: &str = "settings";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Language {
    #[default]
    System,
    En,
    De,
    Ar,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    /// JSON Schema URL for editor autocomplete and validation (brief §5.4).
    #[serde(rename = "$schema", skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    pub version: u32,
    pub onboarding_done: bool,
    pub language: Language,
    /// Active theme package id (`"opaline"`, `"classic"`, or a user theme id).
    pub theme: String,
    pub appearance: AppearancePrefs,
    pub layout: LayoutPrefs,
    pub performance: PerformancePrefs,
    pub weather: Weather,
    pub network: Network,
    pub calendar: Calendar,
    pub privacy: Privacy,
    pub alerts: Vec<crate::alerts::Rule>,
    /// Global widget style (Settings → Appearance); each widget may override any field.
    pub style: Style,
    /// Per-widget-kind style overrides (cascade layer between global and widget instance).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub kind_styles: BTreeMap<String, Style>,
    /// Named styles the user saved ("Night", "Minimal").
    pub styles: BTreeMap<String, Style>,
    /// Placed widgets by instance id.
    pub widgets: BTreeMap<String, WidgetConfig>,
}

/// Default theme for fresh 2.0 accounts (brief §3.1). Upgraded 1.x files get `"classic"`.
pub const DEFAULT_THEME: &str = "opaline";
/// The 1.1 look theme id (brief §0.6).
pub const CLASSIC_THEME: &str = "classic";
/// Installed schema path written as `$schema` into `settings.json` (brief §5.4).
pub const SCHEMA_URL: &str = "file:///usr/share/opaline/schemas/settings.schema.json";

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema: Some(SCHEMA_URL.to_owned()),
            version: VERSION,
            onboarding_done: false,
            language: Language::System,
            theme: DEFAULT_THEME.to_owned(),
            appearance: AppearancePrefs::default(),
            layout: LayoutPrefs::default(),
            performance: PerformancePrefs::default(),
            weather: Weather::default(),
            network: Network::default(),
            calendar: Calendar::default(),
            privacy: Privacy::default(),
            alerts: crate::alerts::default_rules(),
            style: Style::default(),
            kind_styles: BTreeMap::new(),
            styles: BTreeMap::new(),
            widgets: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum AppearanceState {
    #[default]
    Automatic,
    Full,
    Dimmed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Density {
    Compact,
    #[default]
    Comfortable,
    Spacious,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct AppearancePrefs {
    pub state: AppearanceState,
    /// Clear (0) … Tinted (100), brief §4.2 default 45.
    pub glass: u32,
    pub density: Density,
    /// The desktop look quick mode (2.0 brief §3.3, DESIGN-2 §6.4), applied over every widget.
    pub look: DesktopLook,
    /// The one color of the Tinted look (`#rrggbb`); unset uses the accent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub look_color: Option<String>,
    /// Master transparency 0 (more solid) … 100 (clear); 50 leaves every widget as it is.
    pub master_transparency: u32,
}

/// Desktop look quick modes.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum DesktopLook {
    /// Every widget as styled.
    #[default]
    Glass,
    /// Very see-through: little tint and blur.
    Clear,
    /// One tint color for every widget.
    Tinted,
    Dark,
    Light,
    Dimmed,
}

impl Default for AppearancePrefs {
    fn default() -> Self {
        Self {
            state: AppearanceState::Automatic,
            glass: 45,
            density: Density::Comfortable,
            look: DesktopLook::Glass,
            look_color: None,
            master_transparency: 50,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct LayoutPrefs {
    /// Safe margin around each monitor's work area in logical pixels (12..=64, default 24).
    pub margin_px: u32,
}

impl Default for LayoutPrefs {
    fn default() -> Self {
        Self { margin_px: 24 }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum PerformanceMode {
    Eco,
    #[default]
    Balanced,
    Realtime,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct PerformancePrefs {
    pub mode: PerformanceMode,
    pub pause_on_battery: bool,
}

impl Default for PerformancePrefs {
    fn default() -> Self {
        Self {
            mode: PerformanceMode::Balanced,
            pause_on_battery: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Location {
    pub name: String,
    pub latitude: f64,
    pub longitude: f64,
    #[serde(default)]
    pub country: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct Weather {
    /// Chosen in onboarding or Settings (city search); `None` = weather not set up.
    pub location: Option<Location>,
    /// Use the Location portal instead (asked for first).
    pub automatic: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
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
    /// The JSON Schema of `settings.json` (`spec/settings.schema.json`).
    pub fn schema() -> serde_json::Value {
        serde_json::Value::from(schemars::schema_for!(Settings))
    }

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
        if self.appearance.master_transparency > 100 {
            return Err("master-transparency-out-of-range".into());
        }
        if let Some(c) = &self.appearance.look_color
            && !(c.len() == 7
                && c.starts_with('#')
                && c.chars().skip(1).all(|x| x.is_ascii_hexdigit()))
        {
            return Err("look-color-not-hex".into());
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
        if self.appearance.glass > 100 {
            return Err("glass-out-of-range".into());
        }
        if !(12..=64).contains(&self.layout.margin_px) {
            return Err("margin-out-of-range".into());
        }
        if !crate::style::id_ok(&self.theme, 64) {
            return Err("invalid-theme-id".into());
        }
        self.style.validate()?;
        crate::style::validate_kind_styles(&self.kind_styles)?;
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
    if version <= 1 {
        blur_v1_to_v2(&mut json);
    }
    let writable = version <= u64::from(VERSION);
    let has_onboarding = json.get("onboardingDone").is_some();
    let has_theme = json.get("theme").is_some();
    crate::style::sanitize(&mut json);
    let mut settings: Settings = serde_json::from_value(json).unwrap_or_default();
    if !has_theme && version <= 1 {
        // Upgraded 1.x users keep the Classic 1.1 look so nobody is forced into the new design.
        settings.theme = CLASSIC_THEME.to_owned();
    }
    if !has_onboarding && !settings.widgets.is_empty() {
        // Upgraded from Phase 4/5 where widgets were already configured.
        settings.onboarding_done = true;
    }
    settings.schema = Some(SCHEMA_URL.to_owned());
    settings.version = VERSION;
    if settings.validate().is_err() {
        tracing::warn!("stored settings failed validation; using defaults for this run");
        return (Settings::default(), false);
    }
    (settings, writable)
}

/// v1 → v2: `blur` was extra blur on top of the fixed 1.x glass (0 … 100); on the 2.0 scale 0 is
/// sharp and 60 is the 1.x look (ADR 0012), so old values move to 60 + 0.4 × old.
fn blur_v1_to_v2(json: &mut serde_json::Value) {
    fn fix(style: Option<&mut serde_json::Value>) {
        // Out-of-range values are left for `sanitize` to drop, not moved into range.
        if let Some(blur) = style.and_then(|s| s.get_mut("blur"))
            && let Some(old) = blur.as_f64().filter(|v| (0.0..=100.0).contains(v))
        {
            *blur = serde_json::json!(60.0 + 0.4 * old);
        }
    }
    fix(json.get_mut("style"));
    if let Some(serde_json::Value::Object(named)) = json.get_mut("styles") {
        for style in named.values_mut() {
            fix(Some(style));
        }
    }
    if let Some(serde_json::Value::Object(widgets)) = json.get_mut("widgets") {
        for widget in widgets.values_mut() {
            fix(widget.get_mut("style"));
        }
    }
    if let Some(obj) = json.as_object_mut() {
        obj.insert("version".into(), serde_json::json!(2));
    }
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
    let mut stamped = settings.clone();
    stamped.schema = Some(SCHEMA_URL.to_owned());
    let bytes = serde_json::to_vec_pretty(&stamped).map_err(|e| e.to_string())?;
    crate::watcher::write_atomic_tracked(&path, &bytes).map_err(|e| e.to_string())
}

/// Serializes settings changes: each one reads the current settings, saves, and publishes as one
/// step, so two overlapping patches can't both start from the same old state and lose one.
static UPDATE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Applies a patch from a command: validates, saves, and publishes the new settings.
pub async fn update(hub: &Arc<Hub>, patch: serde_json::Value) -> Result<(), String> {
    let _serial = UPDATE_LOCK.lock().await;
    let prev_theme = hub.settings().theme.clone();
    let next = patched(&hub.settings(), &patch)?;
    if !hub.settings_writable() {
        return Err("settings-file-is-newer".into());
    }
    let theme_changed = next.theme != prev_theme;
    let to_save = next.clone();
    tokio::task::spawn_blocking(move || save(&to_save))
        .await
        .map_err(|e| e.to_string())??;
    hub.set_settings(next);
    if theme_changed {
        let hub_bg = hub.clone();
        let _ = tokio::task::spawn_blocking(move || {
            crate::watcher::refresh_themes_and_css(&hub_bg, Vec::new());
        })
        .await;
    }
    Ok(())
}

/// Replaces the entire settings object (used by backup import and reset-to-defaults).
pub async fn replace(hub: &Arc<Hub>, raw: serde_json::Value) -> Result<(), String> {
    let _serial = UPDATE_LOCK.lock().await;
    let prev_theme = hub.settings().theme.clone();
    let next: Settings =
        serde_json::from_value(raw).map_err(|e| format!("invalid-settings: {e}"))?;
    if next.version != VERSION {
        return Err("version-is-read-only".into());
    }
    next.validate()?;
    if !hub.settings_writable() {
        return Err("settings-file-is-newer".into());
    }
    let theme_changed = next.theme != prev_theme;
    let to_save = next.clone();
    tokio::task::spawn_blocking(move || save(&to_save))
        .await
        .map_err(|e| e.to_string())??;
    hub.set_settings(next);
    if theme_changed {
        let hub_bg = hub.clone();
        let _ = tokio::task::spawn_blocking(move || {
            crate::watcher::refresh_themes_and_css(&hub_bg, Vec::new());
        })
        .await;
    }
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
            patched(&s, &json!({"version": 3})),
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
    fn v1_blur_moves_to_the_2_0_scale() {
        let (s, writable) = migrate(json!({
            "version": 1,
            "style": {"blur": 50},
            "styles": {"Night": {"blur": 0}},
            "widgets": {"w1": {"kind": "cpu", "style": {"blur": 100}}, "w2": {"kind": "clock"}}
        }));
        assert!(writable);
        assert_eq!(s.version, VERSION);
        assert_eq!(s.style.blur, Some(80.0));
        assert_eq!(s.styles.get("Night").and_then(|n| n.blur), Some(60.0));
        assert_eq!(s.widgets.get("w1").and_then(|w| w.style.blur), Some(100.0));
        assert_eq!(s.widgets.get("w2").and_then(|w| w.style.blur), None);
        // A v2 file is left alone.
        let (s, _) = migrate(json!({"version": 2, "style": {"blur": 10}}));
        assert_eq!(s.style.blur, Some(10.0));
    }

    #[test]
    fn desktop_look_is_validated() {
        let s = Settings::default();
        assert_eq!(s.appearance.look, DesktopLook::Glass);
        assert_eq!(s.appearance.master_transparency, 50);
        let next = patched(
            &s,
            &json!({"appearance": {"look": "tinted", "lookColor": "#3366cc"}}),
        )
        .unwrap();
        assert_eq!(next.appearance.look, DesktopLook::Tinted);
        assert_eq!(
            patched(&s, &json!({"appearance": {"masterTransparency": 101}})),
            Err("master-transparency-out-of-range".into())
        );
        assert_eq!(
            patched(&s, &json!({"appearance": {"lookColor": "blue"}})),
            Err("look-color-not-hex".into())
        );
        assert!(patched(&s, &json!({"appearance": {"look": "neon"}})).is_err());
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

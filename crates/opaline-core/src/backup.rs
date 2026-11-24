//! Export and import of Opaline settings and layouts as one versioned JSON document (brief §5.5).

use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::hub::Hub;
use crate::layouts::Layouts;
use crate::store::Settings;

pub const VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupBundle {
    pub version: u32,
    pub opaline_version: String,
    pub exported_at: String,
    pub settings: Settings,
    pub layouts: Layouts,
}

/// Builds a pretty-printed JSON backup of the current settings and per-monitor layouts.
pub fn export_json(hub: &Hub) -> Result<String, String> {
    let bundle = BackupBundle {
        version: VERSION,
        opaline_version: env!("CARGO_PKG_VERSION").to_owned(),
        exported_at: chrono::Utc::now().to_rfc3339(),
        settings: (*hub.settings()).clone(),
        layouts: (*hub.layouts()).clone(),
    };
    serde_json::to_string_pretty(&bundle).map_err(|e| e.to_string())
}

/// Parses and validates a backup JSON string without writing anything yet.
pub fn parse_and_validate(raw: &str) -> Result<(Settings, Layouts), String> {
    let value: serde_json::Value =
        serde_json::from_str(raw).map_err(|e| format!("invalid-json: {e}"))?;
    let version = value
        .get("version")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| "missing-backup-version".to_owned())?;
    if version == 0 || version > u64::from(VERSION) {
        return Err(format!("unsupported-backup-version: {version}"));
    }
    let settings_val = value
        .get("settings")
        .cloned()
        .ok_or_else(|| "missing-settings".to_owned())?;
    let layouts_val = value
        .get("layouts")
        .cloned()
        .ok_or_else(|| "missing-layouts".to_owned())?;

    let (settings, settings_ok) = crate::store::migrate(settings_val);
    if !settings_ok {
        return Err("settings-newer-or-invalid".to_owned());
    }
    settings.validate()?;

    let layouts: Layouts =
        serde_json::from_value(layouts_val).map_err(|e| format!("invalid-layouts: {e}"))?;
    layouts.validate()?;

    Ok((settings, layouts))
}

/// Validates and applies an imported backup JSON bundle, saving both files atomically and
/// publishing them to the hub.
pub async fn import_json(hub: &Arc<Hub>, raw: &str) -> Result<(), String> {
    let (settings, layouts) = parse_and_validate(raw)?;
    let settings_val = serde_json::to_value(&settings).map_err(|e| e.to_string())?;
    let layouts_val = serde_json::to_value(&layouts).map_err(|e| e.to_string())?;
    crate::store::replace(hub, settings_val).await?;
    crate::layouts::update(hub, layouts_val).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use opaline_ipc::BackendKind;

    use super::*;

    #[test]
    fn export_and_parse_round_trip() {
        let hub = Hub::new(BackendKind::Instant, Vec::new());
        let json = export_json(&hub).unwrap();
        let (settings, layouts) = parse_and_validate(&json).unwrap();
        assert_eq!(settings, *hub.settings());
        assert_eq!(layouts, *hub.layouts());
    }

    #[test]
    fn rejects_invalid_or_future_backups() {
        assert!(parse_and_validate("not json").is_err());
        assert!(parse_and_validate(r#"{"version": 99, "settings": {}, "layouts": {}}"#).is_err());
        assert!(parse_and_validate(r#"{"version": 1, "settings": {}}"#).is_err());
        assert!(
            parse_and_validate(
                r#"{"version": 1, "settings": {"version": 1, "network": {"billingDay": 99}}, "layouts": {"version": 1, "monitors": {}}}"#
            )
            .is_err()
        );
    }
}

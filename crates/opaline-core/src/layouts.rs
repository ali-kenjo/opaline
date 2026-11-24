//! Per-monitor layouts: `~/.config/opaline/layouts.json`, versioned, validated and written
//! atomically by core (ARCHITECTURE §3.6, brief §5.5).

use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::hub::Hub;

pub const VERSION: u32 = 1;
pub const TOPIC: &str = "layouts";

const MAX_MONITORS: usize = 16;
const MAX_ITEMS_PER_MONITOR: usize = 64;
const MAX_STACK_CHILDREN: usize = 12;
const MAX_GRID_COORD: u32 = 64;
const MAX_GRID_SPAN: u32 = 16;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Layouts {
    pub version: u32,
    /// When a saved monitor is disconnected, show its waiting widgets on the primary display.
    pub show_missing_on_primary: bool,
    pub monitors: BTreeMap<String, MonitorLayout>,
}

impl Default for Layouts {
    fn default() -> Self {
        Self {
            version: VERSION,
            show_missing_on_primary: false,
            monitors: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct MonitorLayout {
    pub items: Vec<LayoutItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum LayoutItem {
    #[serde(rename_all = "camelCase")]
    Widget {
        id: String,
        kind: String,
        x: u32,
        y: u32,
        w: u32,
        h: u32,
    },
    #[serde(rename_all = "camelCase")]
    Stack {
        id: String,
        x: u32,
        y: u32,
        w: u32,
        h: u32,
        children: Vec<String>,
        #[serde(default)]
        active_index: usize,
        #[serde(default)]
        smart_rotate: bool,
    },
}

impl LayoutItem {
    pub fn id(&self) -> &str {
        match self {
            Self::Widget { id, .. } | Self::Stack { id, .. } => id,
        }
    }

    pub fn rect(&self) -> (u32, u32, u32, u32) {
        match self {
            Self::Widget { x, y, w, h, .. } | Self::Stack { x, y, w, h, .. } => (*x, *y, *w, *h),
        }
    }
}

fn rects_overlap(a: (u32, u32, u32, u32), b: (u32, u32, u32, u32)) -> bool {
    a.0 < b.0.saturating_add(b.2)
        && b.0 < a.0.saturating_add(a.2)
        && a.1 < b.1.saturating_add(b.3)
        && b.1 < a.1.saturating_add(a.3)
}

impl Layouts {
    /// Checks structural invariants (bounds, spans, unique IDs, no overlaps, non-empty stacks).
    pub fn validate(&self) -> Result<(), String> {
        if self.version != VERSION {
            return Err("version-is-read-only".into());
        }
        if self.monitors.len() > MAX_MONITORS {
            return Err("too-many-monitors".into());
        }
        for (key, mon) in &self.monitors {
            if key.is_empty() || key.len() > 160 {
                return Err("invalid-monitor-key".into());
            }
            if mon.items.len() > MAX_ITEMS_PER_MONITOR {
                return Err("too-many-items".into());
            }
            let mut ids = HashSet::new();
            let mut rects = Vec::with_capacity(mon.items.len());
            for item in &mon.items {
                let id = item.id();
                if id.is_empty() || id.len() > 64 || !ids.insert(id) {
                    return Err("invalid-item-id".into());
                }
                let (x, y, w, h) = item.rect();
                if x > MAX_GRID_COORD
                    || y > MAX_GRID_COORD
                    || !(1..=MAX_GRID_SPAN).contains(&w)
                    || !(1..=MAX_GRID_SPAN).contains(&h)
                {
                    return Err("item-out-of-bounds".into());
                }
                match item {
                    LayoutItem::Widget { kind, .. } => {
                        if kind.is_empty() || kind.len() > 32 {
                            return Err("invalid-widget-kind".into());
                        }
                    }
                    LayoutItem::Stack { children, .. } => {
                        if children.is_empty() || children.len() > MAX_STACK_CHILDREN {
                            return Err("invalid-stack-children".into());
                        }
                        let mut cids = HashSet::new();
                        for c in children {
                            if c.is_empty() || c.len() > 64 || !cids.insert(c.as_str()) {
                                return Err("invalid-stack-child-id".into());
                            }
                        }
                    }
                }
                if rects
                    .iter()
                    .any(|&other| rects_overlap(other, (x, y, w, h)))
                {
                    return Err("overlapping-items".into());
                }
                rects.push((x, y, w, h));
            }
        }
        Ok(())
    }
}

/// Upgrades a stored file to the current version. Files from newer builds are kept read-only.
pub fn migrate(mut json: serde_json::Value) -> (Layouts, bool) {
    let version = json
        .get("version")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    if version == 0
        && let Some(obj) = json.as_object_mut()
    {
        obj.insert("version".into(), serde_json::json!(VERSION));
    }
    let writable = version <= u64::from(VERSION);
    let mut layouts: Layouts = serde_json::from_value(json).unwrap_or_default();
    layouts.version = VERSION;
    if layouts.validate().is_err() {
        tracing::warn!("stored layouts failed validation; using empty layouts for this run");
        return (Layouts::default(), false);
    }
    (layouts, writable)
}

fn path() -> Option<PathBuf> {
    crate::paths::config_dir()
        .ok()
        .map(|d| d.join("layouts.json"))
}

/// Loads layouts (empty defaults if missing) and whether this build may overwrite the file.
pub fn load() -> (Layouts, bool) {
    let Some(text) = path().and_then(|p| std::fs::read_to_string(p).ok()) else {
        return (Layouts::default(), true);
    };
    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(json) => migrate(json),
        Err(error) => {
            tracing::warn!(%error, "layouts.json is not valid JSON; using empty layouts, keeping the file");
            (Layouts::default(), false)
        }
    }
}

fn save(layouts: &Layouts) -> Result<(), String> {
    let path = path().ok_or("no-config-dir")?;
    let bytes = serde_json::to_vec_pretty(layouts).map_err(|e| e.to_string())?;
    crate::paths::write_atomic(&path, &bytes).map_err(|e| e.to_string())
}

/// Replaces and saves layouts from a validated layer command, then publishes `layouts`.
pub async fn update(hub: &Arc<Hub>, raw: serde_json::Value) -> Result<(), String> {
    let mut next: Layouts =
        serde_json::from_value(raw).map_err(|e| format!("invalid-layouts: {e}"))?;
    if next.version == 0 {
        next.version = VERSION;
    }
    next.validate()?;
    if !hub.layouts_writable() {
        return Err("layouts-file-is-newer".into());
    }
    let to_save = next.clone();
    tokio::task::spawn_blocking(move || save(&to_save))
        .await
        .map_err(|e| e.to_string())??;
    hub.set_layouts(next);
    Ok(())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use serde_json::json;

    use super::*;

    #[test]
    fn validates_non_overlapping_widgets_and_stacks() {
        let ok: Layouts = serde_json::from_value(json!({
            "version": 1,
            "monitors": {
                "AUO-0x82ed-0x00000000:eDP-1": {
                    "items": [
                        {"id": "w1", "type": "widget", "kind": "clock", "x": 0, "y": 0, "w": 4, "h": 2},
                        {"id": "s1", "type": "stack", "x": 4, "y": 0, "w": 2, "h": 2, "children": ["w2", "w3"], "smartRotate": true}
                    ]
                }
            }
        }))
        .unwrap();
        assert!(ok.validate().is_ok());

        let overlap: Layouts = serde_json::from_value(json!({
            "version": 1,
            "monitors": {
                "k:eDP-1": {
                    "items": [
                        {"id": "w1", "type": "widget", "kind": "clock", "x": 0, "y": 0, "w": 4, "h": 2},
                        {"id": "w2", "type": "widget", "kind": "cpu", "x": 3, "y": 1, "w": 2, "h": 2}
                    ]
                }
            }
        }))
        .unwrap();
        assert_eq!(overlap.validate(), Err("overlapping-items".into()));

        let empty_stack: Layouts = serde_json::from_value(json!({
            "version": 1,
            "monitors": {
                "k:eDP-1": {
                    "items": [
                        {"id": "s1", "type": "stack", "x": 0, "y": 0, "w": 2, "h": 2, "children": []}
                    ]
                }
            }
        }))
        .unwrap();
        assert_eq!(empty_stack.validate(), Err("invalid-stack-children".into()));
    }

    #[test]
    fn migrates_and_protects_newer_versions() {
        let (l, writable) = migrate(json!({"monitors": {}}));
        assert_eq!(l.version, VERSION);
        assert!(writable);

        let (_, writable) = migrate(json!({"version": 99, "monitors": {}}));
        assert!(!writable);
    }

    #[test]
    fn ipc_value_round_trip_deserializes_integers() {
        let raw = json!({
            "version": 1,
            "showMissingOnPrimary": false,
            "monitors": {
                "AUO:eDP-1": {
                    "items": [
                        {"id": "a-clock", "type": "widget", "kind": "clock", "x": 11, "y": 0, "w": 4, "h": 2}
                    ]
                }
            }
        });
        let via_ipc = crate::json::patch_to_json(&crate::json::from_json(&raw));
        let parsed: Layouts = serde_json::from_value(via_ipc).unwrap();
        assert!(parsed.validate().is_ok());
        assert_eq!(parsed.monitors["AUO:eDP-1"].items.len(), 1);
    }
}

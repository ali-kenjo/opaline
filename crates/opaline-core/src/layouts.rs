//! Per-monitor layouts: `~/.config/opaline/layouts.json`, versioned, validated and written
//! atomically by core (ARCHITECTURE §3.6, brief §5.5).

use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::hub::Hub;

pub const VERSION: u32 = 1;
pub const TOPIC: &str = "layouts";
pub const SCHEMA_URL: &str = "file:///usr/share/opaline/schemas/layouts.schema.json";

const MAX_MONITORS: usize = 16;
const MAX_ITEMS_PER_MONITOR: usize = 64;
const MAX_STACK_CHILDREN: usize = 12;
const MAX_SMART_RULES: usize = 16;
const MAX_GRID_COORD: u32 = 64;
const MAX_GRID_SPAN: u32 = 16;
const MIN_FREE_SIZE: u32 = 64;
const MAX_FREE_SIZE: u32 = 4096;
const MAX_FREE_OFFSET: i32 = 8192;
const ALLOWED_CELL_SIZES: &[u32] = &[72, 84, 96, 112];

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum LayoutMode {
    #[default]
    Grid,
    Free,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum FreeAnchor {
    #[default]
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
    Center,
}

/// Work-area-anchored pixel placement for Free mode (brief §7): stays coherent across
/// resolution, scale, and monitor changes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FreeRect {
    #[serde(default)]
    pub anchor: FreeAnchor,
    pub offset_x: i32,
    pub offset_y: i32,
    pub width: u32,
    pub height: u32,
}

/// Custom expression rule for Smart Rotate inside a widget stack (brief §6.2).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SmartStackRule {
    pub child_id: String,
    pub when: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct Layouts {
    #[serde(rename = "$schema", skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    pub version: u32,
    /// When a saved monitor is disconnected, show its waiting widgets on the primary display.
    pub show_missing_on_primary: bool,
    pub monitors: BTreeMap<String, MonitorLayout>,
}

impl Default for Layouts {
    fn default() -> Self {
        Self {
            schema: Some(SCHEMA_URL.to_owned()),
            version: VERSION,
            show_missing_on_primary: false,
            monitors: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct MonitorLayout {
    #[serde(default, skip_serializing_if = "is_grid_mode")]
    pub mode: LayoutMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cell_size: Option<u32>,
    pub items: Vec<LayoutItem>,
}

fn is_grid_mode(mode: &LayoutMode) -> bool {
    *mode == LayoutMode::Grid
}

fn is_zero_i32(v: &i32) -> bool {
    *v == 0
}

fn is_false(v: &bool) -> bool {
    !*v
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
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
        #[serde(default, skip_serializing_if = "Option::is_none")]
        free: Option<FreeRect>,
        #[serde(default, skip_serializing_if = "is_zero_i32")]
        z: i32,
        #[serde(default, skip_serializing_if = "is_false")]
        locked: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        group_id: Option<String>,
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
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        smart_rules: Vec<SmartStackRule>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        free: Option<FreeRect>,
        #[serde(default, skip_serializing_if = "is_zero_i32")]
        z: i32,
        #[serde(default, skip_serializing_if = "is_false")]
        locked: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        group_id: Option<String>,
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

    pub fn free_rect(&self) -> Option<FreeRect> {
        match self {
            Self::Widget { free, .. } | Self::Stack { free, .. } => *free,
        }
    }

    pub fn z(&self) -> i32 {
        match self {
            Self::Widget { z, .. } | Self::Stack { z, .. } => *z,
        }
    }

    pub fn group_id(&self) -> Option<&str> {
        match self {
            Self::Widget { group_id, .. } | Self::Stack { group_id, .. } => group_id.as_deref(),
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
    /// The JSON Schema of `layouts.json` (`spec/layouts.schema.json`).
    pub fn schema() -> serde_json::Value {
        serde_json::Value::from(schemars::schema_for!(Layouts))
    }

    /// Checks structural invariants (bounds, spans, unique IDs, no grid overlaps, non-empty stacks,
    /// valid Free-mode anchors/bounds, z-order, groups, and Smart Stack rules).
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
            if let Some(cs) = mon.cell_size
                && !ALLOWED_CELL_SIZES.contains(&cs)
            {
                return Err("invalid-cell-size".into());
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
                if !(-1000..=1000).contains(&item.z()) {
                    return Err("invalid-z-order".into());
                }
                if let Some(gid) = item.group_id()
                    && (gid.is_empty() || gid.len() > 64)
                {
                    return Err("invalid-group-id".into());
                }
                if let Some(fr) = item.free_rect()
                    && (!(MIN_FREE_SIZE..=MAX_FREE_SIZE).contains(&fr.width)
                        || !(MIN_FREE_SIZE..=MAX_FREE_SIZE).contains(&fr.height)
                        || !(-MAX_FREE_OFFSET..=MAX_FREE_OFFSET).contains(&fr.offset_x)
                        || !(-MAX_FREE_OFFSET..=MAX_FREE_OFFSET).contains(&fr.offset_y))
                {
                    return Err("free-rect-out-of-bounds".into());
                }
                match item {
                    LayoutItem::Widget { kind, .. } => {
                        if kind.is_empty() || kind.len() > 32 {
                            return Err("invalid-widget-kind".into());
                        }
                    }
                    LayoutItem::Stack {
                        children,
                        smart_rules,
                        ..
                    } => {
                        if children.is_empty() || children.len() > MAX_STACK_CHILDREN {
                            return Err("invalid-stack-children".into());
                        }
                        let mut cids = HashSet::new();
                        for c in children {
                            if c.is_empty() || c.len() > 64 || !cids.insert(c.as_str()) {
                                return Err("invalid-stack-child-id".into());
                            }
                        }
                        if smart_rules.len() > MAX_SMART_RULES {
                            return Err("too-many-smart-rules".into());
                        }
                        for rule in smart_rules {
                            if !cids.contains(rule.child_id.as_str())
                                || rule.when.trim().is_empty()
                                || rule.when.len() > 512
                            {
                                return Err("invalid-smart-rule".into());
                            }
                        }
                    }
                }
                if mon.mode == LayoutMode::Grid
                    && rects
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
    let mut stamped = layouts.clone();
    stamped.schema = Some(SCHEMA_URL.to_owned());
    let bytes = serde_json::to_vec_pretty(&stamped).map_err(|e| e.to_string())?;
    crate::watcher::write_atomic_tracked(&path, &bytes).map_err(|e| e.to_string())
}

/// Serializes layout changes so the saved file and the published topic always end on the same
/// version (two overlapping saves could otherwise finish in the opposite order).
static UPDATE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Replaces and saves layouts from a validated layer command, then publishes `layouts`.
pub async fn update(hub: &Arc<Hub>, raw: serde_json::Value) -> Result<(), String> {
    let _serial = UPDATE_LOCK.lock().await;
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

    #[test]
    fn free_mode_allows_overlap_and_validates_anchors_and_smart_rules() {
        let ok: Layouts = serde_json::from_value(json!({
            "version": 1,
            "monitors": {
                "AUO:eDP-1": {
                    "mode": "free",
                    "cellSize": 96,
                    "items": [
                        {
                            "id": "w1",
                            "type": "widget",
                            "kind": "clock",
                            "x": 0, "y": 0, "w": 4, "h": 2,
                            "free": { "anchor": "top-right", "offsetX": 24, "offsetY": 24, "width": 372, "height": 180 },
                            "z": 2,
                            "locked": true,
                            "groupId": "g-top"
                        },
                        {
                            "id": "s1",
                            "type": "stack",
                            "x": 0, "y": 0, "w": 2, "h": 2,
                            "children": ["w2", "w3"],
                            "smartRotate": true,
                            "smartRules": [
                                { "childId": "w2", "when": "power.battery.percent <= 20", "label": "Low battery" }
                            ],
                            "free": { "anchor": "bottom-left", "offsetX": 32, "offsetY": 32, "width": 200, "height": 200 },
                            "z": 1
                        }
                    ]
                }
            }
        }))
        .unwrap();
        assert_eq!(ok.validate(), Ok(()));

        let bad_cell: Layouts = serde_json::from_value(json!({
            "version": 1,
            "monitors": { "k": { "cellSize": 50, "items": [] } }
        }))
        .unwrap();
        assert_eq!(bad_cell.validate(), Err("invalid-cell-size".into()));

        let bad_rule: Layouts = serde_json::from_value(json!({
            "version": 1,
            "monitors": {
                "k": {
                    "items": [
                        {
                            "id": "s1", "type": "stack", "x": 0, "y": 0, "w": 2, "h": 2,
                            "children": ["w2"],
                            "smartRules": [{ "childId": "missing", "when": "true" }]
                        }
                    ]
                }
            }
        }))
        .unwrap();
        assert_eq!(bad_rule.validate(), Err("invalid-smart-rule".into()));
    }
}

//! "Save this look" theme export and shareable Rices (brief §5.2, PLAN-2 task 3.7).
//!
//! - **Save this look (`export_theme_zip`)**: exports the user's active theme + global & per-kind
//!   style overrides + active CSS into a `.opaline-theme` ZIP package with all personal data and
//!   secrets stripped.
//! - **Rices (`RiceBundle`, `export_rice_zip`, `import_rice_zip`)**: packages a theme together with
//!   work-area-anchored widget layouts, custom widgets, custom source definitions (always marked
//!   untrusted/disabled on import until approved), and profiles.

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::hub::Hub;
use crate::layouts::{LayoutItem, Layouts, MonitorLayout};
use crate::store::Settings;
use crate::style::{Style, WidgetConfig, id_ok};
use crate::themes::{SCHEMA_VERSION as THEME_SCHEMA_VERSION, ThemePackage, ThemeTokens};
use crate::zip_pkg::{read_zip, write_zip};

pub const RICE_VERSION: u32 = 1;
pub const RICE_SCHEMA_URL: &str = "file:///usr/share/opaline/schemas/rice.schema.json";

/// Metadata supplied by the user when exporting a theme or rice.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExportMeta {
    pub id: String,
    pub name: String,
    pub author: String,
    pub version: String,
    pub license: String,
    pub description: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum AnchorCorner {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
    Center,
}

/// Work-area-anchored layout item so a shared rice adapts across monitor resolutions and scales.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AnchoredItem {
    pub id: String,
    pub kind: String,
    pub anchor: AnchorCorner,
    /// Horizontal offset from `anchor` as a fraction of the grid width (0.0 … 1.0).
    pub dx_ratio: f64,
    /// Vertical offset from `anchor` as a fraction of the grid height (0.0 … 1.0).
    pub dy_ratio: f64,
    /// Span in grid cells.
    pub w: u32,
    pub h: u32,
}

/// Custom data source entry in a rice; always imported with `approved = false` (brief §4.5).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RiceSourceRef {
    pub id: String,
    pub kind: String,
    /// Definition payload with secret values stripped.
    pub spec: serde_json::Value,
    /// Always forced to `false` on import until the user explicitly approves it.
    #[serde(default)]
    pub approved: bool,
}

/// A complete shareable desktop setup (theme + anchored layout + widgets + sources + profiles).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RiceBundle {
    #[serde(rename = "$schema", skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    pub version: u32,
    pub opaline_version: String,
    pub theme: ThemePackage,
    /// Anchored layout items for the primary monitor (and optional secondary monitors).
    #[serde(default)]
    pub monitors: Vec<Vec<AnchoredItem>>,
    /// Per-widget styles and non-secret content options (locations, calendars, IPs stripped).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub widgets: BTreeMap<String, WidgetConfig>,
    /// Optional custom widget compositions.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub custom_widgets: BTreeMap<String, opaline_compose::Composition>,
    /// Optional custom source definitions (disabled until user approval).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sources: Vec<RiceSourceRef>,
    /// Optional profile definitions (P8).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub profiles: Vec<serde_json::Value>,
}

impl RiceBundle {
    /// JSON Schema for `rice.json` (`spec/rice.schema.json`).
    pub fn schema() -> serde_json::Value {
        serde_json::Value::from(schemars::schema_for!(RiceBundle))
    }
}

/// Content keys that may carry personal data or secrets and must be stripped on export.
const SECRET_CONTENT_KEYS: [&str; 10] = [
    "token",
    "apiKey",
    "api_key",
    "password",
    "secret",
    "location",
    "latitude",
    "longitude",
    "subscriptions",
    "publicIp",
];

fn strip_widget_secrets(cfg: &WidgetConfig) -> WidgetConfig {
    let mut clean_content = serde_json::Map::new();
    for (k, v) in &cfg.content {
        let lower = k.to_ascii_lowercase();
        let sensitive = SECRET_CONTENT_KEYS
            .iter()
            .any(|s| lower.contains(&s.to_ascii_lowercase()));
        if !sensitive {
            clean_content.insert(k.clone(), v.clone());
        }
    }
    WidgetConfig {
        kind: cfg.kind.clone(),
        style: cfg.style.clone(),
        elements: cfg.elements.clone(),
        content: clean_content,
    }
}

fn validate_meta(meta: &ExportMeta) -> Result<(), String> {
    if !id_ok(&meta.id, 64) {
        return Err("invalid-export-id".into());
    }
    if meta.name.trim().is_empty() || meta.name.chars().count() > 80 {
        return Err("invalid-export-name".into());
    }
    Ok(())
}

/// Builds a [`ThemePackage`] from the current settings (merging global + per-kind styles) with no
/// personal data or secrets.
pub fn build_look_theme(
    settings: &Settings,
    active_tokens: Option<ThemeTokens>,
    meta: &ExportMeta,
    has_css: bool,
) -> Result<ThemePackage, String> {
    validate_meta(meta)?;
    let mut kinds: BTreeMap<String, Style> = settings.kind_styles.clone();
    // Preserve per-kind styles; never include instance IDs or personal content.
    kinds.retain(|k, _| id_ok(k, 32));
    Ok(ThemePackage {
        schema: Some(crate::themes::SCHEMA_URL.to_owned()),
        schema_version: THEME_SCHEMA_VERSION,
        id: meta.id.clone(),
        name: meta.name.trim().to_owned(),
        author: meta.author.trim().to_owned(),
        version: if meta.version.trim().is_empty() {
            "1.0.0".into()
        } else {
            meta.version.trim().to_owned()
        },
        license: if meta.license.trim().is_empty() {
            "CC-BY-4.0".into()
        } else {
            meta.license.trim().to_owned()
        },
        description: meta.description.trim().to_owned(),
        previews: Vec::new(),
        min_opaline_version: Some(env!("CARGO_PKG_VERSION").to_owned()),
        tokens: active_tokens.unwrap_or_default(),
        style: settings.style.clone(),
        kinds,
        elements: BTreeMap::new(),
        layouts: BTreeMap::new(),
        fonts: Vec::new(),
        images: Vec::new(),
        css: has_css.then(|| "theme.css".to_owned()),
    })
}

/// Exports the current look as a `.opaline-theme` ZIP archive (secrets stripped).
pub fn export_theme_zip(
    settings: &Settings,
    active_tokens: Option<ThemeTokens>,
    theme_css: Option<&str>,
    meta: &ExportMeta,
) -> Result<Vec<u8>, String> {
    let clean_css = match theme_css.filter(|s| !s.trim().is_empty()) {
        Some(raw) => Some(
            crate::css::validate_css("theme.css", raw)
                .map_err(|_| "theme-css-invalid".to_owned())?,
        ),
        None => None,
    };
    let pkg = build_look_theme(settings, active_tokens, meta, clean_css.is_some())?;
    let manifest = serde_json::to_vec_pretty(&pkg).map_err(|e| e.to_string())?;
    let mut files = BTreeMap::new();
    files.insert("theme.json".to_owned(), manifest);
    if let Some(css) = clean_css {
        files.insert("theme.css".to_owned(), css.into_bytes());
    }
    write_zip(&files)
}

/// Converts grid coordinates on a monitor of `(cols, rows)` into work-area-anchored positions.
pub fn anchor_monitor_layout(mon: &MonitorLayout, cols: u32, rows: u32) -> Vec<AnchoredItem> {
    let cols = cols.max(1) as f64;
    let rows = rows.max(1) as f64;
    let mut out = Vec::new();
    for item in &mon.items {
        if let LayoutItem::Widget {
            id,
            kind,
            x,
            y,
            w,
            h,
            ..
        } = item
        {
            let cx = (*x as f64) + (*w as f64) * 0.5;
            let cy = (*y as f64) + (*h as f64) * 0.5;
            let right = cx > cols * 0.5;
            let bottom = cy > rows * 0.5;
            let anchor = match (right, bottom) {
                (false, false) => AnchorCorner::TopLeft,
                (true, false) => AnchorCorner::TopRight,
                (false, true) => AnchorCorner::BottomLeft,
                (true, true) => AnchorCorner::BottomRight,
            };
            let dx_ratio = if right {
                ((cols - (*x + *w) as f64) / cols).clamp(0.0, 1.0)
            } else {
                (*x as f64 / cols).clamp(0.0, 1.0)
            };
            let dy_ratio = if bottom {
                ((rows - (*y + *h) as f64) / rows).clamp(0.0, 1.0)
            } else {
                (*y as f64 / rows).clamp(0.0, 1.0)
            };
            out.push(AnchoredItem {
                id: id.clone(),
                kind: kind.clone(),
                anchor,
                dx_ratio,
                dy_ratio,
                w: *w,
                h: *h,
            });
        }
    }
    out
}

/// Resolves anchored items back onto a target monitor grid of `(cols, rows)`.
pub fn materialize_anchored_layout(items: &[AnchoredItem], cols: u32, rows: u32) -> MonitorLayout {
    let mut out = Vec::with_capacity(items.len());
    let max_c = cols.max(1);
    let max_r = rows.max(1);
    for it in items {
        let w = it.w.clamp(1, max_c);
        let h = it.h.clamp(1, max_r);
        let dx = (it.dx_ratio.clamp(0.0, 1.0) * max_c as f64).round() as u32;
        let dy = (it.dy_ratio.clamp(0.0, 1.0) * max_r as f64).round() as u32;
        let (x, y) = match it.anchor {
            AnchorCorner::TopLeft => (dx.min(max_c - w), dy.min(max_r - h)),
            AnchorCorner::TopRight => (max_c.saturating_sub(w + dx), dy.min(max_r - h)),
            AnchorCorner::BottomLeft => (dx.min(max_c - w), max_r.saturating_sub(h + dy)),
            AnchorCorner::BottomRight => {
                (max_c.saturating_sub(w + dx), max_r.saturating_sub(h + dy))
            }
            AnchorCorner::Center => ((max_c - w) / 2, (max_r - h) / 2),
        };
        out.push(LayoutItem::Widget {
            id: it.id.clone(),
            kind: it.kind.clone(),
            x,
            y,
            w,
            h,
            free: None,
            z: 0,
            locked: false,
            group_id: None,
        });
    }
    MonitorLayout {
        items: out,
        ..MonitorLayout::default()
    }
}

/// Exports the full desktop setup as a `.opaline-rice` ZIP archive (secrets stripped).
pub fn export_rice_zip(
    hub: &Hub,
    meta: &ExportMeta,
    theme_css: Option<&str>,
    grid_dims: (u32, u32),
) -> Result<Vec<u8>, String> {
    let settings = hub.settings();
    let layouts: Layouts = (*hub.layouts()).clone();
    let clean_css = match theme_css.filter(|s| !s.trim().is_empty()) {
        Some(raw) => Some(
            crate::css::validate_css("theme.css", raw)
                .map_err(|_| "theme-css-invalid".to_owned())?,
        ),
        None => None,
    };
    let theme = build_look_theme(&settings, None, meta, clean_css.is_some())?;
    let monitors: Vec<Vec<AnchoredItem>> = layouts
        .monitors
        .values()
        .map(|m| anchor_monitor_layout(m, grid_dims.0, grid_dims.1))
        .collect();
    let widgets: BTreeMap<String, WidgetConfig> = settings
        .widgets
        .iter()
        .map(|(id, cfg)| (id.clone(), strip_widget_secrets(cfg)))
        .collect();
    let bundle = RiceBundle {
        schema: Some(RICE_SCHEMA_URL.to_owned()),
        version: RICE_VERSION,
        opaline_version: env!("CARGO_PKG_VERSION").to_owned(),
        theme,
        monitors,
        widgets,
        custom_widgets: BTreeMap::new(),
        sources: Vec::new(),
        profiles: Vec::new(),
    };
    let mut files = BTreeMap::new();
    files.insert(
        "rice.json".to_owned(),
        serde_json::to_vec_pretty(&bundle).map_err(|e| e.to_string())?,
    );
    if let Some(css) = clean_css {
        files.insert("theme.css".to_owned(), css.into_bytes());
    }
    write_zip(&files)
}

/// Parses and validates a `.opaline-rice` ZIP archive; strips any untrusted approval flags on
/// imported sources so they always start disabled until the user explicitly approves them.
pub fn import_rice_zip(bytes: &[u8]) -> Result<(RiceBundle, String), String> {
    let files = read_zip(bytes)?;
    let raw = files
        .get("rice.json")
        .ok_or_else(|| "rice-missing-manifest".to_owned())?;
    let mut bundle: RiceBundle =
        serde_json::from_slice(raw).map_err(|e| format!("invalid-rice: {e}"))?;
    if bundle.version == 0 || bundle.version > RICE_VERSION {
        return Err(format!("unsupported-rice-version: {}", bundle.version));
    }
    if !id_ok(&bundle.theme.id, 64) {
        return Err("invalid-rice-theme-id".into());
    }
    bundle.theme.style.validate()?;
    crate::style::validate_kind_styles(&bundle.theme.kinds)?;
    crate::style::validate_widgets(&bundle.widgets, &BTreeMap::new())?;
    for (kind, comp) in &bundle.custom_widgets {
        if !id_ok(kind, 32) {
            return Err("invalid-custom-widget-kind".into());
        }
        let probs = opaline_compose::validate(comp);
        if !probs.is_empty() {
            return Err(format!("invalid-custom-widget-{kind}: {}", probs[0]));
        }
    }
    // Safety invariant (brief §4.5): imported sources are ALWAYS off until approved.
    for src in &mut bundle.sources {
        src.approved = false;
    }
    let css = if let Some(css_bytes) = files.get("theme.css") {
        let text = std::str::from_utf8(css_bytes).map_err(|_| "rice-css-not-utf8".to_owned())?;
        crate::css::validate_css("theme.css", text).map_err(|_| "rice-css-rejected".to_owned())?
    } else {
        String::new()
    };
    Ok((bundle, css))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::panic)]

    use opaline_ipc::BackendKind;
    use serde_json::json;

    use super::*;

    fn sample_meta() -> ExportMeta {
        ExportMeta {
            id: "my-look".into(),
            name: "My Look".into(),
            author: "Tester".into(),
            version: "1.0.0".into(),
            license: "CC-BY-4.0".into(),
            description: "Exported test look".into(),
        }
    }

    #[test]
    fn save_this_look_round_trips_as_theme_zip() {
        let mut settings = Settings::default();
        settings.style.blur = Some(20.0);
        settings.style.transparency = Some(85.0);
        settings.kind_styles.insert(
            "cpu".into(),
            Style {
                accent_color: Some("#f2903a".into()),
                ..Default::default()
            },
        );
        let zip = export_theme_zip(
            &settings,
            None,
            Some("[data-kind='cpu'] { letter-spacing: 0.01em; }"),
            &sample_meta(),
        )
        .unwrap();
        let loaded = crate::themes::load_theme_zip_bytes(
            "my-look.opaline-theme",
            &zip,
            crate::themes::ThemeSource::User,
            false,
        )
        .unwrap();
        assert_eq!(loaded.package.id, "my-look");
        assert_eq!(loaded.package.style.blur, Some(20.0));
        assert_eq!(
            loaded.package.kinds["cpu"].accent_color.as_deref(),
            Some("#f2903a")
        );
        assert!(loaded.css.contains("letter-spacing"));
    }

    #[test]
    fn rice_strips_secrets_anchors_positions_and_disables_imported_sources() {
        let hub = Hub::new(BackendKind::Instant, Vec::new());
        let mut settings = Settings::default();
        let mut content = serde_json::Map::new();
        content.insert("unit".into(), json!("C"));
        content.insert("apiKey".into(), json!("SUPER-SECRET-TOKEN"));
        content.insert("location".into(), json!({"name": "Home", "latitude": 52.5}));
        settings.widgets.insert(
            "w1".into(),
            WidgetConfig {
                kind: "weather".into(),
                style: Style {
                    blur: Some(15.0),
                    ..Default::default()
                },
                elements: BTreeMap::new(),
                content,
            },
        );
        hub.set_settings(settings);

        let mut layouts = Layouts::default();
        layouts.monitors.insert(
            "M1:eDP-1".into(),
            MonitorLayout {
                items: vec![LayoutItem::Widget {
                    id: "w1".into(),
                    kind: "weather".into(),
                    x: 12,
                    y: 0,
                    w: 4,
                    h: 2,
                    free: None,
                    z: 0,
                    locked: false,
                    group_id: None,
                }],
                ..MonitorLayout::default()
            },
        );
        hub.set_layouts(layouts);

        let zip = export_rice_zip(&hub, &sample_meta(), None, (16, 8)).unwrap();
        let (bundle, _css) = import_rice_zip(&zip).unwrap();
        let dumped = serde_json::to_string(&bundle).unwrap();
        assert!(!dumped.contains("SUPER-SECRET-TOKEN"), "secret leaked!");
        assert!(!dumped.contains("latitude"), "location leaked!");
        assert_eq!(bundle.widgets["w1"].content["unit"], json!("C"));
        assert_eq!(bundle.monitors[0][0].anchor, AnchorCorner::TopRight);

        // Materialize on a wider 20x10 screen: widget stays anchored to the top-right corner!
        let mat = materialize_anchored_layout(&bundle.monitors[0], 20, 10);
        if let LayoutItem::Widget { x, y, w, h, .. } = &mat.items[0] {
            assert_eq!((*x, *y, *w, *h), (16, 0, 4, 2));
        } else {
            panic!("expected widget");
        }
    }
}

//! Widget style and per-widget configuration (ADR 0011). Every field is optional: unset means
//! "inherit" (built-in default → global style → the widget's own style; the frontend resolves the
//! chain). Patches are strict (an invalid value is an error); loading is lenient (an invalid
//! field is dropped and the rest kept), so one bad value never resets the user's settings.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ColorSource {
    Wallpaper,
    Accent,
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Variant {
    TonalSpot,
    Vibrant,
    Expressive,
    Fidelity,
    Neutral,
    Monochrome,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Theme {
    Auto,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum HeroColor {
    /// The meaning ramp (thermal, load, health).
    Ramp,
    Accent,
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Surface {
    Glass,
    Tinted,
    Opaque,
    /// A solid custom color (`surfaceColor`), still with the chosen transparency.
    Color,
    /// Completely transparent / frameless: widget content floats directly on the wallpaper.
    Clear,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Density {
    Compact,
    Comfortable,
    Spacious,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MotionSpeed {
    Slow,
    Default,
    Fast,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AppearanceState {
    Full,
    Dimmed,
    Automatic,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Style {
    // Color
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_source: Option<ColorSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seed_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variant: Option<Variant>,
    /// −1 (reduced) … 0 (standard) … 1 (high).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contrast: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<Theme>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accent_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secondary_text_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hero_color: Option<HeroColor>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hero_custom_color: Option<String>,

    // Surface
    #[serde(skip_serializing_if = "Option::is_none")]
    pub surface: Option<Surface>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub surface_color: Option<String>,
    /// 0 (solid) … 100 (clearest glass).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transparency: Option<f64>,
    /// 0 … 100.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blur: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tint_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refraction: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rim: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grain: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shadow: Option<f64>,
    /// CSS px, 0 … 4.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_color: Option<String>,
    /// CSS px, 0 … 48; unset follows the size class (28 / 32).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub radius: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub density: Option<Density>,

    // Text
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number_font_family: Option<String>,
    /// 100 … 1000.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_weight: Option<f64>,
    /// Roboto Flex `wdth`, 25 … 151.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_width: Option<f64>,
    /// 0.75 … 1.5.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_scale: Option<f64>,
    /// em, −0.05 … 0.2.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub letter_spacing: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tabular_numbers: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub odometer: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_shadow: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uppercase_labels: Option<bool>,

    // Icons
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icons: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_fill: Option<bool>,
    /// 100 … 700.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_weight: Option<f64>,

    // Motion
    #[serde(skip_serializing_if = "Option::is_none")]
    pub animations: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub motion_speed: Option<MotionSpeed>,

    // State
    #[serde(skip_serializing_if = "Option::is_none")]
    pub appearance: Option<AppearanceState>,
    /// 0 … 100: how far Dimmed fades.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dim_level: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hover_lift: Option<bool>,
    /// Adaptive legibility (DESIGN.md §4); off shows a contrast warning instead.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub legibility: Option<bool>,
}

fn hex(c: &Option<String>) -> bool {
    c.as_deref().is_none_or(|s| {
        let b = s.as_bytes();
        (b.len() == 7 || b.len() == 9) && b[0] == b'#' && b[1..].iter().all(u8::is_ascii_hexdigit)
    })
}

fn range(v: Option<f64>, lo: f64, hi: f64) -> bool {
    v.is_none_or(|x| x.is_finite() && (lo..=hi).contains(&x))
}

/// A font family name as it goes into CSS: printable, no quotes, braces, semicolons or
/// backslashes, at most 100 characters.
fn family(f: &Option<String>) -> bool {
    f.as_deref().is_none_or(|s| {
        !s.trim().is_empty()
            && s.chars().count() <= 100
            && s.chars().all(|c| {
                !c.is_control() && !matches!(c, '"' | '\'' | ';' | '{' | '}' | '\\' | '<' | '>')
            })
    })
}

impl Style {
    pub fn validate(&self) -> Result<(), String> {
        let colors = [
            &self.seed_color,
            &self.accent_color,
            &self.text_color,
            &self.secondary_text_color,
            &self.hero_custom_color,
            &self.surface_color,
            &self.tint_color,
            &self.border_color,
        ];
        if !colors.iter().all(|c| hex(c)) {
            return Err("style-color-not-hex".into());
        }
        let ranges = [
            (self.contrast, -1.0, 1.0),
            (self.transparency, 0.0, 100.0),
            (self.blur, 0.0, 100.0),
            (self.refraction, 0.0, 100.0),
            (self.rim, 0.0, 100.0),
            (self.grain, 0.0, 100.0),
            (self.shadow, 0.0, 100.0),
            (self.border_width, 0.0, 4.0),
            (self.radius, 0.0, 48.0),
            (self.font_weight, 100.0, 1000.0),
            (self.font_width, 25.0, 151.0),
            (self.text_scale, 0.75, 1.5),
            (self.letter_spacing, -0.05, 0.2),
            (self.icon_weight, 100.0, 700.0),
            (self.dim_level, 0.0, 100.0),
        ];
        if !ranges.iter().all(|&(v, lo, hi)| range(v, lo, hi)) {
            return Err("style-value-out-of-range".into());
        }
        if !family(&self.font_family) || !family(&self.number_font_family) {
            return Err("style-font-family-invalid".into());
        }
        Ok(())
    }

    /// Reads a stored style, keeping every field that parses and validates on its own.
    pub fn lenient(json: &serde_json::Value) -> Self {
        let Some(map) = json.as_object() else {
            return Self::default();
        };
        let mut kept = serde_json::Map::new();
        for (k, v) in map {
            let one =
                serde_json::Value::Object(serde_json::Map::from_iter([(k.clone(), v.clone())]));
            if serde_json::from_value::<Style>(one).is_ok_and(|s| s.validate().is_ok()) {
                kept.insert(k.clone(), v.clone());
            } else {
                tracing::warn!(field = %k, "dropping an invalid style value from settings.json");
            }
        }
        serde_json::from_value(serde_json::Value::Object(kept)).unwrap_or_default()
    }
}

pub const MAX_WIDGETS: usize = 200;
pub const MAX_NAMED_STYLES: usize = 50;
/// Serialized size limit of one widget's `content` (ADR 0011).
pub const MAX_CONTENT_BYTES: usize = 16 * 1024;

/// One placed widget: its kind, own style and content options (validated by the widget's
/// `settingsSchema` in the frontend; opaque here apart from its size).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct WidgetConfig {
    pub kind: String,
    pub style: Style,
    pub content: serde_json::Map<String, serde_json::Value>,
}

fn id_ok(s: &str, max: usize) -> bool {
    !s.is_empty()
        && s.len() <= max
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

pub fn validate_widgets(
    widgets: &BTreeMap<String, WidgetConfig>,
    named: &BTreeMap<String, Style>,
) -> Result<(), String> {
    if widgets.len() > MAX_WIDGETS {
        return Err("too-many-widgets".into());
    }
    for (id, w) in widgets {
        if !id_ok(id, 64) || !id_ok(&w.kind, 32) {
            return Err("widget-id-invalid".into());
        }
        w.style.validate()?;
        let size = serde_json::to_vec(&w.content).map_or(usize::MAX, |v| v.len());
        if size > MAX_CONTENT_BYTES {
            return Err("widget-content-too-large".into());
        }
    }
    if named.len() > MAX_NAMED_STYLES {
        return Err("too-many-named-styles".into());
    }
    for (name, style) in named {
        if name.trim().is_empty() || name.chars().count() > 60 || name.chars().any(char::is_control)
        {
            return Err("style-name-invalid".into());
        }
        style.validate()?;
    }
    Ok(())
}

/// Lenient load of the `style`, `styles` and `widgets` parts of a stored settings file: invalid
/// fields and invalid widgets are dropped, everything else is kept. Mutates `json` in place so the
/// normal (strict) deserialisation afterwards succeeds.
pub fn sanitize(json: &mut serde_json::Value) {
    let Some(obj) = json.as_object_mut() else {
        return;
    };
    let clean = |v: &serde_json::Value| serde_json::to_value(Style::lenient(v)).unwrap_or_default();
    if let Some(s) = obj.get("style").cloned() {
        obj.insert("style".into(), clean(&s));
    }
    if let Some(serde_json::Value::Object(named)) = obj.get_mut("styles") {
        named.retain(|name, _| !name.trim().is_empty() && name.chars().count() <= 60);
        for v in named.values_mut() {
            *v = clean(v);
        }
        while named.len() > MAX_NAMED_STYLES {
            let Some(last) = named.keys().next_back().cloned() else {
                break;
            };
            named.remove(&last);
        }
    } else {
        obj.remove("styles");
    }
    if let Some(serde_json::Value::Object(widgets)) = obj.get_mut("widgets") {
        widgets.retain(|id, w| {
            let ok = id_ok(id, 64)
                && w.get("kind")
                    .and_then(|k| k.as_str())
                    .is_some_and(|k| id_ok(k, 32))
                && w.get("content").is_none_or(|c| {
                    c.is_object()
                        && serde_json::to_vec(c).is_ok_and(|v| v.len() <= MAX_CONTENT_BYTES)
                });
            if !ok {
                tracing::warn!(widget = %id, "dropping an invalid widget from settings.json");
            }
            ok
        });
        for w in widgets.values_mut() {
            if let Some(s) = w.get("style").cloned() {
                w["style"] = clean(&s);
            }
        }
        while widgets.len() > MAX_WIDGETS {
            let Some(last) = widgets.keys().next_back().cloned() else {
                break;
            };
            widgets.remove(&last);
        }
    } else {
        obj.remove("widgets");
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use serde_json::json;

    use super::*;

    #[test]
    fn validation() {
        let ok: Style = serde_json::from_value(json!({
            "surface": "color", "surfaceColor": "#1a2b3c", "transparency": 40,
            "fontFamily": "Noto Serif", "textScale": 1.2, "accentColor": "#ff000080"
        }))
        .unwrap();
        assert_eq!(ok.validate(), Ok(()));
        let bad = |v: serde_json::Value| serde_json::from_value::<Style>(v).map(|s| s.validate());
        assert_eq!(
            bad(json!({"transparency": 101})).unwrap(),
            Err("style-value-out-of-range".into())
        );
        assert_eq!(
            bad(json!({"textColor": "red"})).unwrap(),
            Err("style-color-not-hex".into())
        );
        assert_eq!(
            bad(json!({"fontFamily": "x\"; } body { color: red"})).unwrap(),
            Err("style-font-family-invalid".into())
        );
        assert!(
            bad(json!({"surface": "chrome"})).is_err(),
            "unknown enum values are rejected"
        );
        let empty = serde_json::to_value(Style::default()).unwrap();
        assert_eq!(empty, json!({}), "unset fields are not written");
    }

    #[test]
    fn lenient_keeps_good_fields() {
        let s = Style::lenient(
            &json!({"blur": 30, "radius": 900, "surface": "chrome", "icons": false}),
        );
        assert_eq!(s.blur, Some(30.0));
        assert_eq!(s.icons, Some(false));
        assert_eq!(s.radius, None);
        assert_eq!(s.surface, None);
    }

    #[test]
    fn sanitize_drops_only_what_is_broken() {
        let mut j = json!({
            "style": {"blur": 50, "shadow": -3},
            "styles": {"Night": {"theme": "dark", "grain": "lots"}},
            "widgets": {
                "cpu-1": {"kind": "cpu", "style": {"textScale": 9}, "content": {"fields": ["load"]}},
                "bad id!": {"kind": "cpu"},
                "x": {"kind": "clock", "content": "not an object"}
            }
        });
        sanitize(&mut j);
        assert_eq!(j["style"], json!({"blur": 50.0}));
        assert_eq!(j["styles"]["Night"], json!({"theme": "dark"}));
        assert_eq!(j["widgets"]["cpu-1"]["style"], json!({}));
        assert_eq!(
            j["widgets"]["cpu-1"]["content"],
            json!({"fields": ["load"]})
        );
        assert!(j["widgets"].get("bad id!").is_none());
        assert!(j["widgets"].get("x").is_none());
    }

    #[test]
    fn widget_limits() {
        let mut w = BTreeMap::new();
        w.insert(
            "clock-1".to_owned(),
            WidgetConfig {
                kind: "clock".into(),
                ..Default::default()
            },
        );
        assert_eq!(validate_widgets(&w, &BTreeMap::new()), Ok(()));
        let big =
            serde_json::Map::from_iter([("t".to_owned(), json!("x".repeat(MAX_CONTENT_BYTES)))]);
        w.insert(
            "clock-2".to_owned(),
            WidgetConfig {
                kind: "clock".into(),
                content: big,
                ..Default::default()
            },
        );
        assert_eq!(
            validate_widgets(&w, &BTreeMap::new()),
            Err("widget-content-too-large".into())
        );
    }
}

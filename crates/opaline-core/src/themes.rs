//! Theme packages (brief §5.2, PLAN-2 tasks 3.4 & 3.9).
//!
//! A theme is either a folder (`<dir>/<id>/theme.json`) or a `.opaline-theme` ZIP archive.
//! Search order (later overrides earlier by id):
//! 1. First-party built-in themes (`/usr/share/opaline/themes/`, with embedded fallbacks for
//!    `opaline` and `classic` so dev builds always have both).
//! 2. Installed themes (`~/.local/share/opaline/themes/`).
//! 3. User themes (`~/.config/opaline/themes/`).
//!
//! Loading is resilient: a broken or partial theme falls back key by key, records non-blocking
//! [`ThemeProblem`] entries naming the file and JSON pointer, and never blanks the desktop.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::css::validate_css;
use crate::style::{ColorSource, Style, Variant, id_ok};
use crate::zip_pkg::{is_safe_entry_path, read_zip};

pub const TOPIC: &str = "themes";
pub const SCHEMA_VERSION: u32 = 1;
pub const SCHEMA_URL: &str = "file:///usr/share/opaline/schemas/theme.schema.json";

/// Embedded first-party themes so dev/uninstalled builds always ship `opaline` and `classic`.
const EMBEDDED_OPALINE: &str = include_str!("../../../spec/themes/opaline/theme.json");
const EMBEDDED_CLASSIC: &str = include_str!("../../../spec/themes/classic/theme.json");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum MotionPersonality {
    Standard,
    Expressive,
    Calm,
    Playful,
    Instant,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ShapeLanguage {
    Rounded,
    Squircle,
    Meaningful,
    Expressive,
    Sharp,
}

/// Design-level theme tokens (color source or fixed palette, motion, shape language).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct ThemeTokens {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_source: Option<ColorSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seed_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variant: Option<Variant>,
    /// Optional fixed palette overrides keyed by M3 role (`primary`, `surface`, …) → `#rrggbb`.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub palette: BTreeMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub motion_personality: Option<MotionPersonality>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shape_language: Option<ShapeLanguage>,
}

/// A font bundled inside a theme package; a license file is mandatory (brief §5.2).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ThemeFont {
    pub family: String,
    /// Relative path inside the theme package (e.g. `fonts/MyFont.woff2`).
    pub file: String,
    /// Relative path to the font's license file inside the package (e.g. `fonts/OFL.txt`).
    pub license: String,
}

/// The `theme.json` manifest (brief §5.2).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct ThemePackage {
    #[serde(rename = "$schema", skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    /// Schema format version (1).
    pub schema_version: u32,
    /// Unique identifier (`[a-z0-9_-]+`, max 64).
    pub id: String,
    pub name: String,
    pub author: String,
    /// Theme package version (semver, e.g. `"2.0.0"`).
    pub version: String,
    pub license: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub previews: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_opaline_version: Option<String>,
    #[serde(default)]
    pub tokens: ThemeTokens,
    /// Base style layer applied to every widget under this theme.
    #[serde(default)]
    pub style: Style,
    /// Per-widget-kind style layers (`cpu`, `clock`, …).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub kinds: BTreeMap<String, Style>,
    /// Per-element style layers keyed by role (`hero`, `label`) or `#block-id`.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub elements: BTreeMap<String, Style>,
    /// Optional composition layouts per widget kind.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub layouts: BTreeMap<String, opaline_compose::Composition>,
    /// Optional bundled fonts (each must include its license file).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fonts: Vec<ThemeFont>,
    /// Relative paths to bundled images.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<String>,
    /// Optional relative path to a stylesheet inside the package (defaults to `theme.css` if present).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub css: Option<String>,
}

impl ThemePackage {
    /// The JSON Schema of `theme.json` (`spec/theme.schema.json`).
    pub fn schema() -> serde_json::Value {
        serde_json::Value::from(schemars::schema_for!(ThemePackage))
    }
}

/// Non-blocking validation issue reported when loading a theme (never blanks the desktop).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeProblem {
    pub file: String,
    pub at: String,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ThemeSource {
    Builtin,
    System,
    Installed,
    User,
}

/// A loaded theme ready for core and the layer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedTheme {
    pub package: ThemePackage,
    pub source: ThemeSource,
    /// Validated `theme.css` contents (empty when absent, invalid, or in safe mode).
    pub css: String,
    /// Non-blocking problems encountered while loading this theme.
    pub problems: Vec<ThemeProblem>,
}

/// Full catalog published on the `themes` topic.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeCatalog {
    pub active_id: String,
    pub active: Option<LoadedTheme>,
    pub themes: Vec<ThemeSummary>,
    pub problems: Vec<ThemeProblem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSummary {
    pub id: String,
    pub name: String,
    pub author: String,
    pub version: String,
    pub description: String,
    pub source: ThemeSource,
}

fn hex_ok(s: &str) -> bool {
    let b = s.as_bytes();
    (b.len() == 7 || b.len() == 9) && b[0] == b'#' && b[1..].iter().all(u8::is_ascii_hexdigit)
}

/// Parses a `theme.json` string with key-by-key fallback: invalid style keys, layouts, or tokens
/// are dropped individually and recorded with their exact JSON pointer in `problems`.
pub fn parse_theme_lenient(
    file: &str,
    raw: &str,
    asset_exists: impl Fn(&str) -> bool,
) -> Result<(ThemePackage, Vec<ThemeProblem>), ThemeProblem> {
    let mut val: serde_json::Value = serde_json::from_str(raw).map_err(|e| ThemeProblem {
        file: file.to_owned(),
        at: "/".into(),
        message: format!("invalid JSON: {e}"),
    })?;
    let Some(obj) = val.as_object_mut() else {
        return Err(ThemeProblem {
            file: file.to_owned(),
            at: "/".into(),
            message: "theme.json must be a JSON object".into(),
        });
    };

    let mut problems = Vec::new();

    let id = obj
        .get("id")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .to_owned();
    if !id_ok(&id, 64) {
        return Err(ThemeProblem {
            file: file.to_owned(),
            at: "/id".into(),
            message: "missing or invalid theme id".into(),
        });
    }

    let schema_ver = obj
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(1);
    if schema_ver == 0 || schema_ver > u64::from(SCHEMA_VERSION) {
        problems.push(ThemeProblem {
            file: file.to_owned(),
            at: "/schemaVersion".into(),
            message: format!("unknown schemaVersion {schema_ver}; reading known keys only"),
        });
    }

    // Leniently sanitize `style`, `kinds`, and `elements` key by key.
    let style = if let Some(s) = obj.get("style") {
        let (clean, ps) = Style::lenient_with_problems(s, "/style");
        for (at, msg) in ps {
            problems.push(ThemeProblem {
                file: file.to_owned(),
                at,
                message: msg,
            });
        }
        clean
    } else {
        Style::default()
    };

    let mut kinds = BTreeMap::new();
    if let Some(serde_json::Value::Object(map)) = obj.get("kinds") {
        for (k, v) in map {
            if !id_ok(k, 32) {
                problems.push(ThemeProblem {
                    file: file.to_owned(),
                    at: format!("/kinds/{k}"),
                    message: "invalid widget kind".into(),
                });
                continue;
            }
            let (clean, ps) = Style::lenient_with_problems(v, &format!("/kinds/{k}"));
            for (at, msg) in ps {
                problems.push(ThemeProblem {
                    file: file.to_owned(),
                    at,
                    message: msg,
                });
            }
            kinds.insert(k.clone(), clean);
        }
    }

    let mut elements = BTreeMap::new();
    if let Some(serde_json::Value::Object(map)) = obj.get("elements") {
        for (k, v) in map {
            let bare = k.strip_prefix('#').unwrap_or(k);
            if !id_ok(bare, 64) {
                problems.push(ThemeProblem {
                    file: file.to_owned(),
                    at: format!("/elements/{k}"),
                    message: "invalid element selector key".into(),
                });
                continue;
            }
            let (clean, ps) = Style::lenient_with_problems(v, &format!("/elements/{k}"));
            for (at, msg) in ps {
                problems.push(ThemeProblem {
                    file: file.to_owned(),
                    at,
                    message: msg,
                });
            }
            elements.insert(k.clone(), clean);
        }
    }

    // Tokens: fall back on invalid seed/palette colors.
    let mut tokens: ThemeTokens = obj
        .get("tokens")
        .and_then(|t| serde_json::from_value(t.clone()).ok())
        .unwrap_or_default();
    if let Some(seed) = &tokens.seed_color
        && !hex_ok(seed)
    {
        problems.push(ThemeProblem {
            file: file.to_owned(),
            at: "/tokens/seedColor".into(),
            message: "seedColor must be #rrggbb".into(),
        });
        tokens.seed_color = None;
    }
    tokens.palette.retain(|role, col| {
        let ok = hex_ok(col);
        if !ok {
            problems.push(ThemeProblem {
                file: file.to_owned(),
                at: format!("/tokens/palette/{role}"),
                message: "palette color must be #rrggbb".into(),
            });
        }
        ok
    });

    // Layouts: validate each composition via `opaline_compose`.
    let mut layouts = BTreeMap::new();
    if let Some(serde_json::Value::Object(map)) = obj.get("layouts") {
        for (k, v) in map {
            if !id_ok(k, 32) {
                problems.push(ThemeProblem {
                    file: file.to_owned(),
                    at: format!("/layouts/{k}"),
                    message: "invalid widget kind".into(),
                });
                continue;
            }
            match serde_json::from_value::<opaline_compose::Composition>(v.clone()) {
                Ok(comp) => {
                    let cprobs = opaline_compose::validate(&comp);
                    if cprobs.is_empty() {
                        layouts.insert(k.clone(), comp);
                    } else {
                        for p in cprobs {
                            problems.push(ThemeProblem {
                                file: file.to_owned(),
                                at: format!("/layouts/{k}{}", p.at),
                                message: p.message,
                            });
                        }
                    }
                }
                Err(err) => {
                    problems.push(ThemeProblem {
                        file: file.to_owned(),
                        at: format!("/layouts/{k}"),
                        message: format!("invalid composition: {err}"),
                    });
                }
            }
        }
    }

    // Bundled fonts: require safe relative paths AND an existing license file in the package.
    let mut fonts = Vec::new();
    if let Some(serde_json::Value::Array(arr)) = obj.get("fonts") {
        for (idx, item) in arr.iter().enumerate() {
            match serde_json::from_value::<ThemeFont>(item.clone()) {
                Ok(f) => {
                    if !is_safe_entry_path(&f.file) || !is_safe_entry_path(&f.license) {
                        problems.push(ThemeProblem {
                            file: file.to_owned(),
                            at: format!("/fonts/{idx}"),
                            message: "font or license path is unsafe".into(),
                        });
                    } else if !asset_exists(&f.file) {
                        problems.push(ThemeProblem {
                            file: file.to_owned(),
                            at: format!("/fonts/{idx}/file"),
                            message: format!("missing font file '{}'", f.file),
                        });
                    } else if !asset_exists(&f.license) {
                        problems.push(ThemeProblem {
                            file: file.to_owned(),
                            at: format!("/fonts/{idx}/license"),
                            message: format!(
                                "bundled font '{}' requires license file '{}'",
                                f.family, f.license
                            ),
                        });
                    } else {
                        fonts.push(f);
                    }
                }
                Err(err) => {
                    problems.push(ThemeProblem {
                        file: file.to_owned(),
                        at: format!("/fonts/{idx}"),
                        message: err.to_string(),
                    });
                }
            }
        }
    }

    // Images: verify safe paths.
    let mut images = Vec::new();
    if let Some(serde_json::Value::Array(arr)) = obj.get("images") {
        for (idx, item) in arr.iter().enumerate() {
            if let Some(p) = item.as_str() {
                if is_safe_entry_path(p) && asset_exists(p) {
                    images.push(p.to_owned());
                } else {
                    problems.push(ThemeProblem {
                        file: file.to_owned(),
                        at: format!("/images/{idx}"),
                        message: format!("missing or unsafe image path '{p}'"),
                    });
                }
            }
        }
    }

    let str_field = |k: &str, fallback: &str| {
        obj.get(k)
            .and_then(serde_json::Value::as_str)
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(fallback)
            .to_owned()
    };

    let css = obj
        .get("css")
        .and_then(serde_json::Value::as_str)
        .filter(|p| is_safe_entry_path(p))
        .map(str::to_owned);

    let previews = obj
        .get("previews")
        .and_then(serde_json::Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(serde_json::Value::as_str)
                .filter(|p| is_safe_entry_path(p))
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();

    let pkg = ThemePackage {
        schema: obj
            .get("$schema")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned),
        schema_version: SCHEMA_VERSION,
        name: str_field("name", &id),
        id,
        author: str_field("author", "Unknown"),
        version: str_field("version", "1.0.0"),
        license: str_field("license", "Unknown"),
        description: obj
            .get("description")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .to_owned(),
        previews,
        min_opaline_version: obj
            .get("minOpalineVersion")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned),
        tokens,
        style,
        kinds,
        elements,
        layouts,
        fonts,
        images,
        css,
    };

    Ok((pkg, problems))
}

/// Loads a theme from a directory (`<dir>/theme.json` + optional `theme.css`).
pub fn load_theme_dir(
    dir: &Path,
    source: ThemeSource,
    safe_mode: bool,
) -> Result<LoadedTheme, ThemeProblem> {
    let manifest_path = dir.join("theme.json");
    let display = manifest_path.display().to_string();
    let raw = std::fs::read_to_string(&manifest_path).map_err(|e| ThemeProblem {
        file: display.clone(),
        at: "/".into(),
        message: format!("could not read theme.json: {e}"),
    })?;
    let (pkg, mut problems) = parse_theme_lenient(&display, &raw, |rel| dir.join(rel).is_file())?;
    let css = if safe_mode {
        String::new()
    } else {
        let css_rel = pkg.css.as_deref().unwrap_or("theme.css");
        let css_path = dir.join(css_rel);
        if css_path.is_file() {
            match std::fs::read_to_string(&css_path) {
                Ok(text) => match validate_css(&css_path.display().to_string(), &text) {
                    Ok(clean) => clean,
                    Err(cprobs) => {
                        for p in cprobs {
                            problems.push(ThemeProblem {
                                file: p.file,
                                at: format!("line {}", p.line),
                                message: p.message,
                            });
                        }
                        String::new()
                    }
                },
                Err(e) => {
                    problems.push(ThemeProblem {
                        file: css_path.display().to_string(),
                        at: "/".into(),
                        message: e.to_string(),
                    });
                    String::new()
                }
            }
        } else {
            String::new()
        }
    };
    Ok(LoadedTheme {
        package: pkg,
        source,
        css,
        problems,
    })
}

/// Loads a theme from a `.opaline-theme` ZIP archive.
pub fn load_theme_zip(
    path: &Path,
    source: ThemeSource,
    safe_mode: bool,
) -> Result<LoadedTheme, ThemeProblem> {
    let display = path.display().to_string();
    let bytes = std::fs::read(path).map_err(|e| ThemeProblem {
        file: display.clone(),
        at: "/".into(),
        message: format!("could not read archive: {e}"),
    })?;
    load_theme_zip_bytes(&display, &bytes, source, safe_mode)
}

/// Loads a theme from in-memory `.opaline-theme` ZIP bytes.
pub fn load_theme_zip_bytes(
    display: &str,
    bytes: &[u8],
    source: ThemeSource,
    safe_mode: bool,
) -> Result<LoadedTheme, ThemeProblem> {
    let files = read_zip(bytes).map_err(|e| ThemeProblem {
        file: display.to_owned(),
        at: "/".into(),
        message: e,
    })?;
    let manifest_bytes = files.get("theme.json").ok_or_else(|| ThemeProblem {
        file: display.to_owned(),
        at: "/".into(),
        message: "archive is missing theme.json".into(),
    })?;
    let raw = std::str::from_utf8(manifest_bytes).map_err(|_| ThemeProblem {
        file: format!("{display}:theme.json"),
        at: "/".into(),
        message: "theme.json is not valid UTF-8".into(),
    })?;
    let (pkg, mut problems) = parse_theme_lenient(&format!("{display}:theme.json"), raw, |rel| {
        files.contains_key(rel)
    })?;

    let css = if safe_mode {
        String::new()
    } else {
        let css_rel = pkg.css.as_deref().unwrap_or("theme.css");
        if let Some(css_bytes) = files.get(css_rel) {
            match std::str::from_utf8(css_bytes) {
                Ok(text) => match validate_css(&format!("{display}:{css_rel}"), text) {
                    Ok(clean) => clean,
                    Err(cprobs) => {
                        for p in cprobs {
                            problems.push(ThemeProblem {
                                file: p.file,
                                at: format!("line {}", p.line),
                                message: p.message,
                            });
                        }
                        String::new()
                    }
                },
                Err(_) => {
                    problems.push(ThemeProblem {
                        file: format!("{display}:{css_rel}"),
                        at: "/".into(),
                        message: "theme CSS is not valid UTF-8".into(),
                    });
                    String::new()
                }
            }
        } else {
            String::new()
        }
    };
    Ok(LoadedTheme {
        package: pkg,
        source,
        css,
        problems,
    })
}

/// The three standard theme search directories (brief §5.2).
pub fn search_roots() -> Vec<(PathBuf, ThemeSource)> {
    let mut roots = vec![(
        PathBuf::from("/usr/share/opaline/themes"),
        ThemeSource::System,
    )];
    if let Ok(data) = crate::paths::data_dir() {
        roots.push((data.join("themes"), ThemeSource::Installed));
    }
    if let Ok(cfg) = crate::paths::config_dir() {
        roots.push((cfg.join("themes"), ThemeSource::User));
    }
    roots
}

/// Discovers all themes across the given roots (plus embedded `opaline` and `classic` defaults)
/// and selects `active_id` (falling back to `"opaline"` then `"classic"` if missing).
pub fn load_catalog(
    roots: &[(PathBuf, ThemeSource)],
    active_id: &str,
    safe_mode: bool,
) -> ThemeCatalog {
    let mut by_id: BTreeMap<String, LoadedTheme> = BTreeMap::new();
    let mut problems: Vec<ThemeProblem> = Vec::new();

    // 1. Embedded first-party themes first so they are always available.
    for (name, raw) in [
        ("builtin:opaline/theme.json", EMBEDDED_OPALINE),
        ("builtin:classic/theme.json", EMBEDDED_CLASSIC),
    ] {
        if let Ok((pkg, probs)) = parse_theme_lenient(name, raw, |_| false) {
            by_id.insert(
                pkg.id.clone(),
                LoadedTheme {
                    package: pkg,
                    source: ThemeSource::Builtin,
                    css: String::new(),
                    problems: probs,
                },
            );
        }
    }

    // 2. Scan system → installed → user directories (later wins by id).
    for (root, source) in roots {
        let Ok(entries) = std::fs::read_dir(root) else {
            continue;
        };
        let mut paths: Vec<PathBuf> = entries.filter_map(|e| e.ok().map(|x| x.path())).collect();
        paths.sort();
        for path in paths {
            let loaded = if path.is_dir() && path.join("theme.json").is_file() {
                load_theme_dir(&path, *source, safe_mode)
            } else if path.is_file()
                && path
                    .extension()
                    .and_then(|e| e.to_str())
                    .is_some_and(|e| e == "opaline-theme")
            {
                load_theme_zip(&path, *source, safe_mode)
            } else {
                continue;
            };
            match loaded {
                Ok(theme) => {
                    problems.extend(theme.problems.clone());
                    by_id.insert(theme.package.id.clone(), theme);
                }
                Err(prob) => {
                    tracing::warn!(file = %prob.file, at = %prob.at, msg = %prob.message, "skipping broken theme");
                    problems.push(prob);
                }
            }
        }
    }

    let resolved_id = if by_id.contains_key(active_id) {
        active_id.to_owned()
    } else if by_id.contains_key(crate::store::DEFAULT_THEME) {
        crate::store::DEFAULT_THEME.to_owned()
    } else {
        crate::store::CLASSIC_THEME.to_owned()
    };

    let active = by_id.get(&resolved_id).cloned();
    let themes = by_id
        .values()
        .map(|t| ThemeSummary {
            id: t.package.id.clone(),
            name: t.package.name.clone(),
            author: t.package.author.clone(),
            version: t.package.version.clone(),
            description: t.package.description.clone(),
            source: t.source,
        })
        .collect();

    ThemeCatalog {
        active_id: resolved_id,
        active,
        themes,
        problems,
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;
    use crate::zip_pkg::write_zip;

    #[test]
    fn embedded_opaline_and_classic_load_cleanly() {
        let cat = load_catalog(&[], "opaline", false);
        assert_eq!(cat.active_id, "opaline");
        assert!(cat.problems.is_empty(), "{:?}", cat.problems);
        let opaline = cat.active.unwrap();
        assert_eq!(opaline.package.style.blur, Some(30.0));
        assert_eq!(opaline.package.style.transparency, Some(80.0));
        assert!(cat.themes.iter().any(|t| t.id == "classic"));

        let cat_classic = load_catalog(&[], "classic", false);
        let classic = cat_classic.active.unwrap();
        assert_eq!(classic.package.style.blur, Some(60.0));
        assert_eq!(classic.package.style.transparency, Some(60.0));
    }

    #[test]
    fn partial_theme_falls_back_key_by_key() {
        let raw = r##"{
            "schemaVersion": 1,
            "id": "broken-bits",
            "name": "Broken Bits",
            "style": { "blur": 25, "transparency": 999, "surface": "plasma" },
            "kinds": { "cpu": { "accentColor": "#ff5500", "radius": 500 } },
            "fonts": [{ "family": "Test", "file": "fonts/t.woff2", "license": "fonts/OFL.txt" }]
        }"##;
        let (pkg, probs) =
            parse_theme_lenient("test/theme.json", raw, |p| p == "fonts/t.woff2").unwrap();
        assert_eq!(pkg.style.blur, Some(25.0));
        assert_eq!(pkg.style.transparency, None);
        assert_eq!(pkg.style.surface, None);
        assert_eq!(pkg.kinds["cpu"].accent_color.as_deref(), Some("#ff5500"));
        assert_eq!(pkg.kinds["cpu"].radius, None);
        assert!(
            pkg.fonts.is_empty(),
            "font without license file is rejected"
        );
        assert!(probs.iter().any(|p| p.at == "/style/transparency"));
        assert!(probs.iter().any(|p| p.at == "/kinds/cpu/radius"));
        assert!(probs.iter().any(|p| p.at == "/fonts/0/license"));
    }

    #[test]
    fn loads_folder_and_zip_themes_with_user_priority() {
        let dir = tempfile::tempdir().unwrap();
        let sys_root = dir.path().join("sys");
        let user_root = dir.path().join("user");
        std::fs::create_dir_all(sys_root.join("custom")).unwrap();
        std::fs::create_dir_all(&user_root).unwrap();

        std::fs::write(
            sys_root.join("custom/theme.json"),
            r#"{"schemaVersion":1,"id":"custom","name":"System Custom","style":{"blur":40}}"#,
        )
        .unwrap();

        // User zip overrides system folder of the same id, with valid CSS.
        let mut files = BTreeMap::new();
        files.insert(
            "theme.json".into(),
            br#"{"schemaVersion":1,"id":"custom","name":"User Custom","style":{"blur":10}}"#
                .to_vec(),
        );
        files.insert(
            "theme.css".into(),
            b"[data-theme='custom'] [data-role='hero'] { letter-spacing: 0.02em; }".to_vec(),
        );
        let zip = write_zip(&files).unwrap();
        std::fs::write(user_root.join("custom.opaline-theme"), zip).unwrap();

        let roots = vec![
            (sys_root, ThemeSource::System),
            (user_root, ThemeSource::User),
        ];
        let cat = load_catalog(&roots, "custom", false);
        assert_eq!(cat.active_id, "custom");
        let active = cat.active.unwrap();
        assert_eq!(active.package.name, "User Custom");
        assert_eq!(active.package.style.blur, Some(10.0));
        assert_eq!(active.source, ThemeSource::User);
        assert!(active.css.contains("letter-spacing"));

        // Safe mode strips theme.css.
        let safe = load_catalog(&roots, "custom", true);
        assert!(safe.active.unwrap().css.is_empty());
    }
}

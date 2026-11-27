//! Committed JSON Schemas in `spec/` match the Rust types (`OPALINE_UPDATE_SCHEMA=1` rewrites
//! them), and first-party themes parse cleanly. See ADR 0017 and PLAN-2 §3 P3.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::path::PathBuf;

fn spec(path: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../spec")
        .join(path)
}

fn assert_schema_current(file: &str, fresh_val: &serde_json::Value) {
    let path = spec(file);
    let fresh = format!("{}\n", serde_json::to_string_pretty(fresh_val).unwrap());
    if std::env::var_os("OPALINE_UPDATE_SCHEMA").is_some() {
        std::fs::write(&path, &fresh).unwrap();
    }
    let committed = std::fs::read_to_string(&path).unwrap_or_default();
    assert!(
        committed == fresh,
        "spec/{file} is stale: OPALINE_UPDATE_SCHEMA=1 cargo test -p opaline-core --test schemas"
    );
}

#[test]
fn style_schema_is_current() {
    assert_schema_current("style.schema.json", &opaline_core::style::Style::schema());
}

#[test]
fn theme_schema_is_current() {
    assert_schema_current(
        "theme.schema.json",
        &opaline_core::themes::ThemePackage::schema(),
    );
}

#[test]
fn settings_schema_is_current() {
    assert_schema_current(
        "settings.schema.json",
        &opaline_core::store::Settings::schema(),
    );
}

#[test]
fn layouts_schema_is_current() {
    assert_schema_current(
        "layouts.schema.json",
        &opaline_core::layouts::Layouts::schema(),
    );
}

#[test]
fn rice_schema_is_current() {
    assert_schema_current(
        "rice.schema.json",
        &opaline_core::rice::RiceBundle::schema(),
    );
}

#[test]
fn first_party_theme_files_are_valid() {
    for &id in opaline_core::themes::BUILTIN_THEME_IDS {
        let dir = spec(&format!("themes/{id}"));
        let loaded = opaline_core::themes::load_theme_dir(
            &dir,
            opaline_core::themes::ThemeSource::System,
            false,
        )
        .unwrap_or_else(|e| panic!("theme {id} failed: {e:?}"));
        assert_eq!(loaded.package.id, id);
        assert!(
            loaded.problems.is_empty(),
            "theme {id} had problems: {:?}",
            loaded.problems
        );
    }
}

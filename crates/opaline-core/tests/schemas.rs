//! Committed JSON Schemas in `spec/` match the Rust types (`OPALINE_UPDATE_SCHEMA=1` rewrites
//! them). See ADR 0017 (style-key parity) and PLAN-2 §3 P3.
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

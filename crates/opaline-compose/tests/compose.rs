//! The fixtures in `spec/compositions/` are valid and round-trip; broken ones are rejected at the
//! right spot; the committed JSON Schema matches the types (`OPALINE_UPDATE_SCHEMA=1` rewrites it).
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::path::PathBuf;

use opaline_compose::{Composition, Problem, parse, schema, validate};

fn spec(path: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../spec")
        .join(path)
}

#[test]
fn fixtures_are_valid_and_round_trip() {
    let mut n = 0;
    for entry in std::fs::read_dir(spec("compositions")).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_none_or(|e| e != "json") {
            continue;
        }
        n += 1;
        let text = std::fs::read_to_string(&path).unwrap();
        let c = parse(&text).unwrap_or_else(|p| panic!("{}: {p:#?}", path.display()));
        let again: Composition = serde_json::from_str(&serde_json::to_string(&c).unwrap()).unwrap();
        assert_eq!(c, again, "{} doesn't round-trip", path.display());
        // Serializing writes only what was given (no defaults spelled out).
        let original: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(
            numbers_as_f64(serde_json::to_value(&c).unwrap()),
            numbers_as_f64(original),
            "{}",
            path.display()
        );
    }
    assert!(n > 0);
}

/// `1` and `1.0` are the same number.
fn numbers_as_f64(v: serde_json::Value) -> serde_json::Value {
    use serde_json::Value as J;
    match v {
        J::Number(n) => n
            .as_f64()
            .and_then(serde_json::Number::from_f64)
            .map_or(J::Null, J::Number),
        J::Array(a) => J::Array(a.into_iter().map(numbers_as_f64).collect()),
        J::Object(o) => J::Object(o.into_iter().map(|(k, v)| (k, numbers_as_f64(v))).collect()),
        other => other,
    }
}

#[test]
fn schema_is_current() {
    let path = spec("composition.schema.json");
    let fresh = format!("{}\n", serde_json::to_string_pretty(&schema()).unwrap());
    if std::env::var_os("OPALINE_UPDATE_SCHEMA").is_some() {
        std::fs::write(&path, &fresh).unwrap();
    }
    let committed = std::fs::read_to_string(&path).unwrap_or_default();
    assert!(
        committed == fresh,
        "spec/composition.schema.json is stale: OPALINE_UPDATE_SCHEMA=1 cargo test -p opaline-compose"
    );
}

fn problems(json: serde_json::Value) -> Vec<Problem> {
    let c: Composition = serde_json::from_value(json).unwrap();
    validate(&c)
}

fn at(ps: &[Problem]) -> Vec<&str> {
    ps.iter().map(|p| p.at.as_str()).collect()
}

fn one(root: serde_json::Value) -> serde_json::Value {
    serde_json::json!({ "version": 1, "layouts": [{ "root": root }] })
}

#[test]
fn rejects_at_the_right_spot() {
    let ps = problems(one(serde_json::json!({
        "id": "root", "type": "column", "children": [
            { "id": "a", "type": "text", "text": "{round('x')}" },
            { "id": "a", "type": "number", "value": "cpu.load +" },
            { "id": "Bad", "type": "spacer" },
            { "id": "g", "type": "grid", "columns": 0, "children": [] },
            { "id": "i", "type": "text", "text": "{$item.name}" },
            { "id": "b", "type": "text", "text": "{bind.nope}" }
        ]
    })));
    assert_eq!(
        at(&ps),
        [
            "/layouts/0/root/children/0/text",
            "/layouts/0/root/children/1/id",
            "/layouts/0/root/children/1/value",
            "/layouts/0/root/children/2/id",
            "/layouts/0/root/children/3/columns",
            "/layouts/0/root/children/4/text",
            "/layouts/0/root/children/5/text",
        ],
        "{ps:#?}"
    );
    let (code, pos) = ps[0].expr.unwrap();
    assert_eq!((code.as_str(), pos), ("type-error", 7));
}

#[test]
fn list_items_see_item_and_index() {
    let ps = problems(one(serde_json::json!({
        "id": "procs", "type": "list", "items": "processes.list", "max": 5,
        "item": { "id": "row", "type": "row", "children": [
            { "id": "name", "type": "text", "text": "{$index + 1}. {$item.name}" },
            { "id": "cpu", "type": "number", "value": "$item.cpu" }
        ]}
    })));
    assert!(ps.is_empty(), "{ps:#?}");
}

#[test]
fn binding_cycles_are_rejected() {
    let ps = problems(serde_json::json!({
        "version": 1,
        "bindings": { "a": "bind.b + 1", "b": "bind.c", "c": "bind.a", "d": "bind.a" },
        "layouts": [{ "root": { "id": "x", "type": "text", "text": "{bind.d}" } }]
    }));
    assert_eq!(at(&ps), ["/bindings/a"], "{ps:#?}");
}

#[test]
fn limits_keep_hostile_files_cheap() {
    let nest = |levels: usize| {
        let mut text = r#"{ "id": "leaf", "type": "spacer" }"#.to_owned();
        for i in 0..levels {
            text = format!(r#"{{ "id": "n{i}", "type": "column", "children": [{text}] }}"#);
        }
        format!(r#"{{ "version": 1, "layouts": [{{ "root": {text} }}] }}"#)
    };
    // A deep file is refused before serde sees it (its recursion would overflow the stack).
    let ps = parse(&nest(5000)).unwrap_err();
    assert_eq!(ps.len(), 1, "{ps:#?}");
    // Just under the JSON limit: serde copes, the validator reports the depth once.
    let ps = parse(&nest(opaline_compose::MAX_JSON_DEPTH / 2 - 3)).unwrap_err();
    assert_eq!(ps.len(), 1, "{ps:#?}");
    assert!(ps[0].message.contains("deeper than 24"), "{ps:#?}");
    // Too many nodes: reported once.
    let kids: Vec<_> = (0..64)
        .map(|i| serde_json::json!({ "id": format!("c{i}"), "type": "column",
            "children": (0..20).map(|j| serde_json::json!({ "id": format!("c{i}-{j}"), "type": "spacer" })).collect::<Vec<_>>() }))
        .collect();
    let ps = problems(one(
        serde_json::json!({ "id": "r", "type": "row", "children": kids }),
    ));
    assert_eq!(ps.len(), 1, "{ps:#?}");
    assert!(ps[0].message.contains("1024"));
}

#[test]
fn controls_send_only_allowed_commands() {
    let ps = problems(one(serde_json::json!({
        "id": "r", "type": "column", "children": [
            { "id": "ok", "type": "button", "text": "Play", "command": { "cmd": "media",
              "args": { "player": "'org.mpris.MediaPlayer2.x'", "action": "'play-pause'" } } },
            { "id": "settings", "type": "button", "text": "x", "command": { "cmd": "update-settings" } },
            { "id": "kill", "type": "button", "text": "End", "command": { "cmd": "end-task" } },
            { "id": "kill-ok", "type": "button", "text": "End", "confirm": "Really?",
              "command": { "cmd": "end-task" } },
            { "id": "t", "type": "toggle", "value": "true", "command": { "cmd": "drive-power-off" } }
        ]
    })));
    assert_eq!(
        at(&ps),
        [
            "/layouts/0/root/children/1/command/cmd",
            "/layouts/0/root/children/2/command/cmd",
            "/layouts/0/root/children/4/command/cmd",
        ],
        "{ps:#?}"
    );
}

#[test]
fn version_and_garbage() {
    assert!(parse("{}").is_err());
    assert!(parse("[1,2]").is_err());
    let ps = problems(serde_json::json!({ "version": 2, "layouts": [] }));
    assert_eq!(at(&ps), ["/version", "/layouts"]);
}

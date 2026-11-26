//! Runs the shared corpus (`spec/expressions/*.json`, docs/EXPRESSIONS.md §8). The TypeScript
//! implementation runs the same files.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::BTreeMap;
use std::path::PathBuf;

use opaline_expr::{Agg, Host, Key, Locale, Program, Value};
use serde_json::Value as Json;

struct TestHost {
    topics: BTreeMap<String, Value>,
    now: Option<f64>,
    history: BTreeMap<String, Vec<f64>>,
    locale: Locale,
}

impl Host for TestHost {
    fn has_topic(&self, name: &str) -> bool {
        self.topics.contains_key(name)
    }

    fn topic(&self, name: &str, keys: &[Key]) -> Value {
        self.topics.get(name).map_or(Value::Null, |v| v.at(keys))
    }

    fn now_ms(&self) -> Option<f64> {
        self.now
    }

    fn history(&self, path: &str, agg: Agg, _window: f64) -> Option<f64> {
        let xs = self.history.get(path).filter(|xs| !xs.is_empty())?;
        Some(match agg {
            Agg::Avg => xs.iter().sum::<f64>() / xs.len() as f64,
            Agg::Min => xs.iter().copied().fold(f64::INFINITY, f64::min),
            Agg::Max => xs.iter().copied().fold(f64::NEG_INFINITY, f64::max),
            Agg::Delta => xs.last()? - xs.first()?,
        })
    }

    fn locale(&self) -> Locale {
        self.locale
    }
}

fn host(case: &Json) -> TestHost {
    let mut topics = BTreeMap::new();
    if let Some(data) = case.get("data").and_then(Json::as_object) {
        for (k, v) in data {
            topics.insert(k.clone(), Value::from(v));
        }
    }
    if let Some(extra) = case.get("topics").and_then(Json::as_array) {
        for t in extra.iter().filter_map(Json::as_str) {
            topics.entry(t.to_owned()).or_insert(Value::Null);
        }
    }
    let history = case
        .get("history")
        .and_then(Json::as_object)
        .map(|h| {
            h.iter()
                .map(|(k, v)| {
                    let xs = v
                        .as_array()
                        .map(|a| a.iter().filter_map(Json::as_f64).collect())
                        .unwrap_or_default();
                    (k.clone(), xs)
                })
                .collect()
        })
        .unwrap_or_default();
    TestHost {
        topics,
        now: case.get("now").and_then(Json::as_f64),
        history,
        locale: Locale::from_tag(case.get("locale").and_then(Json::as_str).unwrap_or("en")),
    }
}

fn same(got: &Value, want: &Json) -> bool {
    match (got, want) {
        (Value::Num(a), Json::Number(b)) => {
            let b = b.as_f64().unwrap();
            (a - b).abs() <= 1e-9 * b.abs().max(1.0)
        }
        _ => Json::from(got) == *want,
    }
}

/// Runs one case; `Err` describes the mismatch.
fn run(case: &Json) -> Result<(), String> {
    let compiled = match (case.get("expr"), case.get("template")) {
        (Some(Json::String(e)), _) => Program::expression(e),
        (_, Some(Json::String(t))) => Program::template(t),
        _ => return Err("case has neither expr nor template".into()),
    };
    let want_error = case.get("error").and_then(Json::as_str);
    let program = match compiled {
        Ok(p) => p,
        Err(d) => {
            return if want_error == Some(d.code.as_str()) {
                Ok(())
            } else {
                Err(format!("compile error {d}"))
            };
        }
    };
    let out = program.eval(&host(case));
    match want_error {
        Some(code) => {
            if !out.errors.iter().any(|e| e.code.as_str() == code) {
                return Err(format!("expected {code}, got {:?}", out.errors));
            }
        }
        None => {
            if !out.errors.is_empty() {
                return Err(format!("unexpected errors {:?}", out.errors));
            }
        }
    }
    if let Some(want) = case.get("expect")
        && !same(&out.value, want)
    {
        return Err(format!("got {:?}, want {want}", out.value));
    }
    Ok(())
}

#[test]
fn corpus() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../spec/expressions");
    let mut files: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .collect();
    files.sort();
    assert!(!files.is_empty(), "no corpus in {}", dir.display());
    let mut failures = Vec::new();
    let mut count = 0;
    for file in files {
        let doc: Json = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        for case in doc["cases"].as_array().unwrap() {
            count += 1;
            if let Err(why) = run(case) {
                let name = case["name"].as_str().unwrap_or("?");
                let file = file.file_name().unwrap().to_string_lossy();
                failures.push(format!("{file}: {name}: {why}"));
            }
        }
    }
    assert!(count > 100, "only {count} cases");
    assert!(
        failures.is_empty(),
        "{} of {count} failed:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

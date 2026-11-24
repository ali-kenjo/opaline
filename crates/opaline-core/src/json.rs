//! Conversions between protocol values and plain JSON.

use opaline_ipc::{Availability, Value};

/// A value as plain JSON: numbers, strings, arrays, objects; missing values as
/// `"<unavailable: reason>"`.
pub fn to_json(value: &Value) -> serde_json::Value {
    use serde_json::Value as J;
    match value {
        Value::Num(n) => serde_json::Number::from_f64(*n).map_or(J::Null, J::Number),
        Value::Nums(v) => J::Array(v.iter().map(|n| to_json(&Value::Num(*n))).collect()),
        Value::Text(s) => J::String(s.clone()),
        Value::Bool(b) => J::Bool(*b),
        Value::List(v) => J::Array(v.iter().map(to_json).collect()),
        Value::Map(m) => J::Object(m.iter().map(|(k, v)| (k.clone(), to_json(v))).collect()),
        Value::Missing(Availability::Unavailable { reason }) => {
            J::String(format!("<unavailable: {reason}>"))
        }
        Value::Missing(Availability::Asleep) => J::String("<asleep>".into()),
        Value::Missing(Availability::NeedsPermission { fix }) => {
            J::String(format!("<needs permission: {fix}>"))
        }
    }
}

/// Plain JSON as a value (`null` becomes "not reported").
pub fn from_json(json: &serde_json::Value) -> Value {
    use serde_json::Value as J;
    match json {
        J::Null => Value::unavailable("not-reported"),
        J::Bool(b) => Value::Bool(*b),
        J::Number(n) => Value::Num(n.as_f64().unwrap_or(0.0)),
        J::String(s) => Value::Text(s.clone()),
        J::Array(a) => Value::List(a.iter().map(from_json).collect()),
        J::Object(o) => Value::Map(o.iter().map(|(k, v)| (k.clone(), from_json(v))).collect()),
    }
}

/// A command payload (a patch) as JSON: like [`to_json`], but "not reported" means `null`, so
/// a patch can clear a field, and integral floats become JSON integers so typed Rust fields
/// (`u32`, `usize`, `i64`) deserialize cleanly from protocol `Value::Num(f64)`.
pub fn patch_to_json(value: &Value) -> serde_json::Value {
    match value {
        Value::Missing(_) => serde_json::Value::Null,
        Value::Num(n) => {
            if n.is_finite()
                && n.fract() == 0.0
                && *n >= -9_007_199_254_740_991.0
                && *n <= 9_007_199_254_740_991.0
            {
                #[allow(clippy::cast_possible_truncation)]
                let i = *n as i64;
                serde_json::Value::Number(serde_json::Number::from(i))
            } else {
                serde_json::Number::from_f64(*n)
                    .map_or(serde_json::Value::Null, serde_json::Value::Number)
            }
        }
        Value::List(v) => serde_json::Value::Array(v.iter().map(patch_to_json).collect()),
        Value::Map(m) => serde_json::Value::Object(
            m.iter()
                .map(|(k, v)| (k.clone(), patch_to_json(v)))
                .collect(),
        ),
        other => to_json(other),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn round_trip() {
        let j = json!({"a": 1.5, "b": [true, "x"], "c": {"d": 2.0}});
        assert_eq!(to_json(&from_json(&j)), j);
        assert_eq!(
            patch_to_json(&from_json(&json!({"x": null, "n": 4.0, "f": 1.5}))),
            json!({"x": null, "n": 4, "f": 1.5})
        );
    }
}

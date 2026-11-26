//! Evaluates one JSON request per stdin line and prints one JSON result per line, against a fixed
//! host. The TypeScript differential test (app/src/expr/differential.test.ts) runs the same
//! inputs through both implementations and compares.
//!
//! Request: `{"kind": "expression" | "template", "src": "..."}`.
//! Result: `{"compile": "<code>", "at": n}` or `{"value": ..., "errors": ["<code>"], "missing": b}`.
#![allow(clippy::print_stdout)]

use std::io::{BufRead, Write};

use opaline_expr::{MapHost, Program, Value};
use serde_json::{Value as Json, json};

fn main() {
    let mut host = MapHost::default();
    host.topics.insert("cpu.load".into(), Value::Num(43.4));
    host.topics.insert(
        "gpu.list".into(),
        Value::List(vec![Value::Str("a".into()), Value::Num(1.0)]),
    );
    host.topics.insert("t".into(), Value::Str("x".into()));
    host.now_ms = Some(1.0e12);
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    for line in std::io::stdin().lock().lines().map_while(Result::ok) {
        let Ok(req) = serde_json::from_str::<Json>(&line) else {
            continue;
        };
        let src = req["src"].as_str().unwrap_or_default();
        let compiled = if req["kind"] == "template" {
            Program::template(src)
        } else {
            Program::expression(src)
        };
        let res = match compiled {
            Err(d) => json!({ "compile": d.code.as_str(), "at": d.at }),
            Ok(p) => {
                let o = p.eval(&host);
                let errors: Vec<&str> = o.errors.iter().map(|e| e.code.as_str()).collect();
                json!({ "value": Json::from(&o.value), "errors": errors, "missing": o.missing })
            }
        };
        if writeln!(out, "{res}").is_err() {
            return;
        }
    }
}

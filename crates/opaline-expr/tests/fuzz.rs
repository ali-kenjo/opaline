//! Hostile input never panics, compiles or not (docs/EXPRESSIONS.md §4: errors never escape).
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use opaline_expr::{MapHost, Program, Value};
use proptest::prelude::*;

fn host() -> MapHost {
    let mut h = MapHost::default();
    h.topics.insert("cpu.load".into(), Value::Num(43.4));
    h.topics.insert(
        "gpu.list".into(),
        Value::List(vec![Value::Str("a".into()), Value::Num(1.0)]),
    );
    h.topics.insert("t".into(), Value::Str("x".into()));
    h.now_ms = Some(1.0e12);
    h
}

/// Strings made of the language's own pieces, so the parser gets past the first token often.
fn tokens() -> impl Strategy<Value = String> {
    let piece = prop_oneof![
        Just("cpu.load"),
        Just("gpu.list"),
        Just("t"),
        Just("[0]"),
        Just("[-1]"),
        Just(".x"),
        Just("1"),
        Just("-0.5"),
        Just("1e308"),
        Just("'s'"),
        Just("'#ff0000'"),
        Just("null"),
        Just("true"),
        Just("+"),
        Just("-"),
        Just("*"),
        Just("/"),
        Just("%"),
        Just("<"),
        Just("=="),
        Just("&&"),
        Just("||"),
        Just("??"),
        Just("!"),
        Just("|"),
        Just("("),
        Just(")"),
        Just(","),
        Just("{"),
        Just("}"),
        Just("round("),
        Just("bytes("),
        Just("duration("),
        Just("mix("),
        Just("pad("),
        Just("join("),
        Just("if("),
        Just("avg(cpu.load, '5m')"),
        Just("max("),
        Just("unit("),
        Just("len("),
        Just("now()"),
    ];
    prop::collection::vec(piece, 0..24).prop_map(|v| v.concat())
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(4000))]

    #[test]
    fn arbitrary_text(s in "\\PC{0,200}") {
        let h = host();
        if let Ok(p) = Program::expression(&s) { let _ = p.eval(&h); }
        if let Ok(p) = Program::template(&s) { let _ = p.eval(&h); }
    }

    #[test]
    fn token_soup(s in tokens()) {
        let h = host();
        if let Ok(p) = Program::expression(&s) {
            let out = p.eval(&h);
            // No NaN or infinity escapes.
            if let Value::Num(x) = out.value { prop_assert!(x.is_finite()); }
        }
        if let Ok(p) = Program::template(&s) {
            prop_assert!(matches!(p.eval(&h).value, Value::Str(_)));
        }
    }
}

#[test]
fn nesting_limit() {
    let h = host();
    let nested = format!("{}1{}", "(".repeat(60), ")".repeat(60));
    assert_eq!(
        Program::expression(&nested).unwrap().eval(&h).value,
        Value::Num(1.0)
    );
    // Operators count as nesting too (`a + b + c` is two levels), so evaluation stays shallow.
    let chain = vec!["1"; 64].join("+");
    assert_eq!(
        Program::expression(&chain).unwrap().eval(&h).value,
        Value::Num(64.0)
    );
    let long = vec!["1"; 66].join("+");
    assert_eq!(
        Program::expression(&long).unwrap_err().code,
        opaline_expr::ErrorCode::TooDeep
    );
    let unary = format!("{}1", "-".repeat(70));
    assert!(Program::expression(&unary).is_err());
}

#[test]
fn paths_and_clock() {
    let p = Program::template("{gpu.list[0] | upper} {until(now() + 5000)}").unwrap();
    assert_eq!(p.paths(), vec!["gpu.list".to_owned()]);
    assert!(p.uses_now());
    assert_eq!(p.eval(&host()).value, Value::Str("A 5".into()));
}

//! The Opaline expression language (docs/EXPRESSIONS.md): a small, safe language for widget
//! bindings, templates, automation rules and conditional styles.
//!
//! Programs are compiled once ([`Program::expression`], [`Program::template`]) and evaluated
//! against a [`Host`] that supplies topic values, the clock, history and the locale. Evaluation
//! never fails: it returns a value (`Null` when something was missing or wrong) and the errors it
//! met. The TypeScript implementation in the layer passes the same corpus (`spec/expressions/`).

mod ast;
mod eval;
mod format;
mod funcs;
mod lexer;
mod parser;
mod value;

use std::fmt;

pub use value::{Type, Value};

/// Longest expression or template, in characters (§3).
pub const MAX_LEN: usize = 4096;
/// Deepest nesting (§3).
pub const MAX_DEPTH: usize = 64;

/// Error codes of the conformance corpus (§8).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ErrorCode {
    Parse,
    UnknownFunction,
    Arity,
    TypeError,
    ChainedComparison,
    TooLong,
    TooDeep,
}

impl ErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Parse => "parse-error",
            Self::UnknownFunction => "unknown-function",
            Self::Arity => "arity",
            Self::TypeError => "type-error",
            Self::ChainedComparison => "chained-comparison",
            Self::TooLong => "too-long",
            Self::TooDeep => "too-deep",
        }
    }
}

/// A compile or run-time error with its position (a character offset into the source).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub code: ErrorCode,
    pub at: usize,
    pub message: String,
}

impl Diagnostic {
    pub(crate) fn new(code: ErrorCode, at: usize, message: &str) -> Self {
        Self {
            code,
            at,
            message: message.to_owned(),
        }
    }
}

impl fmt::Display for Diagnostic {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} at {}: {}", self.code.as_str(), self.at, self.message)
    }
}

impl std::error::Error for Diagnostic {}

/// A step into a topic's value: a map field or a list index (negative counts from the end).
#[derive(Debug, Clone, PartialEq)]
pub enum Key {
    Field(String),
    Index(f64),
}

/// The aggregate a history function asks for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Agg {
    Avg,
    Min,
    Max,
    /// Last value minus first value in the window.
    Delta,
}

/// Number formatting. Arabic formats like English here (core has no ICU data).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Locale {
    #[default]
    En,
    De,
    Ar,
}

impl Locale {
    pub fn from_tag(tag: &str) -> Self {
        match tag.split(['-', '_']).next().unwrap_or_default() {
            "de" => Self::De,
            "ar" => Self::Ar,
            _ => Self::En,
        }
    }
}

/// What a program can see.
pub trait Host {
    /// Whether a topic of this name exists (used to resolve paths by longest prefix, §5).
    fn has_topic(&self, name: &str) -> bool;
    /// The value inside a topic at `keys`; `Null` when anything along the way is missing.
    fn topic(&self, name: &str, keys: &[Key]) -> Value;
    /// The current time in milliseconds since the epoch.
    fn now_ms(&self) -> Option<f64> {
        None
    }
    /// An aggregate over core's history of a path, for a window in seconds.
    fn history(&self, _path: &str, _agg: Agg, _window_secs: f64) -> Option<f64> {
        None
    }
    fn locale(&self) -> Locale {
        Locale::En
    }
    /// Layer only: a date by ICU skeleton, in a time zone (`None` = the system's).
    fn date(&self, _ms: f64, _skeleton: &str, _zone: Option<&str>) -> Option<String> {
        None
    }
    /// Layer only: a color on one of the scheme's ramps, `t` 0 … 1.
    fn ramp(&self, _t: f64, _name: &str) -> Option<String> {
        None
    }
}

/// The result of one evaluation.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Outcome {
    pub value: Value,
    /// Run-time errors (type mismatches in data), each once.
    pub errors: Vec<Diagnostic>,
    /// A path the program read had no value (templates show `—` for it).
    pub missing: bool,
}

/// A compiled expression or template.
#[derive(Debug, Clone)]
pub struct Program {
    body: ast::Body,
}

impl Program {
    /// Compiles an expression (`cpu.load >= 90 && cpu.temp > 80`).
    pub fn expression(src: &str) -> Result<Self, Diagnostic> {
        Ok(Self {
            body: ast::Body::Expr(parser::expression(src)?),
        })
    }

    /// Compiles a template (`"{cpu.load | round}%"`); it always evaluates to a string.
    pub fn template(src: &str) -> Result<Self, Diagnostic> {
        Ok(Self {
            body: ast::Body::Template(parser::template(src)?),
        })
    }

    pub fn eval(&self, host: &dyn Host) -> Outcome {
        eval::run(&self.body, host)
    }

    /// The data paths this program reads, as written (`weather.current.tempC`), for subscribing
    /// and for warning about unknown names.
    pub fn paths(&self) -> Vec<String> {
        let mut out = Vec::new();
        self.body.visit(&mut |e| {
            if let ast::Kind::Path(p) = &e.kind {
                let name = p.segments.join(".");
                if !out.contains(&name) {
                    out.push(name);
                }
            }
        });
        out
    }

    /// Whether the result depends on the clock (`now()`, `until()`).
    pub fn uses_now(&self) -> bool {
        let mut found = false;
        self.body.visit(&mut |e| {
            if let ast::Kind::Call(f, _) = &e.kind {
                found |= matches!(f, funcs::Func::Now | funcs::Func::Until);
            }
        });
        found
    }

    /// The static type of an expression's result (`Any` for templates' holes is irrelevant: a
    /// template is always a string).
    pub fn result_type(&self) -> Type {
        match &self.body {
            ast::Body::Expr(e) => e.ty,
            ast::Body::Template(_) => Type::Str,
        }
    }
}

/// A host over plain values, for tests and simple callers: topics by name, nothing else.
#[derive(Debug, Clone, Default)]
pub struct MapHost {
    pub topics: std::collections::BTreeMap<String, Value>,
    pub now_ms: Option<f64>,
    pub locale: Locale,
}

impl Host for MapHost {
    fn has_topic(&self, name: &str) -> bool {
        self.topics.contains_key(name)
    }

    fn topic(&self, name: &str, keys: &[Key]) -> Value {
        self.topics.get(name).map_or(Value::Null, |v| v.at(keys))
    }

    fn now_ms(&self) -> Option<f64> {
        self.now_ms
    }

    fn locale(&self) -> Locale {
        self.locale
    }
}

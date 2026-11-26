//! Values of the expression language (docs/EXPRESSIONS.md §2): JSON-like, with `null` for "no
//! value".

use std::collections::BTreeMap;

use crate::Key;

#[derive(Debug, Clone, PartialEq, Default)]
pub enum Value {
    #[default]
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    List(Vec<Value>),
    Map(BTreeMap<String, Value>),
}

/// Static types the checker knows (§2). `Any` is a value from data, checked at run time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Type {
    Num,
    Str,
    Bool,
    Null,
    Any,
}

impl Value {
    /// A number, or `Null` when it isn't finite (no NaN or infinity escapes, §2).
    pub fn num(x: f64) -> Self {
        if x.is_finite() {
            Self::Num(x)
        } else {
            Self::Null
        }
    }

    pub fn is_null(&self) -> bool {
        matches!(self, Self::Null)
    }

    pub fn as_num(&self) -> Option<f64> {
        match self {
            Self::Num(x) => Some(*x),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Self::Str(s) => Some(s),
            _ => None,
        }
    }

    pub fn type_of(&self) -> Type {
        match self {
            Self::Null => Type::Null,
            Self::Bool(_) => Type::Bool,
            Self::Num(_) => Type::Num,
            Self::Str(_) => Type::Str,
            Self::List(_) | Self::Map(_) => Type::Any,
        }
    }

    /// One step inside: a map field or a list index (negative from the end). A miss is `Null`.
    pub fn get(&self, key: &Key) -> Option<&Self> {
        match (self, key) {
            (Self::Map(m), Key::Field(f)) => m.get(f),
            (Self::List(l), Key::Index(i)) => {
                if i.fract() != 0.0 || !i.is_finite() {
                    return None;
                }
                let n = l.len() as f64;
                let i = if *i < 0.0 { n + i } else { *i };
                if i < 0.0 || i >= n {
                    return None;
                }
                l.get(i as usize)
            }
            _ => None,
        }
    }

    /// The value at `keys`, cloned; `Null` on a miss.
    pub fn at(&self, keys: &[Key]) -> Self {
        let mut v = self;
        for k in keys {
            match v.get(k) {
                Some(next) => v = next,
                None => return Self::Null,
            }
        }
        v.clone()
    }

    /// Value equality (§4): numbers by value, lists and maps deeply, `null == null`.
    pub fn same(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Null, Self::Null) => true,
            (Self::Bool(a), Self::Bool(b)) => a == b,
            (Self::Num(a), Self::Num(b)) => a == b,
            (Self::Str(a), Self::Str(b)) => a == b,
            (Self::List(a), Self::List(b)) => {
                a.len() == b.len() && a.iter().zip(b).all(|(x, y)| x.same(y))
            }
            (Self::Map(a), Self::Map(b)) => {
                a.len() == b.len() && a.iter().all(|(k, v)| b.get(k).is_some_and(|w| v.same(w)))
            }
            _ => false,
        }
    }
}

impl From<&serde_json::Value> for Value {
    fn from(j: &serde_json::Value) -> Self {
        match j {
            serde_json::Value::Null => Self::Null,
            serde_json::Value::Bool(b) => Self::Bool(*b),
            serde_json::Value::Number(n) => n.as_f64().map_or(Self::Null, Self::num),
            serde_json::Value::String(s) => Self::Str(s.clone()),
            serde_json::Value::Array(a) => Self::List(a.iter().map(Self::from).collect()),
            serde_json::Value::Object(o) => {
                Self::Map(o.iter().map(|(k, v)| (k.clone(), Self::from(v))).collect())
            }
        }
    }
}

impl From<&Value> for serde_json::Value {
    fn from(v: &Value) -> Self {
        match v {
            Value::Null => Self::Null,
            Value::Bool(b) => Self::Bool(*b),
            Value::Num(x) => serde_json::Number::from_f64(*x).map_or(Self::Null, Self::Number),
            Value::Str(s) => Self::String(s.clone()),
            Value::List(a) => Self::Array(a.iter().map(Self::from).collect()),
            Value::Map(m) => {
                Self::Object(m.iter().map(|(k, v)| (k.clone(), Self::from(v))).collect())
            }
        }
    }
}

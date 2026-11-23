//! D-Bus property values as plain Rust values, so providers parse them with pure functions
//! that tests can drive from captured `busctl --json` replies (fixtures/*/dbus/*.json).

use std::collections::{BTreeMap, HashMap};

use zbus::OwnedVariant;

#[derive(Debug, Clone, PartialEq)]
pub enum Prop {
    Str(String),
    Num(f64),
    Bool(bool),
    Bytes(Vec<u8>),
    Strs(Vec<String>),
    /// Anything else (structs, dicts); providers that need it read it from the variant.
    Other,
}

pub type Props = HashMap<String, Prop>;
/// `GetManagedObjects`: object path → interface → properties.
pub type Objects = BTreeMap<String, HashMap<String, Props>>;

impl Prop {
    pub fn from_variant(v: &OwnedVariant) -> Self {
        if let Ok(b) = bool::try_from(v) {
            return Self::Bool(b);
        }
        macro_rules! num {
            ($($t:ty),*) => {$(
                if let Ok(n) = <$t>::try_from(v) {
                    return Self::Num(n as f64);
                }
            )*};
        }
        num!(f64, u64, i64, u32, i32, u16, i16, u8);
        if let Ok(s) = <&str>::try_from(v) {
            return Self::Str(s.to_owned());
        }
        if let Ok(p) = <&zbus::ObjectPath<'_>>::try_from(v) {
            return Self::Str(p.as_str().to_owned());
        }
        if let Ok(cloned) = v.try_clone()
            && let Ok(bytes) = Vec::<u8>::try_from(cloned)
        {
            return Self::Bytes(bytes);
        }
        if let Ok(cloned) = v.try_clone()
            && let Ok(strs) = Vec::<String>::try_from(cloned)
        {
            return Self::Strs(strs);
        }
        Self::Other
    }

    /// Converts one `{"type": "...", "data": ...}` node of `busctl --json` output.
    pub fn from_busctl(node: &serde_json::Value) -> Self {
        let sig = node.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let data = node.get("data").unwrap_or(&serde_json::Value::Null);
        match sig {
            "b" => Self::Bool(data.as_bool().unwrap_or(false)),
            "s" | "o" | "g" => Self::Str(data.as_str().unwrap_or("").to_owned()),
            "ay" => Self::Bytes(
                data.as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|b| b.as_u64().and_then(|b| u8::try_from(b).ok()))
                            .collect()
                    })
                    .unwrap_or_default(),
            ),
            "as" | "ao" => Self::Strs(
                data.as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|s| s.as_str().map(str::to_owned))
                            .collect()
                    })
                    .unwrap_or_default(),
            ),
            "y" | "n" | "q" | "i" | "u" | "x" | "t" | "d" => {
                data.as_f64().map_or(Self::Other, Self::Num)
            }
            _ => Self::Other,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Self::Str(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Self::Num(n) => Some(*n),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Self::Bool(b) => Some(*b),
            _ => None,
        }
    }

    /// A NUL-terminated byte string (`ay`), as UDisks2 uses for device paths and NM for SSIDs.
    pub fn as_bytes_str(&self) -> Option<String> {
        match self {
            Self::Bytes(b) => {
                let end = b.iter().position(|c| *c == 0).unwrap_or(b.len());
                Some(String::from_utf8_lossy(&b[..end]).into_owned())
            }
            Self::Str(s) => Some(s.clone()),
            _ => None,
        }
    }
}

pub fn from_variants(map: &HashMap<String, OwnedVariant>) -> Props {
    map.iter()
        .map(|(k, v)| (k.clone(), Prop::from_variant(v)))
        .collect()
}

/// Shorthand accessors on a property map.
pub trait PropsExt {
    fn str(&self, key: &str) -> Option<&str>;
    fn num(&self, key: &str) -> Option<f64>;
    fn flag(&self, key: &str) -> Option<bool>;
    fn strs(&self, key: &str) -> Vec<String>;
}

impl PropsExt for Props {
    fn str(&self, key: &str) -> Option<&str> {
        self.get(key).and_then(Prop::as_str)
    }

    fn num(&self, key: &str) -> Option<f64> {
        self.get(key).and_then(Prop::as_f64)
    }

    fn flag(&self, key: &str) -> Option<bool> {
        self.get(key).and_then(Prop::as_bool)
    }

    fn strs(&self, key: &str) -> Vec<String> {
        match self.get(key) {
            Some(Prop::Strs(v)) => v.clone(),
            _ => Vec::new(),
        }
    }
}

/// Test helpers that read the captured replies.
#[cfg(test)]
#[allow(clippy::panic)]
pub mod fixture {
    use super::*;

    fn load(machine: &str, name: &str) -> serde_json::Value {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures")
            .join(machine)
            .join("dbus")
            .join(format!("{name}.json"));
        let text =
            std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
    }

    fn props_of(node: &serde_json::Value) -> Props {
        node.as_object()
            .map(|o| {
                o.iter()
                    .map(|(k, v)| (k.clone(), Prop::from_busctl(v)))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// A `GetAll` reply.
    pub fn get_all(machine: &str, name: &str) -> Props {
        props_of(&load(machine, name)["data"][0])
    }

    /// A `GetManagedObjects` reply.
    pub fn objects(machine: &str, name: &str) -> Objects {
        let json = load(machine, name);
        json["data"][0]
            .as_object()
            .map(|o| {
                o.iter()
                    .map(|(path, ifaces)| {
                        let ifaces = ifaces
                            .as_object()
                            .map(|i| {
                                i.iter()
                                    .map(|(name, p)| (name.clone(), props_of(p)))
                                    .collect()
                            })
                            .unwrap_or_default();
                        (path.clone(), ifaces)
                    })
                    .collect()
            })
            .unwrap_or_default()
    }
}

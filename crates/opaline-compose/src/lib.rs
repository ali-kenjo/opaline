//! Widget compositions (docs/COMPOSITION.md): the model ([`Composition`]), its JSON Schema
//! ([`schema`]) and validation ([`validate`]) of everything the schema can't say: unique ids,
//! limits that keep a hostile file cheap, and every expression compiled and type-checked.

mod model;

use std::collections::{BTreeMap, HashSet};

use opaline_expr::Program;

pub use model::*;

/// At most this many layouts per composition.
pub const MAX_LAYOUTS: usize = 16;
/// At most this many nodes in all layouts together.
pub const MAX_NODES: usize = 1024;
/// At most this many children per container.
pub const MAX_CHILDREN: usize = 64;
/// At most this deep (root = 1).
pub const MAX_DEPTH: usize = 24;
/// At most this many bindings.
pub const MAX_BINDINGS: usize = 64;

/// Something wrong in a composition, at a JSON pointer (`/layouts/0/root/children/1/text`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Problem {
    pub at: String,
    pub message: String,
    /// For an expression: its error code and character position.
    pub expr: Option<(opaline_expr::ErrorCode, usize)>,
}

impl std::fmt::Display for Problem {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.at, self.message)
    }
}

/// The JSON Schema of the format (`spec/composition.schema.json`).
pub fn schema() -> serde_json::Value {
    serde_json::Value::from(schemars::schema_for!(Composition))
}

/// Deepest JSON nesting a file may have, checked on the raw text before parsing: the model's
/// flattened, tagged enums make serde recurse a lot per level, so a deep file must never reach it.
pub const MAX_JSON_DEPTH: usize = 2 * MAX_DEPTH + 16;

/// Largest composition file, in bytes.
pub const MAX_FILE: usize = 1 << 20;

/// Parses and validates a composition file.
pub fn parse(json: &str) -> Result<Composition, Vec<Problem>> {
    let refuse = |message: String| {
        Err(vec![Problem {
            at: String::new(),
            message,
            expr: None,
        }])
    };
    if json.len() > MAX_FILE {
        return refuse(format!("larger than {MAX_FILE} bytes"));
    }
    if json_depth(json) > MAX_JSON_DEPTH {
        return refuse(format!("nested deeper than {MAX_JSON_DEPTH} JSON levels"));
    }
    let c: Composition = serde_json::from_str(json).map_err(|e| {
        vec![Problem {
            at: String::new(),
            message: format!("not a composition: {e}"),
            expr: None,
        }]
    })?;
    let problems = validate(&c);
    if problems.is_empty() {
        Ok(c)
    } else {
        Err(problems)
    }
}

/// Everything wrong with a composition; empty when it's fine.
pub fn validate(c: &Composition) -> Vec<Problem> {
    let mut v = Validator::default();
    if c.version != VERSION {
        v.problem(
            "/version",
            &format!("version {} isn't supported (expected {VERSION})", c.version),
        );
    }
    if c.layouts.is_empty() {
        v.problem("/layouts", "a composition needs at least one layout");
    }
    if c.layouts.len() > MAX_LAYOUTS {
        v.problem("/layouts", &format!("more than {MAX_LAYOUTS} layouts"));
    }
    if c.bindings.len() > MAX_BINDINGS {
        v.problem("/bindings", &format!("more than {MAX_BINDINGS} bindings"));
    }
    v.binding_names = c.bindings.keys().cloned().collect();
    let mut reads: BTreeMap<&str, Vec<String>> = BTreeMap::new();
    for (name, e) in &c.bindings {
        let at = format!("/bindings/{}", pointer_escape(name));
        if !is_name(name) {
            v.problem(
                &at,
                "a binding name is letters, digits and _ and starts with a letter",
            );
        }
        reads.insert(name, v.source(&at, &e.0, Source::Expr, Scope::Binding));
    }
    if let Some(name) = first_cycle(&reads) {
        v.problem(
            &format!("/bindings/{}", pointer_escape(name)),
            "bindings read each other in a circle",
        );
    }
    for (i, layout) in c.layouts.iter().enumerate() {
        let at = format!("/layouts/{i}");
        for (key, n) in [("minW", layout.min_w), ("minH", layout.min_h)] {
            if n.is_some_and(|n| n == 0 || n > 16) {
                v.problem(&format!("{at}/{key}"), "grid cells are 1 … 16");
            }
        }
        v.ids.clear();
        v.node(&format!("{at}/root"), &layout.root, 1, false);
    }
    v.problems
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Source {
    Expr,
    Template,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Scope {
    Binding,
    Node { in_list: bool },
}

#[derive(Default)]
struct Validator {
    problems: Vec<Problem>,
    ids: HashSet<String>,
    binding_names: HashSet<String>,
    nodes: usize,
}

fn is_name(s: &str) -> bool {
    let mut cs = s.chars();
    cs.next().is_some_and(|c| c.is_ascii_alphabetic())
        && cs.all(|c| c.is_ascii_alphanumeric() || c == '_')
        && s.len() <= 32
}

fn is_id(s: &str) -> bool {
    let mut cs = s.chars();
    cs.next().is_some_and(|c| c.is_ascii_lowercase())
        && cs.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && s.len() <= 32
}

/// A plain data path: dotted names (`cpu.load`, `gpu.0.load`).
fn is_path(s: &str) -> bool {
    s.len() <= 128
        && s.split('.').all(|seg| {
            !seg.is_empty() && seg.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        })
}

/// A window: a positive number and s, m, h or d (`'30s'`, `'5m'`).
fn is_window(s: &str) -> bool {
    let Some(unit) = s.chars().last() else {
        return false;
    };
    let num = &s[..s.len() - unit.len_utf8()];
    matches!(unit, 's' | 'm' | 'h' | 'd')
        && num.parse::<f64>().is_ok_and(|n| n > 0.0 && n.is_finite())
}

fn is_kebab(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 48
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// The deepest `[`/`{` nesting of a JSON text (strings skipped).
fn json_depth(json: &str) -> usize {
    let (mut depth, mut max, mut in_str, mut esc) = (0usize, 0usize, false, false);
    for b in json.bytes() {
        if in_str {
            match (esc, b) {
                (true, _) => esc = false,
                (false, b'\\') => esc = true,
                (false, b'"') => in_str = false,
                _ => {}
            }
            continue;
        }
        match b {
            b'"' => in_str = true,
            b'[' | b'{' => {
                depth += 1;
                max = max.max(depth);
            }
            b']' | b'}' => depth = depth.saturating_sub(1),
            _ => {}
        }
    }
    max
}

/// A binding that reaches itself through the bindings it reads.
fn first_cycle<'a>(reads: &BTreeMap<&'a str, Vec<String>>) -> Option<&'a str> {
    fn visits(
        reads: &BTreeMap<&str, Vec<String>>,
        from: &str,
        target: &str,
        seen: &mut HashSet<String>,
    ) -> bool {
        reads.get(from).is_some_and(|next| {
            next.iter()
                .any(|n| n == target || (seen.insert(n.clone()) && visits(reads, n, target, seen)))
        })
    }
    reads
        .keys()
        .copied()
        .find(|name| visits(reads, name, name, &mut HashSet::new()))
}

/// RFC 6901: `~` → `~0`, `/` → `~1`.
fn pointer_escape(s: &str) -> String {
    s.replace('~', "~0").replace('/', "~1")
}

impl Validator {
    fn problem(&mut self, at: &str, message: &str) {
        self.problems.push(Problem {
            at: at.to_owned(),
            message: message.to_owned(),
            expr: None,
        });
    }

    /// Checks one expression or template; returns the bindings it reads.
    fn source(&mut self, at: &str, src: &str, kind: Source, scope: Scope) -> Vec<String> {
        let compiled = match kind {
            Source::Expr => Program::expression(src),
            Source::Template => Program::template(src),
        };
        let program = match compiled {
            Ok(p) => p,
            Err(d) => {
                self.problems.push(Problem {
                    at: at.to_owned(),
                    message: d.message.clone(),
                    expr: Some((d.code, d.at)),
                });
                return Vec::new();
            }
        };
        let mut binds = Vec::new();
        for path in program.paths() {
            let first = path.split('.').next().unwrap_or_default();
            match first {
                "$item" | "$index" if scope != (Scope::Node { in_list: true }) => {
                    self.problem(at, &format!("{first} is only known inside a list's item"));
                }
                "bind" => {
                    let name = path.split('.').nth(1).unwrap_or_default();
                    if self.binding_names.contains(name) {
                        binds.push(name.to_owned());
                    } else {
                        self.problem(at, &format!("no binding named {name:?}"));
                    }
                }
                _ => {}
            }
        }
        binds
    }

    fn node(&mut self, at: &str, n: &Node, depth: usize, in_list: bool) {
        self.nodes += 1;
        if self.nodes == MAX_NODES + 1 {
            self.problem(at, &format!("more than {MAX_NODES} nodes"));
        }
        if self.nodes > MAX_NODES {
            return;
        }
        if depth > MAX_DEPTH {
            self.problem(at, &format!("nested deeper than {MAX_DEPTH}"));
            return;
        }
        if !is_id(&n.id) {
            self.problem(
                &format!("{at}/id"),
                "an id is a-z, 0-9 and -, starts with a letter, at most 32",
            );
        } else if !self.ids.insert(n.id.clone()) {
            self.problem(
                &format!("{at}/id"),
                &format!("id {:?} is used twice in this layout", n.id),
            );
        }
        if n.priority.is_some_and(|p| p > 100) {
            self.problem(&format!("{at}/priority"), "priority is 0 … 100");
        }
        let scope = Scope::Node { in_list };
        if let Some(e) = &n.visible {
            self.source(&format!("{at}/visible"), &e.0, Source::Expr, scope);
        }
        if let Some(t) = &n.label {
            self.source(&format!("{at}/label"), &t.0, Source::Template, scope);
        }
        self.kind(at, &n.kind, scope);
        let children = n.kind.children();
        if children.len() > MAX_CHILDREN {
            self.problem(
                &format!("{at}/children"),
                &format!("more than {MAX_CHILDREN} children"),
            );
        }
        let child_in_list = in_list || matches!(n.kind, Kind::List { .. });
        for (key, i, child) in children.into_iter().take(MAX_CHILDREN) {
            let at = match i {
                Some(i) => format!("{at}/{key}/{i}"),
                None => format!("{at}/{key}"),
            };
            self.node(&at, child, depth + 1, child_in_list);
        }
    }

    fn kind(&mut self, at: &str, k: &Kind, scope: Scope) {
        let src = |v: &mut Self, key: &str, s: &str, kind: Source| {
            v.source(&format!("{at}/{key}"), s, kind, scope);
        };
        let spacing = |v: &mut Self, key: &str, n: Option<u8>| {
            if n.is_some_and(|n| n > 8) {
                v.problem(
                    &format!("{at}/{key}"),
                    "spacing is a step 0 … 8 of the 4-pt scale",
                );
            }
        };
        use Source::{Expr as E, Template as T};
        match k {
            Kind::Stack { boxing, .. }
            | Kind::Row { boxing, .. }
            | Kind::Column { boxing, .. }
            | Kind::Overlay { boxing, .. } => {
                spacing(self, "gap", boxing.gap);
                spacing(self, "padding", boxing.padding);
            }
            Kind::Grid {
                columns, boxing, ..
            } => {
                if !(1..=12).contains(columns) {
                    self.problem(&format!("{at}/columns"), "a grid has 1 … 12 columns");
                }
                spacing(self, "gap", boxing.gap);
                spacing(self, "padding", boxing.padding);
            }
            Kind::Spacer { .. } | Kind::Divider { .. } => {}
            Kind::Text { text, shorter, .. } => {
                src(self, "text", &text.0, T);
                for (i, s) in shorter.iter().enumerate() {
                    src(self, &format!("shorter/{i}"), &s.0, T);
                }
            }
            Kind::Number {
                value, text, unit, ..
            } => {
                src(self, "value", &value.0, E);
                if let Some(t) = text {
                    src(self, "text", &t.0, T);
                }
                if let Some(u) = unit {
                    src(self, "unit", &u.0, T);
                }
            }
            Kind::Icon { icon, filled } => {
                src(self, "icon", &icon.0, T);
                if let Some(f) = filled {
                    src(self, "filled", &f.0, E);
                }
            }
            Kind::Image { src: s, .. } => src(self, "src", &s.0, E),
            Kind::Shape { shape, color } => {
                src(self, "shape", &shape.0, T);
                if let Some(c) = color {
                    src(self, "color", &c.0, E);
                }
            }
            Kind::Ring {
                value,
                sweep,
                color,
                ..
            } => {
                src(self, "value", &value.0, E);
                if sweep.is_some_and(|s| s == 0 || s > 360) {
                    self.problem(&format!("{at}/sweep"), "sweep is 1 … 360 degrees");
                }
                if let Some(c) = color {
                    src(self, "color", &c.0, E);
                }
            }
            Kind::Bar { value, color, .. } => {
                src(self, "value", &value.0, E);
                if let Some(c) = color {
                    src(self, "color", &c.0, E);
                }
            }
            Kind::Chart {
                values,
                history,
                min,
                max,
                ..
            } => {
                match (values, history) {
                    (Some(e), None) => src(self, "values", &e.0, E),
                    (None, Some(h)) => {
                        if !(is_path(&h.path) && is_window(&h.window)) {
                            self.problem(
                                &format!("{at}/history"),
                                "history is a data path and a window such as '5m'",
                            );
                        }
                    }
                    _ => self.problem(at, "a chart has either values or history"),
                }
                if let (Some(a), Some(b)) = (min, max)
                    && a >= b
                {
                    self.problem(&format!("{at}/max"), "max must be above min");
                }
            }
            Kind::Heatmap { values, columns } => {
                src(self, "values", &values.0, E);
                if *columns == 0 {
                    self.problem(
                        &format!("{at}/columns"),
                        "a heatmap has at least one column",
                    );
                }
            }
            Kind::List { items, gap, .. } => {
                src(self, "items", &items.0, E);
                spacing(self, "gap", *gap);
            }
            Kind::Progress { value, .. } => src(self, "value", &value.0, E),
            Kind::Canvas { visual, params } => {
                if !is_kebab(visual) {
                    self.problem(&format!("{at}/visual"), "a visual's name is kebab-case");
                }
                for (k, e) in params {
                    src(self, &format!("params/{}", pointer_escape(k)), &e.0, E);
                }
            }
            Kind::Button {
                text,
                icon,
                command,
                confirm,
                enabled,
            } => {
                src(self, "text", &text.0, T);
                if let Some(i) = icon {
                    src(self, "icon", &i.0, T);
                }
                if let Some(c) = confirm {
                    src(self, "confirm", &c.0, T);
                }
                if let Some(e) = enabled {
                    src(self, "enabled", &e.0, E);
                }
                self.command(&format!("{at}/command"), command, scope);
            }
            Kind::Toggle {
                value,
                command,
                text,
            } => {
                src(self, "value", &value.0, E);
                if let Some(t) = text {
                    src(self, "text", &t.0, T);
                }
                self.command(&format!("{at}/command"), command, scope);
            }
            Kind::Slider {
                value,
                min,
                max,
                step,
                command,
            } => {
                src(self, "value", &value.0, E);
                if !(min.is_finite() && max.is_finite() && min < max) {
                    self.problem(&format!("{at}/max"), "max must be above min");
                }
                if !(step.is_finite() && *step > 0.0) {
                    self.problem(&format!("{at}/step"), "step must be above 0");
                }
                self.command(&format!("{at}/command"), command, scope);
            }
            Kind::Input {
                value,
                command,
                placeholder,
                max_length,
            } => {
                src(self, "value", &value.0, E);
                if let Some(p) = placeholder {
                    src(self, "placeholder", &p.0, T);
                }
                if *max_length == 0 || *max_length > 4096 {
                    self.problem(&format!("{at}/maxLength"), "maxLength is 1 … 4096");
                }
                self.command(&format!("{at}/command"), command, scope);
            }
            Kind::Plugin { plugin, props } => {
                if !is_kebab(plugin) {
                    self.problem(&format!("{at}/plugin"), "a plugin's id is kebab-case");
                }
                for (k, e) in props {
                    src(self, &format!("props/{}", pointer_escape(k)), &e.0, E);
                }
            }
        }
    }

    fn command(&mut self, at: &str, c: &CommandRef, scope: Scope) {
        if !is_kebab(&c.cmd) {
            self.problem(&format!("{at}/cmd"), "a command name is kebab-case");
        }
        for (k, e) in &c.args {
            if !is_name(k) {
                self.problem(&format!("{at}/args"), &format!("bad argument name {k:?}"));
            }
            self.source(
                &format!("{at}/args/{}", pointer_escape(k)),
                &e.0,
                Source::Expr,
                scope,
            );
        }
    }
}

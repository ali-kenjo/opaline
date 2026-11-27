//! Bounded RFC 9535 JSONPath evaluator for HTTP/JSON and File custom sources (brief §4.4,
//! PLAN-2 task 6.3).
//!
//! Supports root `$`, dot & bracket member access (`.foo`, `['foo.bar']`), array indices
//! (including negative indices `[-1]`), wildcards (`.*`, `[*]`), array slices (`[0:5:2]`),
//! unions (`[0,2]`, `['a','b']`), recursive descent (`..name`, `..[*]`), and comparison/existence
//! filters (`[?@.active == true]`, `[?@.count >= 5]`, `[?@.a && @.b]`).

use serde_json::Value;

const MAX_PATH_LEN: usize = 512;
const MAX_RESULTS: usize = 4096;
const MAX_DEPTH: usize = 64;

#[derive(Debug, Clone, PartialEq)]
enum Segment {
    Child(Vec<Selector>),
    Descendant(Vec<Selector>),
}

#[derive(Debug, Clone, PartialEq)]
enum Selector {
    Name(String),
    Wildcard,
    Index(isize),
    Slice {
        start: Option<isize>,
        end: Option<isize>,
        step: isize,
    },
    Filter(FilterExpr),
}

#[derive(Debug, Clone, PartialEq)]
enum FilterExpr {
    And(Box<FilterExpr>, Box<FilterExpr>),
    Or(Box<FilterExpr>, Box<FilterExpr>),
    Exists(Vec<String>),
    Cmp {
        path: Vec<String>,
        op: CmpOp,
        rhs: FilterLiteral,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CmpOp {
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}

#[derive(Debug, Clone, PartialEq)]
enum FilterLiteral {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
}

/// Evaluates an RFC 9535 JSONPath expression against `root`, returning all matched values.
pub fn select(root: &Value, path: &str) -> Result<Vec<Value>, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed == "$" {
        return Ok(vec![root.clone()]);
    }
    if trimmed.len() > MAX_PATH_LEN {
        return Err("jsonpath too long".into());
    }
    let segments = parse_path(trimmed)?;
    let mut current: Vec<&Value> = vec![root];

    for seg in &segments {
        let mut next: Vec<&Value> = Vec::new();
        match seg {
            Segment::Child(selectors) => {
                for node in &current {
                    apply_selectors(node, selectors, &mut next)?;
                }
            }
            Segment::Descendant(selectors) => {
                for node in &current {
                    collect_descendants(node, selectors, 0, &mut next)?;
                }
            }
        }
        current = next;
    }

    Ok(current.into_iter().cloned().collect())
}

/// Convenience helper: if the JSONPath matches exactly one node (common for scalar extraction),
/// unwraps it; if multiple nodes match, returns a JSON array; if none match, returns `Value::Null`.
pub fn select_one_or_array(root: &Value, path: &str) -> Result<Value, String> {
    let mut matches = select(root, path)?;
    match matches.len() {
        0 => Ok(Value::Null),
        1 => Ok(matches.remove(0)),
        _ => Ok(Value::Array(matches)),
    }
}

fn push_bounded<'a>(out: &mut Vec<&'a Value>, val: &'a Value) -> Result<(), String> {
    if out.len() >= MAX_RESULTS {
        return Err("jsonpath result limit exceeded".into());
    }
    out.push(val);
    Ok(())
}

fn collect_descendants<'a>(
    node: &'a Value,
    selectors: &[Selector],
    depth: usize,
    out: &mut Vec<&'a Value>,
) -> Result<(), String> {
    if depth > MAX_DEPTH {
        return Ok(());
    }
    apply_selectors(node, selectors, out)?;
    match node {
        Value::Object(map) => {
            for v in map.values() {
                collect_descendants(v, selectors, depth + 1, out)?;
            }
        }
        Value::Array(arr) => {
            for v in arr {
                collect_descendants(v, selectors, depth + 1, out)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn apply_selectors<'a>(
    node: &'a Value,
    selectors: &[Selector],
    out: &mut Vec<&'a Value>,
) -> Result<(), String> {
    for sel in selectors {
        match sel {
            Selector::Name(key) => {
                if let Value::Object(map) = node
                    && let Some(v) = map.get(key)
                {
                    push_bounded(out, v)?;
                }
            }
            Selector::Wildcard => match node {
                Value::Object(map) => {
                    for v in map.values() {
                        push_bounded(out, v)?;
                    }
                }
                Value::Array(arr) => {
                    for v in arr {
                        push_bounded(out, v)?;
                    }
                }
                _ => {}
            },
            Selector::Index(idx) => {
                if let Value::Array(arr) = node
                    && let Some(i) = normalize_index(*idx, arr.len())
                    && let Some(v) = arr.get(i)
                {
                    push_bounded(out, v)?;
                }
            }
            Selector::Slice { start, end, step } => {
                if let Value::Array(arr) = node {
                    apply_slice(arr, *start, *end, *step, out)?;
                }
            }
            Selector::Filter(expr) => match node {
                Value::Array(arr) => {
                    for item in arr {
                        if eval_filter(item, expr) {
                            push_bounded(out, item)?;
                        }
                    }
                }
                Value::Object(map) => {
                    for item in map.values() {
                        if eval_filter(item, expr) {
                            push_bounded(out, item)?;
                        }
                    }
                }
                _ => {}
            },
        }
    }
    Ok(())
}

fn normalize_index(idx: isize, len: usize) -> Option<usize> {
    let len_i = isize::try_from(len).ok()?;
    let resolved = if idx < 0 { len_i + idx } else { idx };
    if resolved >= 0 && resolved < len_i {
        usize::try_from(resolved).ok()
    } else {
        None
    }
}

fn apply_slice<'a>(
    arr: &'a [Value],
    start: Option<isize>,
    end: Option<isize>,
    step: isize,
    out: &mut Vec<&'a Value>,
) -> Result<(), String> {
    if step == 0 {
        return Ok(());
    }
    let Ok(len) = isize::try_from(arr.len()) else {
        return Ok(());
    };
    let norm = |i: isize| if i < 0 { len + i } else { i };
    if step > 0 {
        let mut i = start.map_or(0, norm).clamp(0, len);
        let bound = end.map_or(len, norm).clamp(0, len);
        while i < bound {
            if let Ok(u) = usize::try_from(i)
                && let Some(v) = arr.get(u)
            {
                push_bounded(out, v)?;
            }
            i += step;
        }
    } else {
        let mut i = start.map_or(len - 1, norm).clamp(-1, len - 1);
        let bound = end.map_or(-1, norm).clamp(-1, len - 1);
        while i > bound {
            if let Ok(u) = usize::try_from(i)
                && let Some(v) = arr.get(u)
            {
                push_bounded(out, v)?;
            }
            i += step;
        }
    }
    Ok(())
}

fn eval_filter(item: &Value, expr: &FilterExpr) -> bool {
    match expr {
        FilterExpr::And(a, b) => eval_filter(item, a) && eval_filter(item, b),
        FilterExpr::Or(a, b) => eval_filter(item, a) || eval_filter(item, b),
        FilterExpr::Exists(path) => lookup_rel(item, path).is_some_and(|v| match v {
            Value::Null => false,
            Value::Bool(b) => *b,
            _ => true,
        }),
        FilterExpr::Cmp { path, op, rhs } => {
            let Some(lhs) = lookup_rel(item, path) else {
                return false;
            };
            compare_val(lhs, *op, rhs)
        }
    }
}

fn lookup_rel<'a>(mut cur: &'a Value, path: &[String]) -> Option<&'a Value> {
    for key in path {
        cur = cur.get(key)?;
    }
    Some(cur)
}

fn compare_val(lhs: &Value, op: CmpOp, rhs: &FilterLiteral) -> bool {
    match (lhs, rhs) {
        (Value::Null, FilterLiteral::Null) => matches!(op, CmpOp::Eq | CmpOp::Le | CmpOp::Ge),
        (Value::Bool(a), FilterLiteral::Bool(b)) => match op {
            CmpOp::Eq => a == b,
            CmpOp::Ne => a != b,
            _ => false,
        },
        (Value::Number(a), FilterLiteral::Num(b)) => {
            let Some(af) = a.as_f64() else {
                return false;
            };
            match op {
                CmpOp::Eq => (af - b).abs() < f64::EPSILON,
                CmpOp::Ne => (af - b).abs() >= f64::EPSILON,
                CmpOp::Lt => af < *b,
                CmpOp::Le => af <= *b,
                CmpOp::Gt => af > *b,
                CmpOp::Ge => af >= *b,
            }
        }
        (Value::String(a), FilterLiteral::Str(b)) => match op {
            CmpOp::Eq => a == b,
            CmpOp::Ne => a != b,
            CmpOp::Lt => a < b,
            CmpOp::Le => a <= b,
            CmpOp::Gt => a > b,
            CmpOp::Ge => a >= b,
        },
        _ => matches!(op, CmpOp::Ne),
    }
}

struct Parser<'a> {
    bytes: &'a [u8],
    src: &'a str,
    pos: usize,
}

impl<'a> Parser<'a> {
    fn new(src: &'a str) -> Self {
        Self {
            bytes: src.as_bytes(),
            src,
            pos: 0,
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.pos += 1;
        }
    }

    fn starts_with(&self, s: &str) -> bool {
        self.src[self.pos..].starts_with(s)
    }

    fn parse_ident(&mut self) -> Result<String, String> {
        let start = self.pos;
        while let Some(c) = self.src[self.pos..].chars().next() {
            if c.is_alphanumeric() || c == '_' || c == '-' {
                self.pos += c.len_utf8();
            } else {
                break;
            }
        }
        if self.pos == start {
            return Err(format!("expected member name at byte {}", self.pos));
        }
        Ok(self.src[start..self.pos].to_owned())
    }

    fn parse_quoted(&mut self) -> Result<String, String> {
        let quote = self.peek().ok_or("expected quote")?;
        self.pos += 1;
        let mut out = String::new();
        while let Some(c) = self.src[self.pos..].chars().next() {
            self.pos += c.len_utf8();
            if c as u32 == u32::from(quote) {
                return Ok(out);
            }
            if c == '\\' {
                let esc = self.src[self.pos..]
                    .chars()
                    .next()
                    .ok_or("unterminated escape")?;
                self.pos += esc.len_utf8();
                match esc {
                    'n' => out.push('\n'),
                    'r' => out.push('\r'),
                    't' => out.push('\t'),
                    other => out.push(other),
                }
            } else {
                out.push(c);
            }
        }
        Err("unterminated string literal in jsonpath".into())
    }

    fn parse_int(&mut self) -> Result<isize, String> {
        let start = self.pos;
        if self.peek() == Some(b'-') {
            self.pos += 1;
        }
        let digits_start = self.pos;
        while matches!(self.peek(), Some(b'0'..=b'9')) {
            self.pos += 1;
        }
        if self.pos == digits_start {
            return Err(format!("expected integer at byte {start}"));
        }
        self.src[start..self.pos]
            .parse::<isize>()
            .map_err(|_| "invalid integer in jsonpath".into())
    }

    fn parse_bracket_selectors(&mut self) -> Result<Vec<Selector>, String> {
        if self.peek() != Some(b'[') {
            return Err("expected '['".into());
        }
        self.pos += 1;
        let mut selectors = Vec::new();
        loop {
            self.skip_ws();
            let sel = match self.peek() {
                Some(b'*') => {
                    self.pos += 1;
                    Selector::Wildcard
                }
                Some(b'\'' | b'"') => Selector::Name(self.parse_quoted()?),
                Some(b'?') => {
                    self.pos += 1;
                    Selector::Filter(self.parse_filter_or()?)
                }
                Some(b':' | b'-' | b'0'..=b'9') => self.parse_index_or_slice()?,
                _ => return Err(format!("unexpected token in '[...]' at byte {}", self.pos)),
            };
            selectors.push(sel);
            self.skip_ws();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b']') => {
                    self.pos += 1;
                    break;
                }
                _ => return Err(format!("expected ',' or ']' at byte {}", self.pos)),
            }
        }
        Ok(selectors)
    }

    fn parse_index_or_slice(&mut self) -> Result<Selector, String> {
        let start = if self.peek() == Some(b':') {
            None
        } else {
            Some(self.parse_int()?)
        };
        self.skip_ws();
        if self.peek() != Some(b':') {
            let idx = start.ok_or("missing array index")?;
            return Ok(Selector::Index(idx));
        }
        self.pos += 1;
        self.skip_ws();
        let end = if matches!(self.peek(), Some(b':' | b']' | b',')) {
            None
        } else {
            Some(self.parse_int()?)
        };
        self.skip_ws();
        let step = if self.peek() == Some(b':') {
            self.pos += 1;
            self.skip_ws();
            if matches!(self.peek(), Some(b']' | b',')) {
                1
            } else {
                self.parse_int()?
            }
        } else {
            1
        };
        Ok(Selector::Slice { start, end, step })
    }

    fn parse_filter_or(&mut self) -> Result<FilterExpr, String> {
        let mut lhs = self.parse_filter_and()?;
        loop {
            self.skip_ws();
            if self.starts_with("||") {
                self.pos += 2;
                let rhs = self.parse_filter_and()?;
                lhs = FilterExpr::Or(Box::new(lhs), Box::new(rhs));
            } else {
                break;
            }
        }
        Ok(lhs)
    }

    fn parse_filter_and(&mut self) -> Result<FilterExpr, String> {
        let mut lhs = self.parse_filter_atom()?;
        loop {
            self.skip_ws();
            if self.starts_with("&&") {
                self.pos += 2;
                let rhs = self.parse_filter_atom()?;
                lhs = FilterExpr::And(Box::new(lhs), Box::new(rhs));
            } else {
                break;
            }
        }
        Ok(lhs)
    }

    fn parse_filter_atom(&mut self) -> Result<FilterExpr, String> {
        self.skip_ws();
        if self.peek() == Some(b'(') {
            self.pos += 1;
            let inner = self.parse_filter_or()?;
            self.skip_ws();
            if self.peek() != Some(b')') {
                return Err("expected ')' in filter".into());
            }
            self.pos += 1;
            return Ok(inner);
        }
        if self.peek() != Some(b'@') {
            return Err(format!("expected '@' in filter at byte {}", self.pos));
        }
        self.pos += 1;
        let mut path = Vec::new();
        while self.peek() == Some(b'.') {
            self.pos += 1;
            path.push(self.parse_ident()?);
        }
        self.skip_ws();
        let op = if self.starts_with("==") {
            self.pos += 2;
            Some(CmpOp::Eq)
        } else if self.starts_with("!=") {
            self.pos += 2;
            Some(CmpOp::Ne)
        } else if self.starts_with("<=") {
            self.pos += 2;
            Some(CmpOp::Le)
        } else if self.starts_with(">=") {
            self.pos += 2;
            Some(CmpOp::Ge)
        } else if self.peek() == Some(b'<') {
            self.pos += 1;
            Some(CmpOp::Lt)
        } else if self.peek() == Some(b'>') {
            self.pos += 1;
            Some(CmpOp::Gt)
        } else {
            None
        };
        let Some(op) = op else {
            return Ok(FilterExpr::Exists(path));
        };
        self.skip_ws();
        let rhs = self.parse_filter_literal()?;
        Ok(FilterExpr::Cmp { path, op, rhs })
    }

    fn parse_filter_literal(&mut self) -> Result<FilterLiteral, String> {
        match self.peek() {
            Some(b'\'' | b'"') => Ok(FilterLiteral::Str(self.parse_quoted()?)),
            Some(b'-' | b'0'..=b'9') => {
                let start = self.pos;
                if self.peek() == Some(b'-') {
                    self.pos += 1;
                }
                while matches!(self.peek(), Some(b'0'..=b'9' | b'.')) {
                    self.pos += 1;
                }
                let n = self.src[start..self.pos]
                    .parse::<f64>()
                    .map_err(|_| "invalid number in filter")?;
                Ok(FilterLiteral::Num(n))
            }
            _ => {
                if self.starts_with("true") {
                    self.pos += 4;
                    Ok(FilterLiteral::Bool(true))
                } else if self.starts_with("false") {
                    self.pos += 5;
                    Ok(FilterLiteral::Bool(false))
                } else if self.starts_with("null") {
                    self.pos += 4;
                    Ok(FilterLiteral::Null)
                } else {
                    Err(format!("expected literal in filter at byte {}", self.pos))
                }
            }
        }
    }
}

fn parse_path(src: &str) -> Result<Vec<Segment>, String> {
    let mut p = Parser::new(src);
    if p.peek() != Some(b'$') {
        return Err("jsonpath must start with '$'".into());
    }
    p.pos += 1;
    let mut out = Vec::new();
    while p.pos < p.bytes.len() {
        if p.starts_with("..") {
            p.pos += 2;
            let selectors = match p.peek() {
                Some(b'*') => {
                    p.pos += 1;
                    vec![Selector::Wildcard]
                }
                Some(b'[') => p.parse_bracket_selectors()?,
                _ => vec![Selector::Name(p.parse_ident()?)],
            };
            out.push(Segment::Descendant(selectors));
        } else if p.peek() == Some(b'.') {
            p.pos += 1;
            let sel = if p.peek() == Some(b'*') {
                p.pos += 1;
                Selector::Wildcard
            } else {
                Selector::Name(p.parse_ident()?)
            };
            out.push(Segment::Child(vec![sel]));
        } else if p.peek() == Some(b'[') {
            let selectors = p.parse_bracket_selectors()?;
            out.push(Segment::Child(selectors));
        } else {
            return Err(format!(
                "unexpected character in jsonpath at byte {}",
                p.pos
            ));
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use serde_json::json;

    use super::*;

    #[test]
    fn selects_members_indices_wildcards_slices_and_filters() {
        let doc = json!({
            "store": {
                "books": [
                    {"title": "Rust", "price": 30, "inStock": true},
                    {"title": "Wayland", "price": 18, "inStock": false},
                    {"title": "GNOME", "price": 25, "inStock": true}
                ],
                "meta.version": 2
            }
        });

        assert_eq!(
            select_one_or_array(&doc, "$.store['meta.version']").unwrap(),
            json!(2)
        );
        assert_eq!(
            select(&doc, "$.store.books[*].title").unwrap(),
            vec![json!("Rust"), json!("Wayland"), json!("GNOME")]
        );
        assert_eq!(
            select_one_or_array(&doc, "$.store.books[-1].title").unwrap(),
            json!("GNOME")
        );
        assert_eq!(
            select(&doc, "$.store.books[0:2].title").unwrap(),
            vec![json!("Rust"), json!("Wayland")]
        );
        assert_eq!(
            select(
                &doc,
                "$.store.books[?@.inStock == true && @.price >= 25].title"
            )
            .unwrap(),
            vec![json!("Rust"), json!("GNOME")]
        );
        assert_eq!(
            select(&doc, "$..price").unwrap(),
            vec![json!(30), json!(18), json!(25)]
        );
    }

    #[test]
    fn rejects_invalid_paths() {
        let doc = json!({"a": 1});
        assert!(select(&doc, "a.b").is_err());
        assert!(select(&doc, "$.a[").is_err());
        assert!(select(&doc, "$.a['unclosed").is_err());
    }
}

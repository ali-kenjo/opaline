//! The syntax tree, with the static type of every node (docs/EXPRESSIONS.md §2).

use crate::funcs::Func;
use crate::{Key, Type, Value};

#[derive(Debug, Clone)]
pub enum Body {
    Expr(Expr),
    Template(Vec<Part>),
}

#[derive(Debug, Clone)]
pub enum Part {
    Text(String),
    Hole(Expr),
}

#[derive(Debug, Clone)]
pub struct Expr {
    pub kind: Kind,
    pub ty: Type,
    /// Character offset in the source.
    pub at: usize,
    /// Height of this subtree (1 for a literal or path), at most `MAX_DEPTH`.
    pub depth: usize,
}

impl Expr {
    /// A node over its children; `None` when it would nest deeper than `MAX_DEPTH`.
    pub fn new(kind: Kind, ty: Type, at: usize) -> Option<Self> {
        let mut depth = 0;
        match &kind {
            Kind::Lit(_) | Kind::Path(_) => {}
            Kind::Neg(e) | Kind::Not(e) | Kind::Field(e, _) => depth = e.depth,
            Kind::Binary(_, a, b) | Kind::Index(a, b) => depth = a.depth.max(b.depth),
            Kind::Call(_, args) => depth = args.iter().map(|a| a.depth).max().unwrap_or(0),
        }
        let depth = depth + 1;
        (depth <= crate::MAX_DEPTH).then_some(Self {
            kind,
            ty,
            at,
            depth,
        })
    }
}

#[derive(Debug, Clone)]
pub enum Kind {
    Lit(Value),
    Path(Box<PathRef>),
    Neg(Box<Expr>),
    Not(Box<Expr>),
    Binary(BinOp, Box<Expr>, Box<Expr>),
    Field(Box<Expr>, String),
    Index(Box<Expr>, Box<Expr>),
    Call(Func, Vec<Expr>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BinOp {
    Add,
    Sub,
    Mul,
    Div,
    Rem,
    Lt,
    Le,
    Gt,
    Ge,
    Eq,
    Ne,
    And,
    Or,
    Coalesce,
}

/// A data path: dotted names, then the constant fields and indexes written after them
/// (`gpu.list[1].name`). Resolved against the topics by longest prefix at run time (§5).
#[derive(Debug, Clone)]
pub struct PathRef {
    pub segments: Vec<String>,
    pub keys: Vec<Key>,
    /// Candidate topic names, longest first, each with the keys left over inside it.
    pub candidates: Vec<(String, Vec<Key>)>,
}

impl PathRef {
    pub fn new(segments: Vec<String>, keys: Vec<Key>) -> Self {
        let mut candidates = Vec::with_capacity(segments.len());
        for n in (1..=segments.len()).rev() {
            let name = segments[..n].join(".");
            let rest = segments[n..]
                .iter()
                .map(|s| Key::Field(s.clone()))
                .chain(keys.iter().cloned())
                .collect();
            candidates.push((name, rest));
        }
        Self {
            segments,
            keys,
            candidates,
        }
    }

    pub fn rebuild(&mut self) {
        *self = Self::new(
            std::mem::take(&mut self.segments),
            std::mem::take(&mut self.keys),
        );
    }
}

impl Body {
    pub fn visit(&self, f: &mut dyn FnMut(&Expr)) {
        match self {
            Self::Expr(e) => e.visit(f),
            Self::Template(parts) => {
                for p in parts {
                    if let Part::Hole(e) = p {
                        e.visit(f);
                    }
                }
            }
        }
    }
}

impl Expr {
    pub fn visit(&self, f: &mut dyn FnMut(&Expr)) {
        f(self);
        match &self.kind {
            Kind::Lit(_) | Kind::Path(_) => {}
            Kind::Neg(e) | Kind::Not(e) | Kind::Field(e, _) => e.visit(f),
            Kind::Binary(_, a, b) | Kind::Index(a, b) => {
                a.visit(f);
                b.visit(f);
            }
            Kind::Call(_, args) => {
                for a in args {
                    a.visit(f);
                }
            }
        }
    }
}

//! Parser and static checker (docs/EXPRESSIONS.md §3): precedence climbing over the tokens, with
//! types checked as nodes are built.

use crate::ast::{BinOp, Expr, Kind, Part, PathRef};
use crate::funcs::{self, Func, Param};
use crate::lexer::{self, Tok, Token};
use crate::{Diagnostic, ErrorCode, Key, MAX_DEPTH, MAX_LEN, Type, Value};

type R<T> = Result<T, Diagnostic>;

pub fn expression(src: &str) -> R<Expr> {
    let chars: Vec<char> = src.chars().collect();
    if chars.len() > MAX_LEN {
        return Err(Diagnostic::new(
            ErrorCode::TooLong,
            MAX_LEN,
            "expression too long",
        ));
    }
    parse_chars(&chars, 0)
}

pub fn template(src: &str) -> R<Vec<Part>> {
    let chars: Vec<char> = src.chars().collect();
    if chars.len() > MAX_LEN {
        return Err(Diagnostic::new(
            ErrorCode::TooLong,
            MAX_LEN,
            "template too long",
        ));
    }
    let mut parts = Vec::new();
    let mut text = String::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let next = chars.get(i + 1).copied();
        if c == '{' && next == Some('{') {
            text.push('{');
            i += 2;
        } else if c == '}' && next == Some('}') {
            text.push('}');
            i += 2;
        } else if c == '{' {
            let end = hole_end(&chars, i + 1)
                .ok_or_else(|| Diagnostic::new(ErrorCode::Parse, i, "unclosed {"))?;
            if !text.is_empty() {
                parts.push(Part::Text(std::mem::take(&mut text)));
            }
            parts.push(Part::Hole(parse_chars(&chars[i + 1..end], i + 1)?));
            i = end + 1;
        } else {
            text.push(c);
            i += 1;
        }
    }
    if !text.is_empty() {
        parts.push(Part::Text(text));
    }
    Ok(parts)
}

/// The `}` that closes a hole starting at `from`, skipping quoted strings.
fn hole_end(chars: &[char], from: usize) -> Option<usize> {
    let mut quote: Option<char> = None;
    let mut i = from;
    while i < chars.len() {
        let c = chars[i];
        match quote {
            Some(q) => {
                if c == '\\' {
                    i += 1;
                } else if c == q {
                    quote = None;
                }
            }
            None => {
                if c == '\'' || c == '"' {
                    quote = Some(c);
                } else if c == '}' {
                    return Some(i);
                }
            }
        }
        i += 1;
    }
    None
}

fn parse_chars(chars: &[char], offset: usize) -> R<Expr> {
    let toks = lexer::lex(chars, offset)?;
    let mut p = Parser {
        toks: &toks,
        pos: 0,
        depth: 0,
    };
    let e = p.expr()?;
    let t = p.peek();
    if t.tok != Tok::Eof {
        return Err(Diagnostic::new(ErrorCode::Parse, t.at, "unexpected token"));
    }
    Ok(e)
}

struct Parser<'a> {
    toks: &'a [Token],
    pos: usize,
    depth: usize,
}

const EOF: Token = Token {
    tok: Tok::Eof,
    at: 0,
};

impl Parser<'_> {
    fn peek(&self) -> &Token {
        self.toks.get(self.pos).or(self.toks.last()).unwrap_or(&EOF)
    }

    fn peek_at(&self, n: usize) -> &Tok {
        self.toks.get(self.pos + n).map_or(&Tok::Eof, |t| &t.tok)
    }

    fn bump(&mut self) -> Token {
        let t = self.peek().clone();
        if self.pos < self.toks.len() {
            self.pos += 1;
        }
        t
    }

    fn is_op(&self, op: &str) -> bool {
        matches!(&self.peek().tok, Tok::Op(o) if *o == op)
    }

    fn eat(&mut self, op: &str) -> bool {
        let yes = self.is_op(op);
        if yes {
            self.pos += 1;
        }
        yes
    }

    fn expect(&mut self, op: &str) -> R<()> {
        if self.eat(op) {
            Ok(())
        } else {
            Err(self.unexpected(&format!("expected {op}")))
        }
    }

    fn unexpected(&self, what: &str) -> Diagnostic {
        Diagnostic::new(ErrorCode::Parse, self.peek().at, what)
    }

    fn enter(&mut self) -> R<()> {
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            return Err(Diagnostic::new(
                ErrorCode::TooDeep,
                self.peek().at,
                "nested too deeply",
            ));
        }
        Ok(())
    }

    fn expr(&mut self) -> R<Expr> {
        self.enter()?;
        let e = self.pipe();
        self.depth -= 1;
        e
    }

    fn pipe(&mut self) -> R<Expr> {
        let mut lhs = self.coalesce()?;
        while self.is_op("|") {
            self.bump();
            let name = self.bump();
            let Tok::Ident(id) = name.tok else {
                return Err(Diagnostic::new(
                    ErrorCode::Parse,
                    name.at,
                    "expected a function name",
                ));
            };
            let mut args = vec![lhs];
            if self.eat("(") {
                self.args(&mut args)?;
            }
            lhs = call(&id, name.at, args)?;
        }
        Ok(lhs)
    }

    fn args(&mut self, args: &mut Vec<Expr>) -> R<()> {
        if self.eat(")") {
            return Ok(());
        }
        loop {
            args.push(self.expr()?);
            if self.eat(")") {
                return Ok(());
            }
            self.expect(",")?;
        }
    }

    fn coalesce(&mut self) -> R<Expr> {
        let mut lhs = self.or()?;
        while self.is_op("??") {
            let at = self.bump().at;
            let rhs = self.or()?;
            lhs = binary(BinOp::Coalesce, lhs, rhs, at)?;
        }
        Ok(lhs)
    }

    fn or(&mut self) -> R<Expr> {
        let mut lhs = self.and()?;
        while self.is_op("||") {
            let at = self.bump().at;
            let rhs = self.and()?;
            lhs = binary(BinOp::Or, lhs, rhs, at)?;
        }
        Ok(lhs)
    }

    fn and(&mut self) -> R<Expr> {
        let mut lhs = self.equality()?;
        while self.is_op("&&") {
            let at = self.bump().at;
            let rhs = self.equality()?;
            lhs = binary(BinOp::And, lhs, rhs, at)?;
        }
        Ok(lhs)
    }

    fn equality(&mut self) -> R<Expr> {
        let lhs = self.compare()?;
        let Some(op) = self.op_of(&[("==", BinOp::Eq), ("!=", BinOp::Ne)]) else {
            return Ok(lhs);
        };
        let at = self.bump().at;
        let rhs = self.compare()?;
        if self.is_op("==") || self.is_op("!=") {
            return Err(Diagnostic::new(
                ErrorCode::ChainedComparison,
                self.peek().at,
                "comparisons don't chain; use &&",
            ));
        }
        binary(op, lhs, rhs, at)
    }

    fn compare(&mut self) -> R<Expr> {
        const OPS: [(&str, BinOp); 4] = [
            ("<", BinOp::Lt),
            ("<=", BinOp::Le),
            (">", BinOp::Gt),
            (">=", BinOp::Ge),
        ];
        let lhs = self.additive()?;
        let Some(op) = self.op_of(&OPS) else {
            return Ok(lhs);
        };
        let at = self.bump().at;
        let rhs = self.additive()?;
        if self.op_of(&OPS).is_some() {
            return Err(Diagnostic::new(
                ErrorCode::ChainedComparison,
                self.peek().at,
                "comparisons don't chain; use &&",
            ));
        }
        binary(op, lhs, rhs, at)
    }

    fn op_of(&self, ops: &[(&str, BinOp)]) -> Option<BinOp> {
        ops.iter().find(|(s, _)| self.is_op(s)).map(|(_, op)| *op)
    }

    fn additive(&mut self) -> R<Expr> {
        let mut lhs = self.multiplicative()?;
        while let Some(op) = self.op_of(&[("+", BinOp::Add), ("-", BinOp::Sub)]) {
            let at = self.bump().at;
            let rhs = self.multiplicative()?;
            lhs = binary(op, lhs, rhs, at)?;
        }
        Ok(lhs)
    }

    fn multiplicative(&mut self) -> R<Expr> {
        let mut lhs = self.unary()?;
        while let Some(op) = self.op_of(&[("*", BinOp::Mul), ("/", BinOp::Div), ("%", BinOp::Rem)])
        {
            let at = self.bump().at;
            let rhs = self.unary()?;
            lhs = binary(op, lhs, rhs, at)?;
        }
        Ok(lhs)
    }

    fn unary(&mut self) -> R<Expr> {
        if self.is_op("-") || self.is_op("!") {
            let t = self.bump();
            self.enter()?;
            let operand = self.unary();
            self.depth -= 1;
            let operand = operand?;
            return if t.tok == Tok::Op("-") {
                check(Param::Num, &operand)?;
                node(Kind::Neg(Box::new(operand)), Type::Num, t.at)
            } else {
                check_bool(&operand)?;
                node(Kind::Not(Box::new(operand)), Type::Bool, t.at)
            };
        }
        self.postfix()
    }

    fn postfix(&mut self) -> R<Expr> {
        let mut e = self.primary()?;
        // Constant steps right after a path fold into it, so the host can look them up directly.
        let mut folding = matches!(e.kind, Kind::Path(_));
        loop {
            if self.is_op(".") {
                let dot = self.bump();
                let name = self.bump();
                let Tok::Ident(id) = name.tok else {
                    return Err(Diagnostic::new(
                        ErrorCode::Parse,
                        name.at,
                        "expected a field name",
                    ));
                };
                if folding && let Kind::Path(p) = &mut e.kind {
                    p.keys.push(Key::Field(id));
                    p.rebuild();
                    continue;
                }
                e = node(Kind::Field(Box::new(e), id), Type::Any, dot.at)?;
            } else if self.is_op("[") {
                let open = self.bump();
                let index = self.expr()?;
                self.expect("]")?;
                if folding && let Kind::Path(p) = &mut e.kind {
                    match &index.kind {
                        Kind::Lit(Value::Num(n)) => {
                            p.keys.push(Key::Index(*n));
                            p.rebuild();
                            continue;
                        }
                        Kind::Lit(Value::Str(s)) => {
                            p.keys.push(Key::Field(s.clone()));
                            p.rebuild();
                            continue;
                        }
                        _ => folding = false,
                    }
                }
                e = node(
                    Kind::Index(Box::new(e), Box::new(index)),
                    Type::Any,
                    open.at,
                )?;
            } else {
                return Ok(e);
            }
        }
    }

    fn primary(&mut self) -> R<Expr> {
        let t = self.bump();
        let at = t.at;
        let lit = |v: Value| {
            let ty = v.type_of();
            node(Kind::Lit(v), ty, at)
        };
        match t.tok {
            Tok::Num(n) => lit(Value::num(n)),
            Tok::Str(s) => lit(Value::Str(s)),
            Tok::Ident(id) => match id.as_str() {
                "true" => lit(Value::Bool(true)),
                "false" => lit(Value::Bool(false)),
                "null" => lit(Value::Null),
                _ if self.is_op("(") => {
                    self.bump();
                    let mut args = Vec::new();
                    self.args(&mut args)?;
                    call(&id, at, args)
                }
                _ => {
                    let mut segments = vec![id];
                    while self.is_op(".")
                        && let Tok::Ident(next) = self.peek_at(1)
                    {
                        segments.push(next.clone());
                        self.pos += 2;
                    }
                    node(
                        Kind::Path(Box::new(PathRef::new(segments, Vec::new()))),
                        Type::Any,
                        at,
                    )
                }
            },
            Tok::Op("(") => {
                let e = self.expr()?;
                self.expect(")")?;
                Ok(e)
            }
            Tok::Eof => Err(Diagnostic::new(ErrorCode::Parse, at, "unexpected end")),
            Tok::Op(op) => Err(Diagnostic::new(
                ErrorCode::Parse,
                at,
                &format!("unexpected {op}"),
            )),
        }
    }
}

fn node(kind: Kind, ty: Type, at: usize) -> R<Expr> {
    Expr::new(kind, ty, at)
        .ok_or_else(|| Diagnostic::new(ErrorCode::TooDeep, at, "nested too deeply"))
}

fn type_error(at: usize, what: &str) -> Diagnostic {
    Diagnostic::new(ErrorCode::TypeError, at, what)
}

fn check(p: Param, e: &Expr) -> R<()> {
    if funcs::accepts(p, e.ty) {
        Ok(())
    } else {
        let want = match p {
            Param::Num => "a number",
            Param::Str => "a string",
            Param::List => "a list",
            Param::Any => "a value",
        };
        Err(type_error(e.at, &format!("expected {want}")))
    }
}

fn check_bool(e: &Expr) -> R<()> {
    match e.ty {
        Type::Bool | Type::Null | Type::Any => Ok(()),
        _ => Err(type_error(e.at, "expected true or false")),
    }
}

fn concrete(t: Type) -> bool {
    matches!(t, Type::Num | Type::Str | Type::Bool)
}

fn binary(op: BinOp, lhs: Expr, rhs: Expr, at: usize) -> R<Expr> {
    let ty = match op {
        BinOp::Add => match (lhs.ty, rhs.ty) {
            (Type::Str, Type::Str) => Type::Str,
            (Type::Num, Type::Num) => Type::Num,
            (a, b) if concrete(a) && concrete(b) => {
                return Err(type_error(at, "+ needs two numbers or two strings"));
            }
            (Type::Bool, _) | (_, Type::Bool) => {
                return Err(type_error(at, "+ needs two numbers or two strings"));
            }
            _ => Type::Any,
        },
        BinOp::Sub | BinOp::Mul | BinOp::Div | BinOp::Rem => {
            check(Param::Num, &lhs)?;
            check(Param::Num, &rhs)?;
            Type::Num
        }
        BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => {
            let (a, b) = (lhs.ty, rhs.ty);
            if a == Type::Bool || b == Type::Bool || (concrete(a) && concrete(b) && a != b) {
                return Err(type_error(
                    at,
                    "compares numbers with numbers or strings with strings",
                ));
            }
            Type::Bool
        }
        BinOp::Eq | BinOp::Ne => Type::Bool,
        BinOp::And | BinOp::Or => {
            check_bool(&lhs)?;
            check_bool(&rhs)?;
            Type::Bool
        }
        BinOp::Coalesce => match (lhs.ty, rhs.ty) {
            (Type::Null, b) => b,
            (a, b) if a == b => a,
            (a, Type::Null) => a,
            _ => Type::Any,
        },
    };
    node(Kind::Binary(op, Box::new(lhs), Box::new(rhs)), ty, at)
}

fn call(name: &str, at: usize, mut args: Vec<Expr>) -> R<Expr> {
    // min/max with a path and a duration literal are the history form (§6).
    let history = match name {
        "avg" => Some(Func::HistAvg),
        "delta" => Some(Func::HistDelta),
        "min" | "max" if args.len() == 2 && is_history_form(&args) => Some(if name == "min" {
            Func::HistMin
        } else {
            Func::HistMax
        }),
        _ => None,
    };
    if let Some(func) = history {
        if args.len() != 2 {
            return Err(Diagnostic::new(
                ErrorCode::Arity,
                at,
                &format!("{name} takes a path and a window"),
            ));
        }
        let (path_ok, window) = (is_plain_path(&args[0]), window_literal(&args[1]));
        if !path_ok {
            return Err(type_error(args[0].at, "expected a data path"));
        }
        let Some(secs) = window else {
            return Err(type_error(args[1].at, "expected a duration such as '5m'"));
        };
        args[1] = node(Kind::Lit(Value::Num(secs)), Type::Num, args[1].at)?;
        return node(Kind::Call(func, args), Type::Num, at);
    }
    let sig = funcs::lookup(name).ok_or_else(|| {
        Diagnostic::new(
            ErrorCode::UnknownFunction,
            at,
            &format!("unknown function {name}"),
        )
    })?;
    if !sig.arity_ok(args.len()) {
        return Err(Diagnostic::new(
            ErrorCode::Arity,
            at,
            &format!("wrong number of arguments for {name}"),
        ));
    }
    for (i, a) in args.iter().enumerate() {
        check(sig.param(i), a)?;
    }
    let ty = match sig.func {
        Func::If => match (args.get(1).map(|a| a.ty), args.get(2).map(|a| a.ty)) {
            (Some(a), Some(b)) if a == b => a,
            _ => Type::Any,
        },
        _ => sig.ret,
    };
    node(Kind::Call(sig.func, args), ty, at)
}

fn is_plain_path(e: &Expr) -> bool {
    matches!(&e.kind, Kind::Path(p) if p.keys.is_empty())
}

fn window_literal(e: &Expr) -> Option<f64> {
    match &e.kind {
        Kind::Lit(Value::Str(s)) => funcs::duration_secs(s),
        _ => None,
    }
}

fn is_history_form(args: &[Expr]) -> bool {
    args.len() == 2 && is_plain_path(&args[0]) && matches!(args[1].kind, Kind::Lit(Value::Str(_)))
}

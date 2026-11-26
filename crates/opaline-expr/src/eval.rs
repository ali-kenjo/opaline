//! Evaluation (docs/EXPRESSIONS.md §4): `null` propagates, mismatches found in data give `null`
//! and a recorded error, nothing escapes.

use crate::ast::{BinOp, Body, Expr, Kind, Part, PathRef};
use crate::format::{self, NNBSP};
use crate::funcs::Func;
use crate::{Agg, Diagnostic, ErrorCode, Host, Locale, Outcome, Value};

struct Cx<'a> {
    host: &'a dyn Host,
    locale: Locale,
    errors: Vec<Diagnostic>,
    missing: bool,
}

pub fn run(body: &Body, host: &dyn Host) -> Outcome {
    let mut cx = Cx {
        host,
        locale: host.locale(),
        errors: Vec::new(),
        missing: false,
    };
    let value = match body {
        Body::Expr(e) => cx.eval(e),
        Body::Template(parts) => {
            let mut out = String::new();
            for p in parts {
                match p {
                    Part::Text(t) => out.push_str(t),
                    Part::Hole(e) => {
                        let v = cx.eval(e);
                        if v.is_null() {
                            cx.missing = true;
                        }
                        out.push_str(&format::text(&v, cx.locale));
                    }
                }
            }
            Value::Str(out)
        }
    };
    Outcome {
        value,
        errors: cx.errors,
        missing: cx.missing,
    }
}

/// A number argument: `Ok(None)` for `null` (the result is `null`), `Err` after recording a type
/// error.
type Arg<T> = Result<Option<T>, ()>;

impl Cx<'_> {
    fn error(&mut self, at: usize, message: &str) {
        let d = Diagnostic::new(ErrorCode::TypeError, at, message);
        if !self.errors.contains(&d) {
            self.errors.push(d);
        }
    }

    fn num(&mut self, v: &Value, at: usize) -> Arg<f64> {
        match v {
            Value::Null => Ok(None),
            Value::Num(x) => Ok(Some(*x)),
            _ => {
                self.error(at, "expected a number");
                Err(())
            }
        }
    }

    fn str<'v>(&mut self, v: &'v Value, at: usize) -> Arg<&'v str> {
        match v {
            Value::Null => Ok(None),
            Value::Str(s) => Ok(Some(s)),
            _ => {
                self.error(at, "expected a string");
                Err(())
            }
        }
    }

    /// A condition: `null` is false, anything but a bool is a type error.
    fn truth(&mut self, v: &Value, at: usize) -> Option<bool> {
        match v {
            Value::Null => Some(false),
            Value::Bool(b) => Some(*b),
            _ => {
                self.error(at, "expected true or false");
                None
            }
        }
    }

    fn path(&mut self, p: &PathRef) -> Value {
        for (name, keys) in &p.candidates {
            if self.host.has_topic(name) {
                let v = self.host.topic(name, keys);
                if v.is_null() {
                    self.missing = true;
                }
                return v;
            }
        }
        self.missing = true;
        Value::Null
    }

    fn eval(&mut self, e: &Expr) -> Value {
        match &e.kind {
            Kind::Lit(v) => v.clone(),
            Kind::Path(p) => self.path(p),
            Kind::Neg(x) => {
                let v = self.eval(x);
                match self.num(&v, x.at) {
                    Ok(Some(n)) => Value::num(-n),
                    _ => Value::Null,
                }
            }
            Kind::Not(x) => {
                let v = self.eval(x);
                self.truth(&v, x.at)
                    .map_or(Value::Null, |b| Value::Bool(!b))
            }
            Kind::Binary(op, a, b) => self.binary(*op, a, b, e.at),
            Kind::Field(target, name) => {
                let v = self.eval(target);
                v.get(&crate::Key::Field(name.clone()))
                    .cloned()
                    .unwrap_or_default()
            }
            Kind::Index(target, index) => {
                let v = self.eval(target);
                let key = match self.eval(index) {
                    Value::Num(n) => crate::Key::Index(n),
                    Value::Str(s) => crate::Key::Field(s),
                    _ => return Value::Null,
                };
                v.get(&key).cloned().unwrap_or_default()
            }
            Kind::Call(f, args) => self.call(*f, args, e.at),
        }
    }

    fn binary(&mut self, op: BinOp, a: &Expr, b: &Expr, at: usize) -> Value {
        match op {
            BinOp::And | BinOp::Or => {
                let va = self.eval(a);
                let Some(x) = self.truth(&va, a.at) else {
                    return Value::Null;
                };
                if (op == BinOp::And) != x {
                    return Value::Bool(x);
                }
                let vb = self.eval(b);
                self.truth(&vb, b.at).map_or(Value::Null, Value::Bool)
            }
            BinOp::Coalesce => {
                let va = self.eval(a);
                if va.is_null() { self.eval(b) } else { va }
            }
            _ => {
                let va = self.eval(a);
                let vb = self.eval(b);
                self.strict(op, &va, &vb, at)
            }
        }
    }

    fn strict(&mut self, op: BinOp, a: &Value, b: &Value, at: usize) -> Value {
        match op {
            BinOp::Eq => return Value::Bool(a.same(b)),
            BinOp::Ne => return Value::Bool(!a.same(b)),
            _ => {}
        }
        if a.is_null() || b.is_null() {
            return Value::Null;
        }
        match (op, a, b) {
            (BinOp::Add, Value::Str(x), Value::Str(y)) => Value::Str(format!("{x}{y}")),
            (_, Value::Num(x), Value::Num(y)) => {
                let (x, y) = (*x, *y);
                match op {
                    BinOp::Add => Value::num(x + y),
                    BinOp::Sub => Value::num(x - y),
                    BinOp::Mul => Value::num(x * y),
                    BinOp::Div => Value::num(x / y),
                    BinOp::Rem => Value::num(x % y),
                    BinOp::Lt => Value::Bool(x < y),
                    BinOp::Le => Value::Bool(x <= y),
                    BinOp::Gt => Value::Bool(x > y),
                    BinOp::Ge => Value::Bool(x >= y),
                    _ => Value::Null,
                }
            }
            (BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge, Value::Str(x), Value::Str(y)) => {
                let o = x.cmp(y);
                Value::Bool(match op {
                    BinOp::Lt => o.is_lt(),
                    BinOp::Le => o.is_le(),
                    BinOp::Gt => o.is_gt(),
                    _ => o.is_ge(),
                })
            }
            _ => {
                self.error(at, "these values can't be combined");
                Value::Null
            }
        }
    }

    fn call(&mut self, f: Func, args: &[Expr], at: usize) -> Value {
        // `if` evaluates only the chosen branch.
        if f == Func::If {
            let [c, a, b] = args else {
                return Value::Null;
            };
            let vc = self.eval(c);
            return match self.truth(&vc, c.at) {
                Some(true) => self.eval(a),
                Some(false) => self.eval(b),
                None => Value::Null,
            };
        }
        if let Some(agg) = match f {
            Func::HistAvg => Some(Agg::Avg),
            Func::HistMin => Some(Agg::Min),
            Func::HistMax => Some(Agg::Max),
            Func::HistDelta => Some(Agg::Delta),
            _ => None,
        } {
            let (
                Some(Expr {
                    kind: Kind::Path(p),
                    ..
                }),
                Some(Expr {
                    kind: Kind::Lit(Value::Num(secs)),
                    ..
                }),
            ) = (args.first(), args.get(1))
            else {
                return Value::Null;
            };
            let path = p.segments.join(".");
            return self
                .host
                .history(&path, agg, *secs)
                .map_or(Value::Null, Value::num);
        }
        let vals: Vec<Value> = args.iter().map(|a| self.eval(a)).collect();
        let ats: Vec<usize> = args.iter().map(|a| a.at).collect();
        self.apply(f, &vals, &ats, at).unwrap_or(Value::Null)
    }

    /// `None` is `null` (a `null` input, or a type error already recorded).
    fn apply(&mut self, f: Func, v: &[Value], at: &[usize], call_at: usize) -> Option<Value> {
        let nul = Value::Null;
        let arg = |i: usize| v.get(i).unwrap_or(&nul);
        let pos = |i: usize| at.get(i).copied().unwrap_or(call_at);
        let locale = self.locale;
        macro_rules! num {
            ($i:expr) => {
                self.num(arg($i), pos($i)).ok()??
            };
        }
        macro_rules! opt_num {
            ($i:expr, $default:expr) => {
                if v.len() > $i { num!($i) } else { $default }
            };
        }
        macro_rules! string {
            ($i:expr) => {
                self.str(arg($i), pos($i)).ok()??
            };
        }
        let digits = |d: f64| d.clamp(0.0, 10.0).trunc() as u32;
        Some(match f {
            Func::Round => {
                let x = num!(0);
                let d = opt_num!(1, 0.0);
                Value::num(format::round_to(x, digits(d)))
            }
            Func::Floor => Value::num(num!(0).floor()),
            Func::Ceil => Value::num(num!(0).ceil()),
            Func::Abs => Value::num(num!(0).abs()),
            Func::Sqrt => Value::num(num!(0).sqrt()),
            Func::Min | Func::Max => {
                let mut acc: Option<f64> = None;
                for i in 0..v.len() {
                    let x = num!(i);
                    acc = Some(match acc {
                        None => x,
                        Some(a) if f == Func::Min => a.min(x),
                        Some(a) => a.max(x),
                    });
                }
                Value::num(acc?)
            }
            Func::Clamp => {
                let (x, lo, hi) = (num!(0), num!(1), num!(2));
                Value::num(x.max(lo).min(hi))
            }
            Func::Map => {
                let (x, a, b, c, d) = (num!(0), num!(1), num!(2), num!(3), num!(4));
                if a == b {
                    return None;
                }
                Value::num(c + (x - a) * (d - c) / (b - a))
            }
            Func::Upper => Value::Str(string!(0).to_uppercase()),
            Func::Lower => Value::Str(string!(0).to_lowercase()),
            Func::Trim => Value::Str(string!(0).trim().to_owned()),
            Func::Len => match arg(0) {
                Value::Str(s) => Value::Num(s.chars().count() as f64),
                Value::List(l) => Value::Num(l.len() as f64),
                _ => return None,
            },
            Func::String => Value::Str(format::text(arg(0), locale)),
            Func::Join => {
                let sep = if v.len() > 1 {
                    string!(1).to_owned()
                } else {
                    ", ".to_owned()
                };
                match arg(0) {
                    Value::Null => return None,
                    Value::List(l) => Value::Str(
                        l.iter()
                            .map(|x| format::text(x, locale))
                            .collect::<Vec<_>>()
                            .join(&sep),
                    ),
                    _ => {
                        self.error(pos(0), "expected a list");
                        return None;
                    }
                }
            }
            Func::Pad => {
                if arg(0).is_null() {
                    return None;
                }
                let text = format::text(arg(0), locale);
                let width = num!(1).clamp(0.0, 256.0) as usize;
                let fill = if v.len() > 2 {
                    string!(2).chars().next().unwrap_or('0')
                } else {
                    '0'
                };
                let n = text.chars().count();
                let mut out: String = std::iter::repeat_n(fill, width.saturating_sub(n)).collect();
                out.push_str(&text);
                Value::Str(out)
            }
            Func::Fixed => Value::Str(format::fixed(num!(0), digits(num!(1)), locale)),
            Func::Percent => {
                let x = num!(0);
                let d = opt_num!(1, 0.0);
                Value::Str(format!("{}{NNBSP}%", format::fixed(x, digits(d), locale)))
            }
            Func::Unit => {
                let x = num!(0);
                let u = string!(1).to_owned();
                let n = if v.len() > 2 {
                    format::fixed(x, digits(num!(2)), locale)
                } else {
                    format::plain(x, locale)
                };
                Value::Str(format!("{n}{NNBSP}{u}"))
            }
            Func::Bytes => {
                let x = num!(0);
                let iec = if v.len() > 1 {
                    match string!(1) {
                        "si" => false,
                        "iec" => true,
                        _ => {
                            self.error(pos(1), "expected 'si' or 'iec'");
                            return None;
                        }
                    }
                } else {
                    false
                };
                Value::Str(format::bytes(x, iec, locale))
            }
            Func::Duration => {
                let x = num!(0);
                let clock = if v.len() > 1 {
                    match string!(1) {
                        "short" => false,
                        "clock" => true,
                        _ => {
                            self.error(pos(1), "expected 'short' or 'clock'");
                            return None;
                        }
                    }
                } else {
                    false
                };
                Value::Str(format::duration(x, clock, locale))
            }
            Func::Mix => {
                let a = self.color(arg(0), pos(0))?;
                let b = self.color(arg(1), pos(1))?;
                let t = num!(2);
                Value::Str(format::color(format::mix(a, b, t, 4)))
            }
            Func::Alpha => {
                let mut c = self.color(arg(0), pos(0))?;
                c[3] = format::round_half_away(num!(1).clamp(0.0, 1.0) * 255.0);
                Value::Str(format::color(c))
            }
            Func::Lighten => {
                let c = self.color(arg(0), pos(0))?;
                let amount = num!(1).clamp(-1.0, 1.0);
                let target = if amount >= 0.0 {
                    [255.0; 4]
                } else {
                    [0.0, 0.0, 0.0, 255.0]
                };
                Value::Str(format::color(format::mix(c, target, amount.abs(), 3)))
            }
            Func::Now => Value::num(self.host.now_ms()?),
            Func::Until => {
                let ms = num!(0);
                Value::num((ms - self.host.now_ms()?) / 1000.0)
            }
            Func::Date => {
                let ms = num!(0);
                let skeleton = if v.len() > 1 {
                    string!(1).to_owned()
                } else {
                    "yMMMd".to_owned()
                };
                let zone = if v.len() > 2 {
                    Some(string!(2).to_owned())
                } else {
                    None
                };
                Value::Str(self.host.date(ms, &skeleton, zone.as_deref())?)
            }
            Func::Ramp => {
                let t = num!(0).clamp(0.0, 1.0);
                let name = string!(1).to_owned();
                Value::Str(self.host.ramp(t, &name)?)
            }
            Func::If | Func::HistAvg | Func::HistMin | Func::HistMax | Func::HistDelta => {
                return None;
            }
        })
    }

    fn color(&mut self, v: &Value, at: usize) -> Option<[f64; 4]> {
        let s = self.str(v, at).ok()??;
        let c = format::parse_color(s);
        if c.is_none() {
            self.error(at, "expected a color such as '#4285f4'");
        }
        c
    }
}

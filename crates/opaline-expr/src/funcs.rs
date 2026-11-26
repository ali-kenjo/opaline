//! The function table (docs/EXPRESSIONS.md §6): names, arity, parameter kinds, result types.

use crate::Type;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Func {
    Round,
    Floor,
    Ceil,
    Abs,
    Sqrt,
    Min,
    Max,
    Clamp,
    Map,
    If,
    Upper,
    Lower,
    Trim,
    Len,
    String,
    Join,
    Has,
    Pad,
    Fixed,
    Percent,
    Unit,
    Bytes,
    Duration,
    Mix,
    Alpha,
    Lighten,
    Now,
    Until,
    /// Layer only (ICU data, the scheme): `null` unless the host provides them.
    Date,
    Ramp,
    /// History forms: the first argument is a path, the second a duration literal, folded into
    /// the call at compile time (see `parser`).
    HistAvg,
    HistMin,
    HistMax,
    HistDelta,
}

/// What a parameter accepts. A statically known value of another kind is a compile error.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Param {
    Num,
    Str,
    /// Anything (conditions, `len`, `string`).
    Any,
    /// A list (only data is a list, so this rejects literals).
    List,
}

#[derive(Debug, Clone, Copy)]
pub struct Sig {
    pub func: Func,
    pub params: &'static [Param],
    /// How many trailing parameters may be left out.
    pub optional: usize,
    /// The last parameter repeats (`min`, `max`).
    pub variadic: bool,
    pub ret: Type,
}

const fn sig(func: Func, params: &'static [Param], optional: usize, ret: Type) -> Sig {
    Sig {
        func,
        params,
        optional,
        variadic: false,
        ret,
    }
}

use Param::{Any, List, Num, Str};

pub fn lookup(name: &str) -> Option<Sig> {
    Some(match name {
        "round" => sig(Func::Round, &[Num, Num], 1, Type::Num),
        "floor" => sig(Func::Floor, &[Num], 0, Type::Num),
        "ceil" => sig(Func::Ceil, &[Num], 0, Type::Num),
        "abs" => sig(Func::Abs, &[Num], 0, Type::Num),
        "sqrt" => sig(Func::Sqrt, &[Num], 0, Type::Num),
        "min" | "max" => Sig {
            func: if name == "min" { Func::Min } else { Func::Max },
            params: &[Num, Num],
            optional: 0,
            variadic: true,
            ret: Type::Num,
        },
        "clamp" => sig(Func::Clamp, &[Num, Num, Num], 0, Type::Num),
        "map" => sig(Func::Map, &[Num, Num, Num, Num, Num], 0, Type::Num),
        "if" => sig(Func::If, &[Any, Any, Any], 0, Type::Any),
        "upper" => sig(Func::Upper, &[Str], 0, Type::Str),
        "lower" => sig(Func::Lower, &[Str], 0, Type::Str),
        "trim" => sig(Func::Trim, &[Str], 0, Type::Str),
        "len" => sig(Func::Len, &[Any], 0, Type::Num),
        "string" => sig(Func::String, &[Any], 0, Type::Str),
        "join" => sig(Func::Join, &[List, Str], 1, Type::Str),
        "has" => sig(Func::Has, &[Any, Any], 0, Type::Bool),
        "pad" => sig(Func::Pad, &[Any, Num, Str], 1, Type::Str),
        "fixed" => sig(Func::Fixed, &[Num, Num], 0, Type::Str),
        "percent" => sig(Func::Percent, &[Num, Num], 1, Type::Str),
        "unit" => sig(Func::Unit, &[Num, Str, Num], 1, Type::Str),
        "bytes" => sig(Func::Bytes, &[Num, Str], 1, Type::Str),
        "duration" => sig(Func::Duration, &[Num, Str], 1, Type::Str),
        "mix" => sig(Func::Mix, &[Str, Str, Num], 0, Type::Str),
        "alpha" => sig(Func::Alpha, &[Str, Num], 0, Type::Str),
        "lighten" => sig(Func::Lighten, &[Str, Num], 0, Type::Str),
        "now" => sig(Func::Now, &[], 0, Type::Num),
        "until" => sig(Func::Until, &[Num], 0, Type::Num),
        "date" => sig(Func::Date, &[Num, Str, Str], 2, Type::Str),
        "ramp" => sig(Func::Ramp, &[Num, Str], 0, Type::Str),
        "avg" => sig(Func::HistAvg, &[Any, Str], 0, Type::Num),
        "delta" => sig(Func::HistDelta, &[Any, Str], 0, Type::Num),
        _ => return None,
    })
}

impl Sig {
    pub fn arity_ok(&self, n: usize) -> bool {
        let max = self.params.len();
        let min = max - self.optional;
        n >= min && (self.variadic || n <= max)
    }

    /// The kind expected at argument `i`.
    pub fn param(&self, i: usize) -> Param {
        match self.params.get(i) {
            Some(p) => *p,
            None => self.params.last().copied().unwrap_or(Any),
        }
    }
}

/// Whether a value of static type `ty` can be passed where `p` is expected.
pub fn accepts(p: Param, ty: Type) -> bool {
    match (p, ty) {
        (_, Type::Null | Type::Any) | (Any, _) => true,
        (Num, t) => t == Type::Num,
        (Str, t) => t == Type::Str,
        (List, _) => false,
    }
}

/// A duration literal (`'30s'`, `'5m'`, `'2h'`, `'1d'`) in seconds.
pub fn duration_secs(s: &str) -> Option<f64> {
    let s = s.trim();
    let split = s.find(|c: char| !(c.is_ascii_digit() || c == '.'))?;
    let (num, unit) = s.split_at(split);
    let n: f64 = num.parse().ok()?;
    let k = match unit {
        "s" => 1.0,
        "m" => 60.0,
        "h" => 3600.0,
        "d" => 86400.0,
        _ => return None,
    };
    (n.is_finite() && n > 0.0).then_some(n * k)
}

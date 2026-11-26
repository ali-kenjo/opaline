//! Locale-aware number, byte, duration and color formatting (docs/EXPRESSIONS.md §6). The
//! TypeScript side does the same arithmetic in the same order, so both agree to the digit.

use crate::{Locale, Value};

/// Narrow no-break space, between a number and its unit.
pub const NNBSP: char = '\u{202F}';

/// Rounds half away from zero.
pub fn round_half_away(x: f64) -> f64 {
    x.round()
}

/// `round(x, digits)`.
pub fn round_to(x: f64, digits: u32) -> f64 {
    if digits == 0 {
        return round_half_away(x);
    }
    let k = 10f64.powi(digits as i32);
    round_half_away(x * k) / k
}

fn separators(locale: Locale) -> (char, char) {
    match locale {
        Locale::De => (',', '.'),
        Locale::En | Locale::Ar => ('.', ','),
    }
}

/// The decimal digits of a non-negative integral float, exactly.
fn int_digits(n: f64) -> String {
    format!("{n:.0}")
}

/// `x` with `digits` decimals, grouped, or with trailing zeros dropped when `trim` is set.
fn number(x: f64, digits: u32, trim: bool, locale: Locale) -> String {
    if !x.is_finite() {
        return "—".to_owned();
    }
    let k = 10f64.powi(digits as i32);
    let mut scaled = round_half_away(x.abs() * k);
    let digits = digits as usize;
    let mut d = if scaled.is_finite() {
        int_digits(scaled)
    } else {
        // Too large to scale: no fraction is representable anyway.
        scaled = round_half_away(x.abs());
        format!("{}{}", int_digits(scaled), "0".repeat(digits))
    };
    if d.len() <= digits {
        d = format!("{}{d}", "0".repeat(digits + 1 - d.len()));
    }
    let (int, frac) = d.split_at(d.len() - digits);
    let (dec, group) = separators(locale);
    let mut out = String::new();
    if x < 0.0 && scaled != 0.0 {
        out.push('-');
    }
    let len = int.len();
    for (i, c) in int.chars().enumerate() {
        if i > 0 && (len - i) % 3 == 0 {
            out.push(group);
        }
        out.push(c);
    }
    let frac = if trim {
        frac.trim_end_matches('0')
    } else {
        frac
    };
    if !frac.is_empty() {
        out.push(dec);
        out.push_str(frac);
    }
    out
}

pub fn fixed(x: f64, digits: u32, locale: Locale) -> String {
    number(x, digits, false, locale)
}

/// At most 3 decimals, trailing zeros dropped: template holes and `unit` without digits.
pub fn plain(x: f64, locale: Locale) -> String {
    number(x, 3, true, locale)
}

/// A value as text, the template-hole rules (§4). `Null` is `—`.
pub fn text(v: &Value, locale: Locale) -> String {
    match v {
        Value::Null | Value::Map(_) => "—".to_owned(),
        Value::Bool(b) => b.to_string(),
        Value::Num(x) => plain(*x, locale),
        Value::Str(s) => s.clone(),
        Value::List(l) => l
            .iter()
            .map(|v| text(v, locale))
            .collect::<Vec<_>>()
            .join(", "),
    }
}

pub fn bytes(x: f64, iec: bool, locale: Locale) -> String {
    let (factor, units): (f64, &[&str]) = if iec {
        (1024.0, &["B", "KiB", "MiB", "GiB", "TiB"])
    } else {
        (1000.0, &["B", "kB", "MB", "GB", "TB"])
    };
    let mut a = x.abs();
    if a < factor {
        return format!("{}{NNBSP}B", fixed(x, 0, locale));
    }
    let mut i = 0;
    while a >= factor && i + 1 < units.len() {
        a /= factor;
        i += 1;
    }
    let unit = units.get(i).copied().unwrap_or("B");
    format!("{}{NNBSP}{unit}", fixed(a.copysign(x), 1, locale))
}

pub fn duration(secs: f64, clock: bool, locale: Locale) -> String {
    let sign = if secs < 0.0 { "-" } else { "" };
    let total = round_half_away(secs.abs());
    if clock {
        let h = (total / 3600.0).floor();
        let m = ((total % 3600.0) / 60.0).floor();
        let s = total % 60.0;
        return if h > 0.0 {
            format!("{sign}{}:{m:02}:{s:02}", fixed(h, 0, locale))
        } else {
            format!("{sign}{m}:{s:02}")
        };
    }
    let parts = [
        ((total / 86400.0).floor(), "d"),
        (((total % 86400.0) / 3600.0).floor(), "h"),
        (((total % 3600.0) / 60.0).floor(), "min"),
        (total % 60.0, "s"),
    ];
    let Some(first) = parts.iter().position(|(v, _)| *v > 0.0) else {
        return format!("0{NNBSP}s");
    };
    let mut out = String::from(sign);
    for (i, (v, unit)) in parts.iter().enumerate().skip(first).take(2) {
        if *v == 0.0 {
            continue;
        }
        if i > first {
            out.push(' ');
        }
        out.push_str(&fixed(*v, 0, locale));
        out.push(NNBSP);
        out.push_str(unit);
    }
    out
}

/// `#rrggbb` or `#rrggbbaa` → channels 0 … 255.
pub fn parse_color(s: &str) -> Option<[f64; 4]> {
    let hex = s.strip_prefix('#')?;
    if !(hex.len() == 6 || hex.len() == 8) || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let ch = |i: usize| {
        hex.get(i..i + 2)
            .and_then(|h| u8::from_str_radix(h, 16).ok())
            .map(f64::from)
    };
    Some([
        ch(0)?,
        ch(2)?,
        ch(4)?,
        if hex.len() == 8 { ch(6)? } else { 255.0 },
    ])
}

pub fn color(c: [f64; 4]) -> String {
    let b = |v: f64| round_half_away(v).clamp(0.0, 255.0) as u8;
    let [r, g, bl, a] = c.map(b);
    if a == 255 {
        format!("#{r:02x}{g:02x}{bl:02x}")
    } else {
        format!("#{r:02x}{g:02x}{bl:02x}{a:02x}")
    }
}

pub fn mix(a: [f64; 4], b: [f64; 4], t: f64, channels: usize) -> [f64; 4] {
    let t = t.clamp(0.0, 1.0);
    let mut out = a;
    for i in 0..channels.min(4) {
        out[i] = round_half_away(a[i] + (b[i] - a[i]) * t);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers() {
        assert_eq!(fixed(1234.5, 1, Locale::En), "1,234.5");
        assert_eq!(fixed(1234.5, 1, Locale::De), "1.234,5");
        assert_eq!(fixed(-0.04, 1, Locale::En), "0.0");
        assert_eq!(fixed(0.5, 0, Locale::En), "1");
        assert_eq!(plain(1.23456, Locale::En), "1.235");
        assert_eq!(plain(1_234_567.0, Locale::En), "1,234,567");
        assert_eq!(plain(0.001, Locale::En), "0.001");
        assert_eq!(plain(-12.5, Locale::En), "-12.5");
        assert_eq!(fixed(1e308, 2, Locale::En).len(), 309 + 102 + 3);
        let big = plain(1e308, Locale::En);
        assert!(big.starts_with("100,000,000,000,000,001,") && !big.contains(['.', 'i']));
    }

    #[test]
    fn durations() {
        assert_eq!(
            duration(90_061.0, false, Locale::En),
            "1\u{202F}d 1\u{202F}h"
        );
        assert_eq!(duration(86_460.0, false, Locale::En), "1\u{202F}d");
        assert_eq!(duration(0.0, false, Locale::En), "0\u{202F}s");
        assert_eq!(duration(59.0, true, Locale::En), "0:59");
    }
}

//! Tokens of the expression language (docs/EXPRESSIONS.md §3). Positions are character offsets.

use crate::{Diagnostic, ErrorCode};

#[derive(Debug, Clone, PartialEq)]
pub enum Tok {
    Num(f64),
    Str(String),
    Ident(String),
    /// Punctuation and operators, as written (`"+"`, `"??"`, `"<="` …).
    Op(&'static str),
    Eof,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Token {
    pub tok: Tok,
    pub at: usize,
}

const OPS: [&str; 22] = [
    "??", "||", "&&", "==", "!=", "<=", ">=", "<", ">", "+", "-", "*", "/", "%", "!", "(", ")",
    "[", "]", ",", ".", "|",
];

pub fn lex(src: &[char], offset: usize) -> Result<Vec<Token>, Diagnostic> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < src.len() {
        let c = src[i];
        let at = offset + i;
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        if c.is_ascii_digit() || (c == '.' && src.get(i + 1).is_some_and(char::is_ascii_digit)) {
            let start = i;
            while i < src.len() && (src[i].is_ascii_digit() || src[i] == '.') {
                i += 1;
            }
            if i < src.len() && (src[i] == 'e' || src[i] == 'E') {
                let mut j = i + 1;
                if j < src.len() && (src[j] == '+' || src[j] == '-') {
                    j += 1;
                }
                if j < src.len() && src[j].is_ascii_digit() {
                    i = j;
                    while i < src.len() && src[i].is_ascii_digit() {
                        i += 1;
                    }
                }
            }
            let text: String = src[start..i].iter().collect();
            let n: f64 = text
                .parse()
                .map_err(|_| Diagnostic::new(ErrorCode::Parse, at, "not a number"))?;
            out.push(Token {
                tok: Tok::Num(n),
                at,
            });
            continue;
        }
        if c == '\'' || c == '"' {
            let (s, next) = string(src, i, offset)?;
            out.push(Token {
                tok: Tok::Str(s),
                at,
            });
            i = next;
            continue;
        }
        if c.is_alphabetic() || c == '_' || c == '$' {
            let start = i;
            i += 1;
            while i < src.len() && (src[i].is_alphanumeric() || src[i] == '_') {
                i += 1;
            }
            let text: String = src[start..i].iter().collect();
            out.push(Token {
                tok: Tok::Ident(text),
                at,
            });
            continue;
        }
        let rest = &src[i..];
        let op = OPS.iter().find(|op| {
            let chars: Vec<char> = op.chars().collect();
            rest.len() >= chars.len() && rest[..chars.len()] == chars[..]
        });
        match op {
            Some(op) => {
                i += op.chars().count();
                out.push(Token {
                    tok: Tok::Op(op),
                    at,
                });
            }
            None => {
                return Err(Diagnostic::new(
                    ErrorCode::Parse,
                    at,
                    &format!("unexpected character {c:?}"),
                ));
            }
        }
    }
    out.push(Token {
        tok: Tok::Eof,
        at: offset + src.len(),
    });
    Ok(out)
}

fn string(src: &[char], start: usize, offset: usize) -> Result<(String, usize), Diagnostic> {
    let quote = src[start];
    let mut i = start + 1;
    let mut s = String::new();
    while i < src.len() {
        let c = src[i];
        if c == quote {
            return Ok((s, i + 1));
        }
        if c == '\\' {
            let esc = src.get(i + 1).ok_or_else(|| {
                Diagnostic::new(ErrorCode::Parse, offset + i, "unfinished escape")
            })?;
            match esc {
                'n' => s.push('\n'),
                't' => s.push('\t'),
                '\\' | '\'' | '"' => s.push(*esc),
                'u' => {
                    // \u{1F600}
                    if src.get(i + 2) != Some(&'{') {
                        return Err(Diagnostic::new(
                            ErrorCode::Parse,
                            offset + i,
                            "bad \\u escape",
                        ));
                    }
                    let close = src[i + 3..].iter().position(|c| *c == '}').ok_or_else(|| {
                        Diagnostic::new(ErrorCode::Parse, offset + i, "bad \\u escape")
                    })?;
                    let hex: String = src[i + 3..i + 3 + close].iter().collect();
                    let ch = Some(&hex)
                        .filter(|h| h.chars().all(|c| c.is_ascii_hexdigit()))
                        .and_then(|h| u32::from_str_radix(h, 16).ok())
                        .and_then(char::from_u32)
                        .ok_or_else(|| {
                            Diagnostic::new(ErrorCode::Parse, offset + i, "bad \\u escape")
                        })?;
                    s.push(ch);
                    i += 3 + close + 1;
                    continue;
                }
                _ => {
                    return Err(Diagnostic::new(
                        ErrorCode::Parse,
                        offset + i,
                        "unknown escape",
                    ));
                }
            }
            i += 2;
            continue;
        }
        s.push(c);
        i += 1;
    }
    Err(Diagnostic::new(
        ErrorCode::Parse,
        offset + start,
        "unclosed string",
    ))
}

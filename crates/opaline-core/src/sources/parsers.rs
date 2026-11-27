//! Output parsers for custom sources: text, lines, JSON (+ RFC 9535 JSONPath), CSV,
//! linear-time Regex captures, Markdown (headings/frontmatter/checklists), and todo.txt
//! (brief §4.4, PLAN-2 task 6.2).

use std::collections::BTreeMap;

use opaline_ipc::Value;
use regex::RegexBuilder;

use super::model::OutputFormat;

const MAX_REGEX_BYTES: usize = 64 * 1024;
const MAX_LINES: usize = 500;

/// Parses raw bytes from a custom source into an IPC [`Value`].
pub fn parse_payload(
    bytes: &[u8],
    format: OutputFormat,
    regex_pattern: Option<&str>,
    json_path: Option<&str>,
) -> Result<Value, String> {
    let text = std::str::from_utf8(bytes).map_err(|_| "output is not valid UTF-8".to_owned())?;
    match format {
        OutputFormat::Text => Ok(Value::Text(text.trim().to_owned())),
        OutputFormat::Lines => {
            let lines: Vec<Value> = text
                .lines()
                .take(MAX_LINES)
                .map(|l| Value::Text(l.to_owned()))
                .collect();
            Ok(Value::List(lines))
        }
        OutputFormat::Json => {
            let parsed: serde_json::Value =
                serde_json::from_str(text).map_err(|e| format!("invalid JSON: {e}"))?;
            let selected = match json_path.map(str::trim).filter(|p| !p.is_empty()) {
                Some(path) => crate::jsonpath::select_one_or_array(&parsed, path)?,
                None => parsed,
            };
            Ok(crate::json::from_json(&selected))
        }
        OutputFormat::Csv => Ok(parse_csv(text)),
        OutputFormat::Regex => {
            let pat = regex_pattern
                .map(str::trim)
                .filter(|p| !p.is_empty())
                .ok_or_else(|| "regex format requires a pattern".to_owned())?;
            parse_regex(text, pat)
        }
        OutputFormat::Markdown => Ok(parse_markdown(text)),
        OutputFormat::Todotxt => Ok(parse_todotxt(text)),
    }
}

fn parse_regex(text: &str, pattern: &str) -> Result<Value, String> {
    let re = RegexBuilder::new(pattern)
        .size_limit(MAX_REGEX_BYTES)
        .build()
        .map_err(|e| format!("invalid regex: {e}"))?;
    let Some(caps) = re.captures(text) else {
        return Ok(Value::map([("matched", Value::Bool(false))]));
    };
    let mut map = BTreeMap::new();
    map.insert("matched".to_owned(), Value::Bool(true));
    if let Some(m) = caps.get(0) {
        map.insert("match".to_owned(), Value::Text(m.as_str().to_owned()));
    }
    let groups: Vec<Value> = caps
        .iter()
        .skip(1)
        .map(|g| {
            g.map_or_else(
                || Value::Text(String::new()),
                |m| Value::Text(m.as_str().to_owned()),
            )
        })
        .collect();
    map.insert("groups".to_owned(), Value::List(groups));
    for name in re.capture_names().flatten() {
        if let Some(m) = caps.name(name) {
            map.insert(name.to_owned(), Value::Text(m.as_str().to_owned()));
        }
    }
    Ok(Value::Map(map))
}

fn parse_csv_line(line: &str) -> Vec<String> {
    let mut cells = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if in_quotes {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    cur.push('"');
                } else {
                    in_quotes = false;
                }
            } else {
                cur.push(c);
            }
        } else if c == '"' && cur.is_empty() {
            in_quotes = true;
        } else if c == ',' {
            cells.push(cur.trim().to_owned());
            cur.clear();
        } else {
            cur.push(c);
        }
    }
    cells.push(cur.trim().to_owned());
    cells
}

fn parse_csv(text: &str) -> Value {
    let mut rows = text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .take(MAX_LINES + 1);
    let Some(header_line) = rows.next() else {
        return Value::List(Vec::new());
    };
    let headers = parse_csv_line(header_line);
    let data: Vec<Value> = rows
        .map(|line| {
            let cols = parse_csv_line(line);
            let mut obj = BTreeMap::new();
            for (idx, h) in headers.iter().enumerate() {
                let raw = cols.get(idx).map_or("", String::as_str);
                let val = if let Ok(n) = raw.parse::<f64>() {
                    if n.is_finite() {
                        Value::Num(n)
                    } else {
                        Value::Text(raw.to_owned())
                    }
                } else {
                    Value::Text(raw.to_owned())
                };
                obj.insert(h.clone(), val);
            }
            Value::Map(obj)
        })
        .collect();
    if data.is_empty() {
        Value::List(headers.into_iter().map(Value::Text).collect())
    } else {
        Value::List(data)
    }
}

fn parse_markdown(text: &str) -> Value {
    let mut frontmatter = BTreeMap::new();
    let mut body_start = 0usize;
    let lines: Vec<&str> = text.lines().collect();
    if lines.first().is_some_and(|l| l.trim() == "---") {
        for (i, line) in lines.iter().enumerate().skip(1) {
            if line.trim() == "---" {
                body_start = i + 1;
                break;
            }
            if let Some((k, v)) = line.split_once(':') {
                frontmatter.insert(
                    k.trim().to_owned(),
                    Value::Text(v.trim().trim_matches('"').to_owned()),
                );
            }
        }
    }

    let mut title = String::new();
    let mut headings = Vec::new();
    let mut tasks = Vec::new();
    let mut done_count = 0u64;
    let mut body_lines = Vec::new();

    for line in lines.iter().skip(body_start).take(MAX_LINES) {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("# ") {
            if title.is_empty() {
                title = rest.trim().to_owned();
            }
            headings.push(Value::Text(rest.trim().to_owned()));
        } else if trimmed.starts_with("## ") || trimmed.starts_with("### ") {
            let h = trimmed.trim_start_matches('#').trim();
            headings.push(Value::Text(h.to_owned()));
        } else if let Some(rest) = trimmed
            .strip_prefix("- [ ] ")
            .or_else(|| trimmed.strip_prefix("* [ ] "))
        {
            tasks.push(Value::map([
                ("text", Value::Text(rest.trim().to_owned())),
                ("done", Value::Bool(false)),
            ]));
        } else if let Some(rest) = trimmed
            .strip_prefix("- [x] ")
            .or_else(|| trimmed.strip_prefix("- [X] "))
            .or_else(|| trimmed.strip_prefix("* [x] "))
            .or_else(|| trimmed.strip_prefix("* [X] "))
        {
            done_count += 1;
            tasks.push(Value::map([
                ("text", Value::Text(rest.trim().to_owned())),
                ("done", Value::Bool(true)),
            ]));
        }
        body_lines.push(*line);
    }

    let total_tasks = tasks.len() as u64;
    Value::map([
        ("title", Value::Text(title)),
        ("frontmatter", Value::Map(frontmatter)),
        ("headings", Value::List(headings)),
        ("tasks", Value::List(tasks)),
        ("doneCount", Value::Num(done_count as f64)),
        ("totalCount", Value::Num(total_tasks as f64)),
        ("openCount", Value::Num((total_tasks - done_count) as f64)),
        ("body", Value::Text(body_lines.join("\n").trim().to_owned())),
    ])
}

fn parse_todotxt(text: &str) -> Value {
    let mut items = Vec::new();
    let mut done_count = 0u64;

    for raw in text.lines().take(MAX_LINES) {
        let mut line = raw.trim();
        if line.is_empty() {
            continue;
        }
        let done = if let Some(rest) = line.strip_prefix("x ") {
            line = rest.trim_start();
            done_count += 1;
            true
        } else {
            false
        };
        let mut priority = String::new();
        let bytes = line.as_bytes();
        if bytes.len() >= 4
            && bytes[0] == b'('
            && bytes[1].is_ascii_uppercase()
            && bytes[2] == b')'
            && bytes[3] == b' '
        {
            priority.push(bytes[1] as char);
            line = line[4..].trim_start();
        }
        let mut projects = Vec::new();
        let mut contexts = Vec::new();
        let mut due = String::new();
        let mut words = Vec::new();
        for tok in line.split_whitespace() {
            if let Some(p) = tok.strip_prefix('+')
                && !p.is_empty()
            {
                projects.push(Value::Text(p.to_owned()));
            } else if let Some(c) = tok.strip_prefix('@')
                && !c.is_empty()
            {
                contexts.push(Value::Text(c.to_owned()));
            } else if let Some(d) = tok.strip_prefix("due:") {
                due = d.to_owned();
            } else {
                words.push(tok);
            }
        }
        items.push(Value::map([
            ("text", Value::Text(words.join(" "))),
            ("done", Value::Bool(done)),
            ("priority", Value::Text(priority)),
            ("due", Value::Text(due)),
            ("projects", Value::List(projects)),
            ("contexts", Value::List(contexts)),
        ]));
    }
    let total = items.len() as u64;
    Value::map([
        ("items", Value::List(items)),
        ("doneCount", Value::Num(done_count as f64)),
        ("openCount", Value::Num((total - done_count) as f64)),
        ("totalCount", Value::Num(total as f64)),
    ])
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::panic)]

    use super::*;

    #[test]
    fn parses_csv_regex_markdown_todotxt_and_jsonpath() {
        let csv = parse_payload(
            b"name,score\n\"Alice, A\",42\nBob,19\n",
            OutputFormat::Csv,
            None,
            None,
        )
        .unwrap();
        let Value::List(rows) = csv else {
            panic!("expected list")
        };
        assert_eq!(rows.len(), 2);

        let rx = parse_payload(
            b"load: 1.42 cores: 8",
            OutputFormat::Regex,
            Some(r"load:\s*(?P<load>[0-9.]+)"),
            None,
        )
        .unwrap();
        let Value::Map(m) = rx else {
            panic!("expected map")
        };
        assert_eq!(m.get("load"), Some(&Value::Text("1.42".into())));

        let md = parse_payload(
            b"---\ntitle: Notes\n---\n# Today\n- [x] Ship P5\n- [ ] Build P6\n",
            OutputFormat::Markdown,
            None,
            None,
        )
        .unwrap();
        let Value::Map(m) = md else {
            panic!("expected map")
        };
        assert_eq!(m.get("title"), Some(&Value::Text("Today".into())));
        assert_eq!(m.get("doneCount"), Some(&Value::Num(1.0)));
        assert_eq!(m.get("openCount"), Some(&Value::Num(1.0)));

        let td = parse_payload(
            b"(A) Review PR +opaline @work due:2026-12-01\nx Finish P5 +opaline\n",
            OutputFormat::Todotxt,
            None,
            None,
        )
        .unwrap();
        let Value::Map(m) = td else {
            panic!("expected map")
        };
        assert_eq!(m.get("openCount"), Some(&Value::Num(1.0)));
        assert_eq!(m.get("doneCount"), Some(&Value::Num(1.0)));

        let jp = parse_payload(
            br#"{"data":{"temp":23.5}}"#,
            OutputFormat::Json,
            None,
            Some("$.data.temp"),
        )
        .unwrap();
        assert_eq!(jp, Value::Num(23.5));
    }
}

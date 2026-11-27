//! Local to-do list provider (`todo.txt` format in `~/.local/share/opaline/todos.txt`) with
//! add, toggle, delete, priority, and due-date support (brief §8.3, PLAN-2 task 7.3).

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use opaline_ipc::{Topic, TopicUpdate, Value};

use crate::hub::Hub;

pub const TODOS: &str = "todos.list";
const MAX_TODOS: usize = 200;

fn todos_path() -> Result<PathBuf, String> {
    let dir = crate::paths::data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("todos.txt"))
}

pub fn load_todos_from(path: &Path) -> Value {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let mut items = Vec::new();
    let mut done_count = 0u64;

    for (idx, raw) in text.lines().take(MAX_TODOS).enumerate() {
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
        let mut due = String::new();
        let mut projects = Vec::new();
        let mut words = Vec::new();
        for tok in line.split_whitespace() {
            if let Some(d) = tok.strip_prefix("due:") {
                due = d.to_owned();
            } else if let Some(p) = tok.strip_prefix('+')
                && !p.is_empty()
            {
                projects.push(Value::Text(p.to_owned()));
            } else {
                words.push(tok);
            }
        }
        items.push(Value::map([
            ("index", Value::Num(idx as f64)),
            ("text", Value::Text(words.join(" "))),
            ("done", Value::Bool(done)),
            ("priority", Value::Text(priority)),
            ("due", Value::Text(due)),
            ("projects", Value::List(projects)),
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

pub fn add_todo_in(
    path: &Path,
    text: &str,
    priority: Option<&str>,
    due: Option<&str>,
) -> Result<(), String> {
    let clean = text.trim().replace(['\n', '\r'], " ");
    if clean.is_empty() || clean.len() > 240 {
        return Err("invalid-todo-text".into());
    }
    let mut line = String::new();
    if let Some(p) = priority.and_then(|s| s.chars().next())
        && p.is_ascii_uppercase()
    {
        line.push('(');
        line.push(p);
        line.push_str(") ");
    }
    line.push_str(&clean);
    if let Some(d) = due.map(str::trim).filter(|s| !s.is_empty()) {
        line.push_str(" due:");
        line.push_str(d);
    }
    let mut existing = std::fs::read_to_string(path).unwrap_or_default();
    if !existing.is_empty() && !existing.ends_with('\n') {
        existing.push('\n');
    }
    existing.push_str(&line);
    existing.push('\n');
    crate::paths::write_atomic(path, existing.as_bytes()).map_err(|e| e.to_string())
}

pub fn toggle_todo_in(path: &Path, index: usize) -> Result<(), String> {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let mut lines: Vec<String> = text.lines().map(str::to_owned).collect();
    let Some(line) = lines.get_mut(index) else {
        return Err("todo-index-out-of-range".into());
    };
    if let Some(rest) = line.strip_prefix("x ") {
        *line = rest.to_owned();
    } else {
        *line = format!("x {line}");
    }
    let mut out = lines.join("\n");
    if !out.is_empty() {
        out.push('\n');
    }
    crate::paths::write_atomic(path, out.as_bytes()).map_err(|e| e.to_string())
}

pub fn delete_todo_in(path: &Path, index: usize) -> Result<(), String> {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let mut lines: Vec<String> = text.lines().map(str::to_owned).collect();
    if index >= lines.len() {
        return Err("todo-index-out-of-range".into());
    }
    lines.remove(index);
    let mut out = lines.join("\n");
    if !out.is_empty() {
        out.push('\n');
    }
    crate::paths::write_atomic(path, out.as_bytes()).map_err(|e| e.to_string())
}

pub fn add_todo(
    hub: &Hub,
    text: &str,
    priority: Option<&str>,
    due: Option<&str>,
) -> Result<(), String> {
    let path = todos_path()?;
    add_todo_in(&path, text, priority, due)?;
    hub.publish(vec![TopicUpdate {
        topic: Topic::new(TODOS),
        value: load_todos_from(&path),
    }]);
    Ok(())
}

pub fn toggle_todo(hub: &Hub, index: usize) -> Result<(), String> {
    let path = todos_path()?;
    toggle_todo_in(&path, index)?;
    hub.publish(vec![TopicUpdate {
        topic: Topic::new(TODOS),
        value: load_todos_from(&path),
    }]);
    Ok(())
}

pub fn delete_todo(hub: &Hub, index: usize) -> Result<(), String> {
    let path = todos_path()?;
    delete_todo_in(&path, index)?;
    hub.publish(vec![TopicUpdate {
        topic: Topic::new(TODOS),
        value: load_todos_from(&path),
    }]);
    Ok(())
}

pub async fn run(hub: Arc<Hub>) -> Result<(), String> {
    let path = todos_path()?;
    let mut tick = tokio::time::interval(Duration::from_secs(5));
    loop {
        tick.tick().await;
        if hub.paused() || !hub.is_subscribed(TODOS) {
            continue;
        }
        let p = path.clone();
        let val = tokio::task::spawn_blocking(move || load_todos_from(&p))
            .await
            .map_err(|e| e.to_string())?;
        hub.publish(vec![TopicUpdate {
            topic: Topic::new(TODOS),
            value: val,
        }]);
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    #[test]
    fn adds_toggles_and_deletes_todotxt_items() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("todos.txt");
        add_todo_in(&p, "Release 2.0 +opaline", Some("A"), Some("2026-12-01")).unwrap();
        let v = load_todos_from(&p);
        let Value::Map(m) = v else { return };
        assert_eq!(m.get("openCount"), Some(&Value::Num(1.0)));

        toggle_todo_in(&p, 0).unwrap();
        let v2 = load_todos_from(&p);
        let Value::Map(m2) = v2 else { return };
        assert_eq!(m2.get("doneCount"), Some(&Value::Num(1.0)));

        delete_todo_in(&p, 0).unwrap();
        let v3 = load_todos_from(&p);
        let Value::Map(m3) = v3 else { return };
        assert_eq!(m3.get("totalCount"), Some(&Value::Num(0.0)));
    }
}

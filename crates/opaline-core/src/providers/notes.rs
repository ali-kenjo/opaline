//! Markdown notes provider with safe atomic write-back and external-edit conflict detection
//! (brief §8.3, PLAN-2 task 7.3).

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};

use opaline_ipc::{Topic, TopicUpdate, Value};
use sha2::{Digest, Sha256};

use crate::hub::Hub;

pub const NOTES: &str = "notes.list";
const MAX_NOTE_BYTES: usize = 256 * 1024;
const MAX_NOTES: usize = 40;

fn notes_dir() -> Result<PathBuf, String> {
    let dir = crate::paths::data_dir()
        .map_err(|e| e.to_string())?
        .join("notes");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    hex::encode(h.finalize())
}

fn ensure_starter_note(dir: &Path) {
    let is_empty = std::fs::read_dir(dir)
        .ok()
        .is_none_or(|mut d| d.next().is_none());
    if is_empty {
        let welcome = dir.join("welcome.md");
        let body = "# Quick Notes\n\n- [ ] Click any checkbox to toggle in the file\n- [ ] Click Edit to type directly on the desktop\n";
        let _ = crate::paths::write_atomic(&welcome, body.as_bytes());
    }
}

/// Parses Markdown checkboxes (`- [ ]` / `- [x]`) with their 0-based line indices.
pub fn extract_tasks(body: &str) -> Vec<Value> {
    let mut out = Vec::new();
    for (idx, line) in body.lines().enumerate() {
        let trimmed = line.trim_start();
        if let Some(rest) = trimmed
            .strip_prefix("- [ ] ")
            .or_else(|| trimmed.strip_prefix("* [ ] "))
        {
            out.push(Value::map([
                ("line", Value::Num(idx as f64)),
                ("text", Value::Text(rest.trim().to_owned())),
                ("done", Value::Bool(false)),
            ]));
        } else if let Some(rest) = trimmed
            .strip_prefix("- [x] ")
            .or_else(|| trimmed.strip_prefix("- [X] "))
            .or_else(|| trimmed.strip_prefix("* [x] "))
            .or_else(|| trimmed.strip_prefix("* [X] "))
        {
            out.push(Value::map([
                ("line", Value::Num(idx as f64)),
                ("text", Value::Text(rest.trim().to_owned())),
                ("done", Value::Bool(true)),
            ]));
        }
    }
    out
}

/// Scans `dir` for `.md` files and builds the `notes.list` topic payload.
pub fn load_notes_from(dir: &Path) -> Value {
    let mut items: Vec<(u64, Value)> = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Value::List(Vec::new());
    };
    for entry in entries.flatten().take(MAX_NOTES) {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() || meta.len() > MAX_NOTE_BYTES as u64 {
            continue;
        }
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        let Ok(body) = String::from_utf8(bytes.clone()) else {
            continue;
        };
        let id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("note")
            .to_owned();
        let title = body
            .lines()
            .find_map(|l| l.trim().strip_prefix("# ").map(str::trim))
            .unwrap_or(&id)
            .to_owned();
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX));
        let tasks = extract_tasks(&body);
        let entry_val = Value::map([
            ("id", Value::Text(id)),
            ("path", Value::Text(path.display().to_string())),
            ("title", Value::Text(title)),
            ("body", Value::Text(body)),
            ("sha256", Value::Text(sha256_hex(&bytes))),
            ("modifiedMs", Value::Num(modified_ms as f64)),
            ("tasks", Value::List(tasks)),
        ]);
        items.push((modified_ms, entry_val));
    }
    items.sort_by_key(|a| std::cmp::Reverse(a.0));
    Value::List(items.into_iter().map(|(_, v)| v).collect())
}

fn validate_note_id(id: &str) -> Result<String, String> {
    let clean = id.trim().trim_end_matches(".md");
    if clean.is_empty()
        || clean.len() > 64
        || !clean
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
        || clean.contains("..")
    {
        return Err("invalid-note-id".into());
    }
    Ok(clean.to_owned())
}

/// Saves a Markdown note safely, refusing to clobber outside edits if `expected_sha256` doesn't match.
pub fn save_note_in(
    dir: &Path,
    id: &str,
    body: &str,
    expected_sha256: Option<&str>,
) -> Result<(), String> {
    let clean = validate_note_id(id)?;
    if body.len() > MAX_NOTE_BYTES {
        return Err("note-too-large".into());
    }
    let path = dir.join(format!("{clean}.md"));
    if let Some(expected) = expected_sha256
        && !expected.is_empty()
        && let Ok(existing) = std::fs::read(&path)
        && sha256_hex(&existing) != expected
    {
        return Err("conflict-external-edit".into());
    }
    crate::paths::write_atomic(&path, body.as_bytes()).map_err(|e| e.to_string())
}

/// Toggles one Markdown checkbox line (`- [ ]` ⇄ `- [x]`) in place and writes back atomically.
pub fn toggle_checkbox_in(dir: &Path, id: &str, line_idx: usize) -> Result<(), String> {
    let clean = validate_note_id(id)?;
    let path = dir.join(format!("{clean}.md"));
    let text = std::fs::read_to_string(&path).map_err(|e| format!("note-not-found: {e}"))?;
    let mut lines: Vec<String> = text.lines().map(str::to_owned).collect();
    let Some(line) = lines.get_mut(line_idx) else {
        return Err("line-out-of-range".into());
    };
    if line.contains("- [ ] ") {
        *line = line.replacen("- [ ] ", "- [x] ", 1);
    } else if line.contains("- [x] ") {
        *line = line.replacen("- [x] ", "- [ ] ", 1);
    } else if line.contains("- [X] ") {
        *line = line.replacen("- [X] ", "- [ ] ", 1);
    } else if line.contains("* [ ] ") {
        *line = line.replacen("* [ ] ", "* [x] ", 1);
    } else if line.contains("* [x] ") {
        *line = line.replacen("* [x] ", "* [ ] ", 1);
    } else {
        return Err("line-has-no-checkbox".into());
    }
    let mut next = lines.join("\n");
    if text.ends_with('\n') {
        next.push('\n');
    }
    crate::paths::write_atomic(&path, next.as_bytes()).map_err(|e| e.to_string())
}

pub fn save_note(
    hub: &Hub,
    id: &str,
    body: &str,
    expected_sha256: Option<&str>,
) -> Result<(), String> {
    let dir = notes_dir()?;
    save_note_in(&dir, id, body, expected_sha256)?;
    hub.publish(vec![TopicUpdate {
        topic: Topic::new(NOTES),
        value: load_notes_from(&dir),
    }]);
    Ok(())
}

pub fn toggle_checkbox(hub: &Hub, id: &str, line_idx: usize) -> Result<(), String> {
    let dir = notes_dir()?;
    toggle_checkbox_in(&dir, id, line_idx)?;
    hub.publish(vec![TopicUpdate {
        topic: Topic::new(NOTES),
        value: load_notes_from(&dir),
    }]);
    Ok(())
}

pub async fn run(hub: Arc<Hub>) -> Result<(), String> {
    let dir = notes_dir()?;
    ensure_starter_note(&dir);
    let mut tick = tokio::time::interval(Duration::from_secs(5));
    loop {
        tick.tick().await;
        if hub.paused() || !hub.is_subscribed(NOTES) {
            continue;
        }
        let d = dir.clone();
        let val = tokio::task::spawn_blocking(move || load_notes_from(&d))
            .await
            .map_err(|e| e.to_string())?;
        hub.publish(vec![TopicUpdate {
            topic: Topic::new(NOTES),
            value: val,
        }]);
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    #[test]
    fn safe_write_detects_external_edits_and_toggles_checkboxes() {
        let dir = tempfile::tempdir().unwrap();
        save_note_in(dir.path(), "daily", "# Daily\n- [ ] Ship P7\n", None).unwrap();

        let original_sha = sha256_hex(b"# Daily\n- [ ] Ship P7\n");
        // External edit changes the file on disk.
        std::fs::write(dir.path().join("daily.md"), "# Daily\n- [ ] External\n").unwrap();
        // Saving with stale sha256 fails safely instead of clobbering.
        assert_eq!(
            save_note_in(dir.path(), "daily", "overwrite", Some(&original_sha)),
            Err("conflict-external-edit".into())
        );

        toggle_checkbox_in(dir.path(), "daily", 1).unwrap();
        let updated = std::fs::read_to_string(dir.path().join("daily.md")).unwrap();
        assert!(updated.contains("- [x] External"));

        // Traversal ids rejected.
        assert!(save_note_in(dir.path(), "../evil", "x", None).is_err());
    }
}

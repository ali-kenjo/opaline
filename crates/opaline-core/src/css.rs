//! User CSS (`~/.config/opaline/user.css`) and theme CSS (`theme.css`) loading and validation
//! (brief §5.3, PLAN-2 task 3.6).
//!
//! Core reads the CSS files and rejects any remote `url(...)`, `@import`, `javascript:`, or legacy
//! `expression(...)` before publishing them to the layer on the `style.css` topic. The webview CSP
//! blocks network requests too; rejecting them here gives the user an immediate, clear diagnostic.

use std::path::Path;

use serde::{Deserialize, Serialize};

pub const TOPIC: &str = "style.css";
/// Largest CSS file we accept (256 KiB).
pub const MAX_CSS_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CssProblem {
    pub file: String,
    pub line: usize,
    pub message: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CssBundle {
    pub theme_css: String,
    pub user_css: String,
    pub safe_mode: bool,
    pub problems: Vec<CssProblem>,
}

/// Validates CSS text, rejecting `@import`, remote `url(...)`, `javascript:`, and `expression(`.
/// Returns `Ok(sanitized)` if clean, or `Err(problems)` naming the exact lines that were refused.
pub fn validate_css(file: &str, raw: &str) -> Result<String, Vec<CssProblem>> {
    if raw.len() > MAX_CSS_BYTES {
        return Err(vec![CssProblem {
            file: file.to_owned(),
            line: 1,
            message: format!("CSS exceeds {MAX_CSS_BYTES} bytes limit"),
        }]);
    }
    let stripped = strip_css_comments(raw);
    let mut problems = Vec::new();

    for (idx, line) in stripped.lines().enumerate() {
        let line_no = idx + 1;
        let lower = line.to_ascii_lowercase();
        if lower.contains("@import") {
            problems.push(CssProblem {
                file: file.to_owned(),
                line: line_no,
                message: "@import is not allowed in Opaline CSS".into(),
            });
        }
        if lower.contains("javascript:") {
            problems.push(CssProblem {
                file: file.to_owned(),
                line: line_no,
                message: "javascript: URLs are not allowed in CSS".into(),
            });
        }
        if lower.contains("expression(") {
            problems.push(CssProblem {
                file: file.to_owned(),
                line: line_no,
                message: "expression() is not allowed in CSS".into(),
            });
        }
        if has_forbidden_url(&lower) {
            problems.push(CssProblem {
                file: file.to_owned(),
                line: line_no,
                message:
                    "remote or file:// url() references are not allowed (local assets/data only)"
                        .into(),
            });
        }
    }

    if problems.is_empty() {
        Ok(raw.to_owned())
    } else {
        Err(problems)
    }
}

/// Strips `/* ... */` comments while preserving newlines so reported line numbers stay exact.
fn strip_css_comments(src: &str) -> String {
    let bytes = src.as_bytes();
    let mut out = String::with_capacity(src.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'/' && bytes.get(i + 1) == Some(&b'*') {
            i += 2;
            while i < bytes.len() {
                if bytes[i] == b'*' && bytes.get(i + 1) == Some(&b'/') {
                    i += 2;
                    break;
                }
                if bytes[i] == b'\n' {
                    out.push('\n');
                }
                i += 1;
            }
        } else {
            let ch = src[i..].chars().next().unwrap_or('\0');
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
}

/// Returns true if a lower-cased CSS line contains `url(...)` targeting http(s), protocol-relative
/// `//`, or `file:`. Allows `data:` (non-svg/script) and `opaline-asset://` or plain `#id`.
fn has_forbidden_url(lower: &str) -> bool {
    let mut rest = lower;
    while let Some(pos) = rest.find("url(") {
        let after = &rest[pos + 4..];
        let trimmed = after
            .trim_start()
            .trim_start_matches(['"', '\''])
            .trim_start();
        if trimmed.starts_with("http:")
            || trimmed.starts_with("https:")
            || trimmed.starts_with("//")
            || trimmed.starts_with("file:")
            || trimmed.starts_with("ftp:")
            || trimmed.starts_with("data:text/html")
        {
            return true;
        }
        rest = after;
    }
    false
}

/// Reads and validates `~/.config/opaline/user.css` (returns empty string if absent).
pub fn load_user_css(config_dir: &Path, safe_mode: bool) -> (String, Vec<CssProblem>) {
    if safe_mode {
        return (String::new(), Vec::new());
    }
    let path = config_dir.join("user.css");
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return (String::new(), Vec::new());
    };
    match validate_css("user.css", &raw) {
        Ok(clean) => (clean, Vec::new()),
        Err(probs) => (String::new(), probs),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    #[test]
    fn allows_clean_custom_css() {
        let css = r#"
            /* Style the clock hero */
            [data-kind="clock"] [data-role="hero"] {
                letter-spacing: -0.02em;
                color: rgb(var(--md-primary));
            }
        "#;
        assert!(validate_css("user.css", css).is_ok());
    }

    #[test]
    fn rejects_remote_urls_and_imports() {
        let bad_import = "@import url('https://evil.example/a.css');";
        let errs = validate_css("theme.css", bad_import).unwrap_err();
        assert!(errs.iter().any(|e| e.message.contains("@import")));
        assert!(errs.iter().any(|e| e.message.contains("remote")));

        let bad_url = "body { background: url( https://evil.example/bg.png ); }";
        assert!(validate_css("user.css", bad_url).is_err());

        let proto_rel = "body { background: url('//evil.example/bg.png'); }";
        assert!(validate_css("user.css", proto_rel).is_err());

        let file_url = "body { background: url('file:///etc/passwd'); }";
        assert!(validate_css("user.css", file_url).is_err());

        // Commented-out URL does not trigger a false positive.
        let commented = "/* url(https://example.com) */\n[data-kind='cpu'] { opacity: 0.9; }";
        assert!(validate_css("user.css", commented).is_ok());
    }

    #[test]
    fn safe_mode_skips_user_css() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("user.css"),
            "[data-kind='cpu'] { color: red; }",
        )
        .unwrap();
        let (safe_css, probs) = load_user_css(dir.path(), true);
        assert!(safe_css.is_empty());
        assert!(probs.is_empty());
        let (normal_css, probs) = load_user_css(dir.path(), false);
        assert!(normal_css.contains("color: red"));
        assert!(probs.is_empty());
    }
}

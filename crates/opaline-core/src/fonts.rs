//! Installed font families for the widget font picker (ADR 0011), from fontconfig's `fc-list`.
//! Bundled families (Roboto Flex, Inter, Noto Sans Arabic) are added by the frontend.

use std::time::Duration;

use opaline_ipc::Value;

const MAX_FAMILIES: usize = 2000;

/// Parses `fc-list --format '%{family[0]}\n'`: unique, sorted, without hidden (dot) families.
pub fn parse(output: &str) -> Vec<String> {
    let mut families: Vec<String> = output
        .lines()
        .map(str::trim)
        .filter(|f| !f.is_empty() && !f.starts_with('.') && f.chars().count() <= 100)
        .map(|f| f.replace('\\', ""))
        .collect();
    families.sort_by(|a, b| {
        a.to_lowercase()
            .cmp(&b.to_lowercase())
            .then_with(|| a.cmp(b))
    });
    families.dedup();
    families.truncate(MAX_FAMILIES);
    families
}

pub async fn list() -> Result<Value, String> {
    let run = tokio::process::Command::new("fc-list")
        .args(["--format", "%{family[0]}\n", ":scalable=true"])
        .kill_on_drop(true)
        .output();
    let out = tokio::time::timeout(Duration::from_secs(5), run)
        .await
        .map_err(|_| "fc-list-timeout".to_owned())?
        .map_err(|_| "fontconfig-unavailable".to_owned())?;
    if !out.status.success() {
        return Err("fontconfig-unavailable".into());
    }
    let text = String::from_utf8_lossy(&out.stdout);
    Ok(Value::List(
        parse(&text).into_iter().map(Value::from).collect(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_dedups_and_sorts() {
        let out = "Noto Sans\nAmiri\n.Hidden\nnoto sans\nNoto Sans\n\nDejaVu Sans\n";
        assert_eq!(
            parse(out),
            ["Amiri", "DejaVu Sans", "Noto Sans", "noto sans"]
        );
    }
}

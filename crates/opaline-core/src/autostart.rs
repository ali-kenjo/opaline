//! XDG autostart management (`~/.config/autostart/io.github.ali_kenjo.Opaline.desktop`, brief §9).

use std::path::{Path, PathBuf};

const DESKTOP_FILENAME: &str = "io.github.ali_kenjo.Opaline.desktop";

fn autostart_path() -> Result<PathBuf, String> {
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .ok_or_else(|| "no-config-dir".to_owned())?;
    Ok(base.join("autostart").join(DESKTOP_FILENAME))
}

fn desktop_entry_content(exec: &str) -> String {
    format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Version=1.0\n\
         Name=Opaline\n\
         Comment=Glass widgets for your Ubuntu desktop\n\
         Exec={exec}\n\
         Icon=io.github.ali_kenjo.Opaline\n\
         Terminal=false\n\
         Categories=Utility;\n\
         X-GNOME-Autostart-enabled=true\n\
         X-GNOME-Autostart-Delay=2\n"
    )
}

/// Resolves the executable path to put in the autostart entry (prefers `/usr/bin/opaline` if
/// installed system-wide, else the running binary).
fn preferred_exec() -> String {
    let installed = Path::new("/usr/bin/opaline");
    if installed.is_file() {
        return "/usr/bin/opaline".to_owned();
    }
    std::env::current_exe()
        .ok()
        .and_then(|p| p.to_str().map(str::to_owned))
        .unwrap_or_else(|| "opaline".to_owned())
}

/// Returns whether Opaline is configured to start automatically on login.
pub fn is_enabled() -> bool {
    autostart_path().is_ok_and(|p| is_enabled_at(&p))
}

fn is_enabled_at(path: &Path) -> bool {
    let Ok(text) = std::fs::read_to_string(path) else {
        return false;
    };
    !text.lines().any(|line| {
        let trimmed = line.trim();
        trimmed.eq_ignore_ascii_case("Hidden=true")
            || trimmed.eq_ignore_ascii_case("X-GNOME-Autostart-enabled=false")
    })
}

/// Enables or disables XDG autostart for the current user.
pub fn set_enabled(enabled: bool) -> Result<(), String> {
    let path = autostart_path()?;
    set_enabled_at(&path, enabled, &preferred_exec())
}

fn set_enabled_at(path: &Path, enabled: bool, exec: &str) -> Result<(), String> {
    if enabled {
        let content = desktop_entry_content(exec);
        crate::paths::write_atomic(path, content.as_bytes()).map_err(|e| e.to_string())
    } else if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    #[test]
    fn enables_reads_and_disables_autostart_entry() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("autostart").join(DESKTOP_FILENAME);
        assert!(!is_enabled_at(&file));

        set_enabled_at(&file, true, "/usr/bin/opaline").unwrap();
        assert!(is_enabled_at(&file));
        let text = std::fs::read_to_string(&file).unwrap();
        assert!(text.contains("Exec=/usr/bin/opaline"));
        assert!(text.contains("X-GNOME-Autostart-enabled=true"));

        set_enabled_at(&file, false, "/usr/bin/opaline").unwrap();
        assert!(!file.exists());
        assert!(!is_enabled_at(&file));

        // Disabling when already absent is a clean no-op.
        set_enabled_at(&file, false, "/usr/bin/opaline").unwrap();
    }

    #[test]
    fn hidden_entry_counts_as_disabled() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join(DESKTOP_FILENAME);
        std::fs::write(&file, "[Desktop Entry]\nHidden=true\n").unwrap();
        assert!(!is_enabled_at(&file));
    }
}

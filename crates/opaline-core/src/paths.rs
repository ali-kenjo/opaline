//! XDG base directories for Opaline (brief §1.1).

use std::path::PathBuf;

const APP_DIR: &str = "opaline";

#[derive(Debug, thiserror::Error)]
#[error("neither ${var} nor $HOME is set")]
pub struct NoHomeError {
    var: &'static str,
}

fn xdg(var: &'static str, fallback: &str) -> Result<PathBuf, NoHomeError> {
    if let Some(dir) = std::env::var_os(var).filter(|v| !v.is_empty()) {
        let dir = PathBuf::from(dir);
        // The spec says relative paths are invalid and must be ignored.
        if dir.is_absolute() {
            return Ok(dir.join(APP_DIR));
        }
    }
    let home = std::env::var_os("HOME")
        .filter(|v| !v.is_empty())
        .ok_or(NoHomeError { var })?;
    Ok(PathBuf::from(home).join(fallback).join(APP_DIR))
}

/// `~/.config/opaline`: `settings.json`, `layouts.json`.
pub fn config_dir() -> Result<PathBuf, NoHomeError> {
    xdg("XDG_CONFIG_HOME", ".config")
}

/// `~/.local/share/opaline`: history database.
pub fn data_dir() -> Result<PathBuf, NoHomeError> {
    xdg("XDG_DATA_HOME", ".local/share")
}

/// `~/.cache/opaline`: wallpaper renders, album art, weather.
pub fn cache_dir() -> Result<PathBuf, NoHomeError> {
    xdg("XDG_CACHE_HOME", ".cache")
}

/// `~/.local/state/opaline`: logs.
pub fn state_dir() -> Result<PathBuf, NoHomeError> {
    xdg("XDG_STATE_HOME", ".local/state")
}

/// Writes a file atomically: `<name>.tmp`, fsync, rename over the target, fsync the directory
/// (ARCHITECTURE §3.6). Creates the parent directory if needed.
pub fn write_atomic(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let dir = path
        .parent()
        .ok_or_else(|| std::io::Error::other("path has no parent directory"))?;
    std::fs::create_dir_all(dir)?;
    let mut tmp_name = path.as_os_str().to_owned();
    tmp_name.push(".tmp");
    let tmp = PathBuf::from(tmp_name);
    {
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    std::fs::rename(&tmp, path)?;
    std::fs::File::open(dir)?.sync_all()
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    #[test]
    fn atomic_write_replaces_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sub/settings.json");
        write_atomic(&path, b"one").unwrap();
        write_atomic(&path, b"two").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"two");
        assert!(!dir.path().join("sub/settings.json.tmp").exists());
    }
}

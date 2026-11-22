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

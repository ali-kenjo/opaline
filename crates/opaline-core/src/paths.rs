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

/// Writes a file atomically: a temp file next to it, fsync, rename over the target, fsync the
/// directory (ARCHITECTURE §3.6). Creates the parent directory if needed.
///
/// Every call gets its own temp file (`<name>.<pid>.<n>.tmp`), so overlapping writes of the same
/// file can't truncate or steal each other's temp file: each rename installs one complete version
/// and the last rename wins. The file watcher ignores `*.tmp`.
pub fn write_atomic(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);

    let dir = path
        .parent()
        .ok_or_else(|| std::io::Error::other("path has no parent directory"))?;
    std::fs::create_dir_all(dir)?;
    let mut tmp_name = path.as_os_str().to_owned();
    tmp_name.push(format!(
        ".{}.{}.tmp",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let tmp = PathBuf::from(tmp_name);
    let written = (|| {
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        std::fs::rename(&tmp, path)
    })();
    if written.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    written?;
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
        let leftovers: Vec<_> = std::fs::read_dir(dir.path().join("sub"))
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .filter(|n| n != "settings.json")
            .collect();
        assert!(
            leftovers.is_empty(),
            "temp files left behind: {leftovers:?}"
        );
    }

    /// Overlapping writes of one file (the first-start seeding did three at once) all succeed,
    /// and the file always holds one complete version, never a mix or a truncated one.
    #[test]
    fn overlapping_writes_never_fail_or_tear() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let versions: Vec<Vec<u8>> = (0..8u8).map(|i| vec![b'a' + i; 64 * 1024]).collect();
        std::thread::scope(|scope| {
            for v in &versions {
                let path = &path;
                scope.spawn(move || {
                    for _ in 0..25 {
                        write_atomic(path, v).unwrap();
                        let now = std::fs::read(path).unwrap();
                        assert_eq!(now.len(), 64 * 1024, "torn write");
                        assert!(now.iter().all(|b| *b == now[0]), "mixed write");
                    }
                });
            }
        });
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}

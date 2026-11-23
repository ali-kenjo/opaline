//! File access for providers: a [`Root`] that is `/` in the product and a fixture directory in
//! tests, and [`HotFile`] for files read every tick (ARCHITECTURE §3.2, "cheap reads").

use std::fs::File;
use std::io;
use std::os::unix::fs::FileExt;
use std::path::{Path, PathBuf};

/// Where `/proc` and `/sys` live: `/` normally, `fixtures/<machine>/` in tests.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Root(PathBuf);

impl Default for Root {
    fn default() -> Self {
        Self::system()
    }
}

impl Root {
    pub fn system() -> Self {
        Self(PathBuf::from("/"))
    }

    pub fn at(dir: impl Into<PathBuf>) -> Self {
        Self(dir.into())
    }

    /// Maps an absolute path like `/proc/stat` into this root.
    pub fn path(&self, abs: impl AsRef<Path>) -> PathBuf {
        let abs = abs.as_ref();
        self.0.join(abs.strip_prefix("/").unwrap_or(abs))
    }

    pub fn read(&self, abs: impl AsRef<Path>) -> io::Result<String> {
        std::fs::read_to_string(self.path(abs))
    }

    /// The file's content without surrounding whitespace, or `None` if it can't be read.
    pub fn read_trim(&self, abs: impl AsRef<Path>) -> Option<String> {
        self.read(abs).ok().map(|s| s.trim().to_owned())
    }

    pub fn read_u64(&self, abs: impl AsRef<Path>) -> Option<u64> {
        self.read_trim(abs)?.parse().ok()
    }

    pub fn read_i64(&self, abs: impl AsRef<Path>) -> Option<i64> {
        self.read_trim(abs)?.parse().ok()
    }

    pub fn exists(&self, abs: impl AsRef<Path>) -> bool {
        self.path(abs).exists()
    }

    /// Entry names in a directory, sorted naturally (`hwmon2` before `hwmon10`). Empty if the
    /// directory doesn't exist.
    pub fn list(&self, abs: impl AsRef<Path>) -> Vec<String> {
        let Ok(entries) = std::fs::read_dir(self.path(abs)) else {
            return Vec::new();
        };
        let mut names: Vec<String> = entries
            .flatten()
            .filter_map(|e| e.file_name().into_string().ok())
            .filter(|n| !n.starts_with('.'))
            .collect();
        names.sort_by(|a, b| natural_cmp(a, b));
        names
    }

    pub fn open(&self, abs: impl AsRef<Path>) -> io::Result<HotFile> {
        HotFile::open(self.path(abs))
    }
}

/// Compares strings so that embedded numbers sort by value: `cpu2 < cpu10`.
pub fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let split = |s: &str| {
        let pos = s.find(|c: char| c.is_ascii_digit()).unwrap_or(s.len());
        let (head, tail) = s.split_at(pos);
        let digits: String = tail.chars().take_while(char::is_ascii_digit).collect();
        let rest = tail[digits.len()..].to_owned();
        (head.to_owned(), digits.parse::<u64>().ok(), rest)
    };
    split(a).cmp(&split(b))
}

/// A file that is opened once and re-read from offset 0 into a reused buffer, so steady-state
/// sampling doesn't open files or allocate.
#[derive(Debug)]
pub struct HotFile {
    file: File,
    buf: Vec<u8>,
}

impl HotFile {
    pub fn open(path: impl AsRef<Path>) -> io::Result<Self> {
        Ok(Self {
            file: File::open(path)?,
            buf: Vec::with_capacity(4096),
        })
    }

    /// Reads the whole file again and returns its bytes.
    pub fn read(&mut self) -> io::Result<&[u8]> {
        self.buf.clear();
        let mut offset = 0u64;
        loop {
            if self.buf.capacity() - self.buf.len() < 1024 {
                self.buf.reserve(self.buf.capacity().max(4096));
            }
            let len = self.buf.len();
            let spare = self.buf.capacity() - len;
            self.buf.resize(len + spare, 0);
            let n = self.file.read_at(&mut self.buf[len..], offset)?;
            self.buf.truncate(len + n);
            if n == 0 {
                return Ok(&self.buf);
            }
            offset += n as u64;
        }
    }
}

/// The fixture directory for a machine, for tests: `fixtures/<name>/` at the repository root.
pub fn fixture(name: &str) -> Root {
    Root::at(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures")
            .join(name),
    )
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    #[test]
    fn natural_order() {
        let mut v = vec!["hwmon10", "hwmon2", "hwmon1", "cpu", "card1-eDP-1", "card1"];
        v.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(
            v,
            ["card1", "card1-eDP-1", "cpu", "hwmon1", "hwmon2", "hwmon10"]
        );
    }

    #[test]
    fn root_maps_absolute_paths() {
        let root = Root::at("/tmp/fx");
        assert_eq!(root.path("/proc/stat"), PathBuf::from("/tmp/fx/proc/stat"));
    }

    #[test]
    fn hot_file_rereads_from_the_start() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("f");
        std::fs::write(&path, "one").unwrap();
        let mut hot = HotFile::open(&path).unwrap();
        assert_eq!(hot.read().unwrap(), b"one");
        std::fs::write(&path, "two!").unwrap();
        assert_eq!(hot.read().unwrap(), b"two!");
        let big = "x".repeat(10_000);
        std::fs::write(&path, &big).unwrap();
        assert_eq!(hot.read().unwrap().len(), 10_000);
    }

    #[test]
    fn the_reference_fixture_is_there() {
        let root = fixture("hp-i5-10300h");
        assert!(root.read("/proc/stat").unwrap().starts_with("cpu "));
        assert!(root.list("/sys/class/hwmon").contains(&"hwmon5".to_owned()));
    }
}

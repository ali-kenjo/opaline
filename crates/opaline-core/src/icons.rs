//! Resolves FreeDesktop icon names (from `.desktop` `Icon=` entries) to cached files inside
//! `$XDG_CACHE_HOME/opaline/icons/` and returns `opaline-asset://icons/<file>` URLs.
//!
//! Only safe image files (PNG, WebP, JPEG, and sanitized SVG without scripts/remote refs) up to
//! 512 KiB are cached, so the webview never touches the host filesystem directly.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::paths::{cache_dir, write_atomic};

/// Maximum icon file size we will read and copy into the asset cache.
const MAX_ICON_BYTES: u64 = 512 * 1024;

/// Preferred icon sizes (largest crisp sizes first, down to 24px).
const SIZES: &[&str] = &[
    "scalable", "64x64", "48x48", "128x128", "96x96", "32x32", "256x256", "24x24",
];

/// Icon categories checked inside each theme/size directory.
const CATEGORIES: &[&str] = &["apps", "applications", "categories", "status", "devices"];

/// Theme search order (Ubuntu/GNOME defaults + universal hicolor fallback).
const THEMES: &[&str] = &["Yaru", "Adwaita", "hicolor", "Papirus", "breeze"];

/// Allowed extensions in order of preference when looking up a bare icon name.
const EXTS: &[&str] = &["svg", "png", "webp", "jpg", "jpeg"];

/// Caches icon name → `opaline-asset://icons/<hash>.<ext>` lookups for the lifetime of a provider.
#[derive(Debug, Default)]
pub struct IconResolver {
    cache_root: Option<PathBuf>,
    search_roots: Vec<PathBuf>,
    memo: HashMap<String, Option<String>>,
}

impl IconResolver {
    /// Creates a resolver targeting the real system icon paths and XDG cache directory.
    pub fn system() -> Self {
        let mut search_roots = Vec::new();
        if let Some(home) = std::env::var_os("HOME").filter(|v| !v.is_empty()) {
            let home = PathBuf::from(home);
            search_roots.push(home.join(".local/share/icons"));
            search_roots.push(home.join(".local/share/flatpak/exports/share/icons"));
            search_roots.push(home.join(".icons"));
        }
        search_roots.push(PathBuf::from("/usr/local/share/icons"));
        search_roots.push(PathBuf::from("/usr/share/icons"));
        search_roots.push(PathBuf::from("/var/lib/flatpak/exports/share/icons"));
        search_roots.push(PathBuf::from("/var/lib/snapd/desktop/icons"));
        search_roots.push(PathBuf::from("/usr/share/pixmaps"));

        Self {
            cache_root: cache_dir().ok().map(|d| d.join("icons")),
            search_roots,
            memo: HashMap::new(),
        }
    }

    /// Creates a resolver with explicit search and cache directories (for unit tests).
    pub fn with_dirs(search_roots: Vec<PathBuf>, cache_root: PathBuf) -> Self {
        Self {
            cache_root: Some(cache_root),
            search_roots,
            memo: HashMap::new(),
        }
    }

    /// Resolves `icon` (either an absolute path or a FreeDesktop icon name) and caches it under
    /// `opaline-asset://icons/<hash>.<ext>`. Returns `None` if not found or unsafe.
    pub fn resolve(&mut self, icon: &str) -> Option<String> {
        let key = icon.trim();
        if key.is_empty() {
            return None;
        }
        if let Some(cached) = self.memo.get(key) {
            return cached.clone();
        }
        let resolved = self.resolve_uncached(key);
        self.memo.insert(key.to_owned(), resolved.clone());
        resolved
    }

    fn resolve_uncached(&self, icon: &str) -> Option<String> {
        let cache_root = self.cache_root.as_ref()?;
        let source = find_icon_file(icon, &self.search_roots)?;
        cache_icon_file(&source, cache_root)
    }
}

fn supported_ext(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "svg" => Some("svg"),
        "png" => Some("png"),
        "webp" => Some("webp"),
        "jpg" | "jpeg" => Some("jpg"),
        _ => None,
    }
}

/// Rejects SVGs containing scripts, inline event handlers, foreignObject, or remote asset refs.
/// Standard XML namespace URIs (`xmlns="http://www.w3.org/2000/svg"`) are allowed.
pub fn is_safe_svg(bytes: &[u8]) -> bool {
    let Ok(text) = std::str::from_utf8(bytes) else {
        return false;
    };
    let lower = text.to_ascii_lowercase();
    let trimmed = lower.trim_start();
    if !(trimmed.starts_with("<svg") || trimmed.starts_with("<?xml") || trimmed.starts_with("<!--"))
    {
        return false;
    }
    if !lower.contains("<svg") {
        return false;
    }
    const FORBIDDEN: &[&str] = &[
        "<script",
        "javascript:",
        "<foreignobject",
        "onload=",
        "onerror=",
        "onclick=",
        "onmouseover=",
        "href=\"http://",
        "href='http://",
        "href=\"https://",
        "href='https://",
        "url(http://",
        "url(https://",
        "url(\"http://",
        "url(\"https://",
        "url('http://",
        "url('https://",
        "src=\"http://",
        "src=\"https://",
        "file://",
    ];
    !FORBIDDEN.iter().any(|bad| lower.contains(bad))
}

fn cache_icon_file(source: &Path, cache_root: &Path) -> Option<String> {
    let ext = supported_ext(source)?;
    let meta = std::fs::metadata(source).ok()?;
    if !meta.is_file() || meta.len() == 0 || meta.len() > MAX_ICON_BYTES {
        return None;
    }
    let bytes = std::fs::read(source).ok()?;
    if ext == "svg" && !is_safe_svg(&bytes) {
        return None;
    }
    let digest = Sha256::digest(&bytes);
    let hash = hex::encode(&digest[..12]);
    let file_name = format!("{hash}.{ext}");
    let dest = cache_root.join(&file_name);
    if !dest.exists() && write_atomic(&dest, &bytes).is_err() {
        return None;
    }
    Some(format!("opaline-asset://icons/{file_name}"))
}

fn find_icon_file(icon: &str, search_roots: &[PathBuf]) -> Option<PathBuf> {
    let as_path = Path::new(icon);
    if as_path.is_absolute() {
        return (as_path.is_file() && supported_ext(as_path).is_some())
            .then(|| as_path.to_path_buf());
    }
    // Strip any extension if the `.desktop` entry wrote `firefox.png`.
    let stem = icon
        .rsplit_once('.')
        .filter(|(_, e)| EXTS.iter().any(|ok| ok.eq_ignore_ascii_case(e)))
        .map_or(icon, |(s, _)| s);
    if stem.is_empty() || stem.contains('/') || stem.contains("..") {
        return None;
    }

    // 1. Check themed directories (`<root>/<theme>/<size>/<cat>/<stem>.<ext>`).
    for root in search_roots {
        if !root.is_dir() {
            continue;
        }
        // Pixmaps / flat icon directories first when root ends with "pixmaps".
        if root.file_name().is_some_and(|n| n == "pixmaps") {
            if let Some(hit) = probe_flat(root, stem) {
                return Some(hit);
            }
            continue;
        }
        for theme in THEMES {
            let theme_dir = root.join(theme);
            if !theme_dir.is_dir() {
                continue;
            }
            for size in SIZES {
                let size_dir = theme_dir.join(size);
                if !size_dir.is_dir() {
                    continue;
                }
                for cat in CATEGORIES {
                    let cat_dir = size_dir.join(cat);
                    if let Some(hit) = probe_flat(&cat_dir, stem) {
                        return Some(hit);
                    }
                }
            }
        }
        // Also check flat files directly in `<root>` (e.g. `~/.local/share/icons/app.png`).
        if let Some(hit) = probe_flat(root, stem) {
            return Some(hit);
        }
    }
    None
}

fn probe_flat(dir: &Path, stem: &str) -> Option<PathBuf> {
    if !dir.is_dir() {
        return None;
    }
    for ext in EXTS {
        let candidate = dir.join(format!("{stem}.{ext}"));
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    #[test]
    fn resolves_themed_svg_and_caches_by_hash() {
        let dir = tempfile::tempdir().unwrap();
        let icons = dir.path().join("icons");
        let cache = dir.path().join("cache");
        let svg_dir = icons.join("hicolor/scalable/apps");
        std::fs::create_dir_all(&svg_dir).unwrap();
        let svg = b"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"10\"/></svg>";
        std::fs::write(svg_dir.join("org.example.App.svg"), svg).unwrap();

        let mut resolver = IconResolver::with_dirs(vec![icons], cache.clone());
        let url = resolver.resolve("org.example.App").unwrap();
        assert!(url.starts_with("opaline-asset://icons/"));
        assert!(url.ends_with(".svg"));
        let fname = url.strip_prefix("opaline-asset://icons/").unwrap();
        assert_eq!(std::fs::read(cache.join(fname)).unwrap(), svg);
        // Second call hits memo cache.
        assert_eq!(resolver.resolve("org.example.App"), Some(url));
    }

    #[test]
    fn rejects_unsafe_svg_and_path_traversal() {
        let dir = tempfile::tempdir().unwrap();
        let icons = dir.path().join("icons");
        let cache = dir.path().join("cache");
        let svg_dir = icons.join("hicolor/scalable/apps");
        std::fs::create_dir_all(&svg_dir).unwrap();
        std::fs::write(
            svg_dir.join("evil.svg"),
            b"<svg><script>alert(1)</script></svg>",
        )
        .unwrap();

        let mut resolver = IconResolver::with_dirs(vec![icons], cache);
        assert_eq!(resolver.resolve("evil"), None);
        assert_eq!(resolver.resolve("../etc/passwd"), None);
        assert_eq!(resolver.resolve("missing-icon"), None);
    }

    #[test]
    fn resolves_absolute_png_path() {
        let dir = tempfile::tempdir().unwrap();
        let png = dir.path().join("app.png");
        let cache = dir.path().join("cache");
        // Minimal non-empty bytes for a PNG file.
        std::fs::write(&png, b"\x89PNG\r\n\x1a\nfake-png").unwrap();

        let mut resolver = IconResolver::with_dirs(vec![], cache);
        let url = resolver.resolve(png.to_str().unwrap()).unwrap();
        assert!(url.starts_with("opaline-asset://icons/"));
        assert!(url.ends_with(".png"));
    }
}

//! Photo frame provider: scans a user photo folder, decodes and downscales thumbnails in core
//! to `~/.cache/opaline/photos/` (so full-resolution images never reach the webview), extracts
//! EXIF dates when present, and marks "On this day" memories (brief §8.4, PLAN-2 task 7.4).

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use image::imageops::FilterType;
use opaline_ipc::{Topic, TopicUpdate, Value};
use sha2::{Digest, Sha256};

use crate::hub::Hub;

pub const PHOTOS: &str = "photos.list";
const MAX_PHOTOS: usize = 60;
const THUMB_MAX_DIM: u32 = 640;

fn cache_photos_dir() -> Result<PathBuf, String> {
    let dir = crate::paths::cache_dir()
        .map_err(|e| e.to_string())?
        .join("photos");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn default_pictures_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Pictures"))
}

fn is_supported_image(path: &Path) -> bool {
    let Some(ext) = path.extension().and_then(|s| s.to_str()) else {
        return false;
    };
    matches!(
        ext.to_ascii_lowercase().as_str(),
        "jpg" | "jpeg" | "png" | "webp"
    )
}

/// Scans JPEG APP1/EXIF bytes for a `YYYY:MM:DD` date string (lightweight, zero extra crates).
pub fn extract_exif_date(bytes: &[u8]) -> Option<String> {
    let window = &bytes[..bytes.len().min(65_536)];
    for w in window.windows(10) {
        if w[4] == b':'
            && w[7] == b':'
            && w[0..4].iter().all(u8::is_ascii_digit)
            && w[5..7].iter().all(u8::is_ascii_digit)
            && w[8..10].iter().all(u8::is_ascii_digit)
            && (w[0] == b'1' || w[0] == b'2')
        {
            let year = std::str::from_utf8(&w[0..4]).ok()?;
            let month = std::str::from_utf8(&w[5..7]).ok()?;
            let day = std::str::from_utf8(&w[8..10]).ok()?;
            return Some(format!("{year}-{month}-{day}"));
        }
    }
    None
}

/// Downscales `src` into a cached PNG thumbnail inside `cache_dir` (idempotent by path+size hash).
pub fn ensure_thumbnail(src: &Path, cache_dir: &Path) -> Result<String, String> {
    let meta = std::fs::metadata(src).map_err(|e| e.to_string())?;
    let mut h = Sha256::new();
    h.update(src.to_string_lossy().as_bytes());
    h.update(meta.len().to_le_bytes());
    let key = &hex::encode(h.finalize())[..20];
    let file_name = format!("photo-{key}.png");
    let dst = cache_dir.join(&file_name);
    if dst.is_file() {
        return Ok(file_name);
    }
    let img = image::open(src).map_err(|e| format!("decode-failed: {e}"))?;
    let thumb = if img.width() > THUMB_MAX_DIM || img.height() > THUMB_MAX_DIM {
        img.resize(THUMB_MAX_DIM, THUMB_MAX_DIM, FilterType::Triangle)
    } else {
        img
    };
    thumb.save(&dst).map_err(|e| format!("thumb-save: {e}"))?;
    Ok(file_name)
}

/// Scans `folder` and returns a `photos.list` topic payload with cached thumbnail URLs.
pub fn scan_folder(folder: &Path, cache_dir: &Path, today_mm_dd: &str) -> Value {
    let Ok(entries) = std::fs::read_dir(folder) else {
        return Value::map([
            ("folder", Value::Text(folder.display().to_string())),
            ("items", Value::List(Vec::new())),
        ]);
    };
    let mut paths: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file() && is_supported_image(p))
        .take(MAX_PHOTOS)
        .collect();
    paths.sort();

    let mut items = Vec::new();
    for path in paths {
        let Ok(thumb_name) = ensure_thumbnail(&path, cache_dir) else {
            continue;
        };
        let date = std::fs::read(&path)
            .ok()
            .and_then(|b| extract_exif_date(&b))
            .unwrap_or_default();
        let on_this_day = date.len() == 10 && &date[5..10] == today_mm_dd;
        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Photo")
            .to_owned();
        items.push(Value::map([
            ("id", Value::Text(thumb_name.clone())),
            ("name", Value::Text(name)),
            (
                "thumbUrl",
                Value::Text(format!("opaline-asset://photos/{thumb_name}")),
            ),
            ("date", Value::Text(date)),
            ("onThisDay", Value::Bool(on_this_day)),
        ]));
    }
    Value::map([
        ("folder", Value::Text(folder.display().to_string())),
        ("items", Value::List(items)),
    ])
}

pub async fn run(hub: Arc<Hub>) -> Result<(), String> {
    let cache_dir = cache_photos_dir()?;
    let mut tick = tokio::time::interval(Duration::from_secs(30));
    loop {
        tick.tick().await;
        if hub.paused() || !hub.is_subscribed(PHOTOS) {
            continue;
        }
        let Some(folder) = default_pictures_dir() else {
            continue;
        };
        let cd = cache_dir.clone();
        let today = chrono::Local::now().format("%m-%d").to_string();
        let val = tokio::task::spawn_blocking(move || scan_folder(&folder, &cd, &today))
            .await
            .map_err(|e| e.to_string())?;
        hub.publish(vec![TopicUpdate {
            topic: Topic::new(PHOTOS),
            value: val,
        }]);
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    #[test]
    fn downscales_photo_into_cache_and_extracts_exif_date() {
        let src_dir = tempfile::tempdir().unwrap();
        let cache_dir = tempfile::tempdir().unwrap();
        let img = image::RgbImage::from_pixel(1000, 800, image::Rgb([40, 120, 200]));
        let photo_path = src_dir.path().join("sunset.png");
        img.save(&photo_path).unwrap();

        let thumb = ensure_thumbnail(&photo_path, cache_dir.path()).unwrap();
        let out_img = image::open(cache_dir.path().join(&thumb)).unwrap();
        assert!(out_img.width() <= THUMB_MAX_DIM);
        assert!(out_img.height() <= THUMB_MAX_DIM);

        assert_eq!(
            extract_exif_date(b"Exif\0\0...2024:11:27 14:22:01..."),
            Some("2024-11-27".into())
        );
    }
}

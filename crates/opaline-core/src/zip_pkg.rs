//! Safe, bounded ZIP archive reader and writer for `.opaline-theme` and `.opaline-rice` packages
//! (brief §5.2, §12). Pure safe Rust built on `flate2` and `crc32fast`, enforcing:
//! - zip-slip rejection (no absolute paths, no `..`, no backslashes, no NUL bytes),
//! - archive size, entry count, per-entry size, total uncompressed size, and zip-bomb ratio limits,
//! - CRC-32 verification on every entry.

use std::collections::BTreeMap;
use std::io::{Read, Write};

use flate2::Compression;
use flate2::read::DeflateDecoder;
use flate2::write::DeflateEncoder;

/// Maximum compressed `.opaline-theme` / `.opaline-rice` file size (16 MiB).
pub const MAX_ARCHIVE_BYTES: usize = 16 * 1024 * 1024;
/// Maximum total uncompressed payload across all entries (32 MiB).
pub const MAX_TOTAL_UNCOMPRESSED: usize = 32 * 1024 * 1024;
/// Maximum uncompressed size of a single entry (8 MiB).
pub const MAX_ENTRY_BYTES: usize = 8 * 1024 * 1024;
/// Maximum number of entries in one archive.
pub const MAX_ENTRIES: usize = 256;
/// Maximum expansion ratio for compressed entries (guards against zip bombs).
const MAX_RATIO: usize = 100;

const SIG_LOCAL: u32 = 0x0403_4b50;
const SIG_CENTRAL: u32 = 0x0201_4b50;
const SIG_EOCD: u32 = 0x0605_4b50;
const METHOD_STORED: u16 = 0;
const METHOD_DEFLATE: u16 = 8;

/// Checks that a relative archive entry path cannot escape its extraction root (zip-slip).
pub fn is_safe_entry_path(path: &str) -> bool {
    if path.is_empty()
        || path.len() > 256
        || path.starts_with('/')
        || path.contains('\\')
        || path.contains('\0')
    {
        return false;
    }
    for seg in path.split('/') {
        if seg.is_empty() || seg == "." || seg == ".." || seg.chars().any(char::is_control) {
            return false;
        }
    }
    true
}

fn u16_le(bytes: &[u8], off: usize) -> Option<u16> {
    let slice: [u8; 2] = bytes.get(off..off + 2)?.try_into().ok()?;
    Some(u16::from_le_bytes(slice))
}

fn u32_le(bytes: &[u8], off: usize) -> Option<u32> {
    let slice: [u8; 4] = bytes.get(off..off + 4)?.try_into().ok()?;
    Some(u32::from_le_bytes(slice))
}

/// Reads a ZIP archive into an in-memory map of safe relative paths → file bytes.
pub fn read_zip(data: &[u8]) -> Result<BTreeMap<String, Vec<u8>>, String> {
    if data.len() > MAX_ARCHIVE_BYTES {
        return Err(format!(
            "archive exceeds {MAX_ARCHIVE_BYTES} byte limit ({} bytes)",
            data.len()
        ));
    }
    if data.len() < 22 {
        return Err("archive-too-short".into());
    }

    // Locate End of Central Directory (EOCD) scanning backward up to 65557 bytes.
    let min_eocd = data.len().saturating_sub(22 + 65_535);
    let mut eocd_off = None;
    let mut pos = data.len() - 22;
    loop {
        if u32_le(data, pos) == Some(SIG_EOCD) {
            let comment_len = usize::from(u16_le(data, pos + 20).unwrap_or(0));
            if pos + 22 + comment_len == data.len() {
                eocd_off = Some(pos);
                break;
            }
        }
        if pos == min_eocd {
            break;
        }
        pos -= 1;
    }
    let eocd = eocd_off.ok_or_else(|| "invalid-zip-eocd".to_owned())?;
    let entry_count = usize::from(u16_le(data, eocd + 10).ok_or("truncated-eocd")?);
    if entry_count > MAX_ENTRIES {
        return Err(format!("too-many-entries ({entry_count} > {MAX_ENTRIES})"));
    }
    let cd_size = u32_le(data, eocd + 12).ok_or("truncated-eocd")? as usize;
    let cd_offset = u32_le(data, eocd + 16).ok_or("truncated-eocd")? as usize;
    let cd_end = cd_offset
        .checked_add(cd_size)
        .filter(|&end| end <= eocd)
        .ok_or("invalid-central-directory")?;

    let mut out = BTreeMap::new();
    let mut cursor = cd_offset;
    let mut total_uncompressed = 0usize;

    for _ in 0..entry_count {
        if cursor + 46 > cd_end || u32_le(data, cursor) != Some(SIG_CENTRAL) {
            return Err("invalid-central-directory-header".into());
        }
        let method = u16_le(data, cursor + 10).ok_or("truncated-cd")?;
        let expected_crc = u32_le(data, cursor + 16).ok_or("truncated-cd")?;
        let comp_size = u32_le(data, cursor + 20).ok_or("truncated-cd")? as usize;
        let uncomp_size = u32_le(data, cursor + 24).ok_or("truncated-cd")? as usize;
        let name_len = usize::from(u16_le(data, cursor + 28).ok_or("truncated-cd")?);
        let extra_len = usize::from(u16_le(data, cursor + 30).ok_or("truncated-cd")?);
        let comment_len = usize::from(u16_le(data, cursor + 32).ok_or("truncated-cd")?);
        let local_off = u32_le(data, cursor + 42).ok_or("truncated-cd")? as usize;

        let name_start = cursor + 46;
        let name_end = name_start + name_len;
        let name_bytes = data.get(name_start..name_end).ok_or("truncated-cd-name")?;
        let name = std::str::from_utf8(name_bytes).map_err(|_| "non-utf8-entry-name")?;
        cursor = name_end + extra_len + comment_len;

        // Skip directory entries (trailing slash), validating the prefix for zip-slip too.
        if let Some(dir) = name.strip_suffix('/') {
            if !dir.is_empty() && !is_safe_entry_path(dir) {
                return Err(format!("unsafe-zip-path: {name}"));
            }
            continue;
        }
        if !is_safe_entry_path(name) {
            return Err(format!("unsafe-zip-path: {name}"));
        }
        if uncomp_size > MAX_ENTRY_BYTES {
            return Err(format!("entry-too-large: {name}"));
        }
        if comp_size > 0 && uncomp_size > comp_size.saturating_mul(MAX_RATIO).max(64 * 1024) {
            return Err(format!("suspicious-compression-ratio: {name}"));
        }
        total_uncompressed = total_uncompressed.saturating_add(uncomp_size);
        if total_uncompressed > MAX_TOTAL_UNCOMPRESSED {
            return Err("archive-uncompressed-limit-exceeded".into());
        }

        // Read local file header.
        if local_off + 30 > data.len() || u32_le(data, local_off) != Some(SIG_LOCAL) {
            return Err(format!("invalid-local-header: {name}"));
        }
        let local_name_len = usize::from(u16_le(data, local_off + 26).ok_or("truncated-local")?);
        let local_extra_len = usize::from(u16_le(data, local_off + 28).ok_or("truncated-local")?);
        let data_start = local_off + 30 + local_name_len + local_extra_len;
        let data_end = data_start
            .checked_add(comp_size)
            .filter(|&e| e <= data.len())
            .ok_or_else(|| format!("truncated-entry-data: {name}"))?;
        let payload = &data[data_start..data_end];

        let decoded = match method {
            METHOD_STORED => {
                if payload.len() != uncomp_size {
                    return Err(format!("size-mismatch: {name}"));
                }
                payload.to_vec()
            }
            METHOD_DEFLATE => {
                let cap = MAX_ENTRY_BYTES.min(MAX_TOTAL_UNCOMPRESSED);
                let mut decoder = DeflateDecoder::new(payload).take((cap + 1) as u64);
                let mut buf = Vec::with_capacity(uncomp_size.min(64 * 1024));
                decoder
                    .read_to_end(&mut buf)
                    .map_err(|e| format!("deflate-error ({name}): {e}"))?;
                if buf.len() > MAX_ENTRY_BYTES || buf.len() != uncomp_size {
                    return Err(format!("decoded-size-mismatch: {name}"));
                }
                buf
            }
            other => return Err(format!("unsupported-zip-method {other}: {name}")),
        };

        let crc = crc32fast::hash(&decoded);
        if crc != expected_crc {
            return Err(format!("crc-mismatch: {name}"));
        }
        if out.insert(name.to_owned(), decoded).is_some() {
            return Err(format!("duplicate-entry: {name}"));
        }
    }

    Ok(out)
}

/// Writes a map of safe relative paths → file bytes into a standard deflate-compressed ZIP archive.
pub fn write_zip(files: &BTreeMap<String, Vec<u8>>) -> Result<Vec<u8>, String> {
    if files.len() > MAX_ENTRIES {
        return Err("too-many-entries".into());
    }
    let mut out = Vec::new();
    let mut central = Vec::new();
    let mut total_uncomp = 0usize;

    for (name, bytes) in files {
        if !is_safe_entry_path(name) {
            return Err(format!("unsafe-zip-path: {name}"));
        }
        if bytes.len() > MAX_ENTRY_BYTES {
            return Err(format!("entry-too-large: {name}"));
        }
        total_uncomp = total_uncomp.saturating_add(bytes.len());
        if total_uncomp > MAX_TOTAL_UNCOMPRESSED {
            return Err("archive-uncompressed-limit-exceeded".into());
        }

        let crc = crc32fast::hash(bytes);
        let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
        encoder
            .write_all(bytes)
            .map_err(|e| format!("deflate-write: {e}"))?;
        let compressed = encoder
            .finish()
            .map_err(|e| format!("deflate-finish: {e}"))?;

        let (method, payload): (u16, &[u8]) = if compressed.len() < bytes.len() {
            (METHOD_DEFLATE, &compressed)
        } else {
            (METHOD_STORED, bytes)
        };

        let local_offset = u32::try_from(out.len()).map_err(|_| "archive-too-large")?;
        let name_bytes = name.as_bytes();
        let name_len = u16::try_from(name_bytes.len()).map_err(|_| "name-too-long")?;
        let comp_len = u32::try_from(payload.len()).map_err(|_| "entry-too-large")?;
        let uncomp_len = u32::try_from(bytes.len()).map_err(|_| "entry-too-large")?;

        // Local file header
        out.extend_from_slice(&SIG_LOCAL.to_le_bytes());
        out.extend_from_slice(&20u16.to_le_bytes()); // version needed
        out.extend_from_slice(&0x0800u16.to_le_bytes()); // UTF-8 flag
        out.extend_from_slice(&method.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes()); // mod time
        out.extend_from_slice(&0u16.to_le_bytes()); // mod date
        out.extend_from_slice(&crc.to_le_bytes());
        out.extend_from_slice(&comp_len.to_le_bytes());
        out.extend_from_slice(&uncomp_len.to_le_bytes());
        out.extend_from_slice(&name_len.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes()); // extra len
        out.extend_from_slice(name_bytes);
        out.extend_from_slice(payload);

        // Central directory header
        central.extend_from_slice(&SIG_CENTRAL.to_le_bytes());
        central.extend_from_slice(&20u16.to_le_bytes()); // version made by
        central.extend_from_slice(&20u16.to_le_bytes()); // version needed
        central.extend_from_slice(&0x0800u16.to_le_bytes()); // UTF-8 flag
        central.extend_from_slice(&method.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&crc.to_le_bytes());
        central.extend_from_slice(&comp_len.to_le_bytes());
        central.extend_from_slice(&uncomp_len.to_le_bytes());
        central.extend_from_slice(&name_len.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes()); // extra len
        central.extend_from_slice(&0u16.to_le_bytes()); // comment len
        central.extend_from_slice(&0u16.to_le_bytes()); // disk start
        central.extend_from_slice(&0u16.to_le_bytes()); // internal attrs
        central.extend_from_slice(&0u32.to_le_bytes()); // external attrs
        central.extend_from_slice(&local_offset.to_le_bytes());
        central.extend_from_slice(name_bytes);
    }

    let cd_offset = u32::try_from(out.len()).map_err(|_| "archive-too-large")?;
    let cd_size = u32::try_from(central.len()).map_err(|_| "archive-too-large")?;
    let count = u16::try_from(files.len()).map_err(|_| "too-many-entries")?;
    out.extend_from_slice(&central);

    // End of central directory
    out.extend_from_slice(&SIG_EOCD.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(&cd_size.to_le_bytes());
    out.extend_from_slice(&cd_offset.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());

    if out.len() > MAX_ARCHIVE_BYTES {
        return Err("archive-too-large".into());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    #[test]
    fn round_trips_valid_archive() {
        let mut files = BTreeMap::new();
        files.insert(
            "theme.json".to_owned(),
            br#"{"id":"demo","name":"Demo"}"#.to_vec(),
        );
        files.insert(
            "assets/bg.txt".to_owned(),
            b"repeated repeated repeated repeated text".to_vec(),
        );
        let bytes = write_zip(&files).unwrap();
        let read = read_zip(&bytes).unwrap();
        assert_eq!(read, files);
    }

    #[test]
    fn rejects_zip_slip_paths() {
        for bad in [
            "../evil.txt",
            "a/../../etc/passwd",
            "/etc/passwd",
            "a\\b.txt",
            "",
            ".",
            "a//b",
        ] {
            assert!(!is_safe_entry_path(bad), "expected unsafe: {bad}");
        }
        assert!(is_safe_entry_path("theme.json"));
        assert!(is_safe_entry_path("fonts/JetBrainsMono.woff2"));

        // Craft a zip and mutate the entry name in-place to "../pwn" to test reader rejection.
        let mut files = BTreeMap::new();
        files.insert("aaaaaa".to_owned(), b"hi".to_vec());
        let mut zip = write_zip(&files).unwrap();
        let needle = b"aaaaaa";
        for i in 0..=zip.len() - needle.len() {
            if &zip[i..i + needle.len()] == needle {
                zip[i..i + needle.len()].copy_from_slice(b"../pwn");
            }
        }
        let err = read_zip(&zip).unwrap_err();
        assert!(err.contains("unsafe-zip-path"), "unexpected err: {err}");
    }

    #[test]
    fn rejects_corrupt_crc() {
        let mut files = BTreeMap::new();
        files.insert("a.txt".to_owned(), b"hello".to_vec());
        let mut zip = write_zip(&files).unwrap();
        // Flip a byte inside the stored payload ("hello" sits right after the local header + name).
        let idx = zip.windows(5).position(|w| w == b"hello").unwrap();
        zip[idx] ^= 0xff;
        let err = read_zip(&zip).unwrap_err();
        assert!(err.contains("crc-mismatch"), "unexpected err: {err}");
    }
}

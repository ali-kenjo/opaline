//! Daily GitHub Releases update check, SHA-256 + minisign verification, and `pkexec apt install`
//! (brief §9, PLAN 6.5).
//!
//! Network requests happen only when `settings.privacy.update_checks` is enabled or when the user
//! explicitly clicks "Check for updates". All URLs are strictly HTTPS.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine as _;
use ring::signature::{ED25519, UnparsedPublicKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::hub::Hub;

const RELEASES_LATEST_URL: &str = "https://api.github.com/repos/ali-kenjo/opaline/releases/latest";
const MAX_DEB_BYTES: usize = 128 << 20; // 128 MiB cap
const MAX_META_BYTES: usize = 256 << 10; // 256 KiB cap
const CHECK_INTERVAL: Duration = Duration::from_secs(24 * 3600);

/// Official release signing key (minisign key id `5E9B385AC358AAD3`, minted 2026-11-27). The
/// release workflow signs `SHA256SUMS` with its secret half (`MINISIGN_SECRET_KEY`).
pub const RELEASE_MINISIGN_PUBKEY: &str =
    "RWTTqljDWjibXkrILQHoOvW88UigFMKaq0LkYU7BLGNkwAEqSsleUu9E";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub release_url: String,
    pub notes: String,
    pub deb_url: Option<String>,
    pub deb_name: Option<String>,
    pub checksums_url: Option<String>,
    pub signature_url: Option<String>,
    pub checked_at: String,
}

#[derive(Debug, Deserialize)]
struct GhRelease {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    assets: Vec<GhAsset>,
}

#[derive(Debug, Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
}

/// Parses a `v1.2.3` or `1.2.3` version string into `(major, minor, patch)`.
pub fn parse_semver(version: &str) -> Option<(u64, u64, u64)> {
    let clean = version
        .trim()
        .trim_start_matches('v')
        .split(['-', '+'])
        .next()?;
    let mut parts = clean.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next().unwrap_or("0").parse().ok()?;
    Some((major, minor, patch))
}

/// Returns true when `latest` is strictly newer than `current`.
pub fn is_newer(current: &str, latest: &str) -> bool {
    match (parse_semver(current), parse_semver(latest)) {
        (Some(c), Some(l)) => l > c,
        _ => false,
    }
}

/// Queries GitHub Releases for the latest release and compares it against the running version.
pub async fn check_latest() -> Result<UpdateInfo, String> {
    let json = crate::http::get_json(RELEASES_LATEST_URL).await?;
    let release: GhRelease =
        serde_json::from_value(json).map_err(|e| format!("unexpected-release-json: {e}"))?;
    let current = env!("CARGO_PKG_VERSION").to_owned();
    let latest = release.tag_name.trim_start_matches('v').to_owned();

    let deb = release
        .assets
        .iter()
        .find(|a| a.name.ends_with("_amd64.deb") || a.name.ends_with(".deb"));
    let checksums = release
        .assets
        .iter()
        .find(|a| a.name.eq_ignore_ascii_case("SHA256SUMS") || a.name.ends_with(".sha256"));
    let signature = release.assets.iter().find(|a| a.name.ends_with(".minisig"));

    Ok(UpdateInfo {
        update_available: is_newer(&current, &latest),
        current_version: current,
        latest_version: latest,
        release_url: release.html_url,
        notes: release.body.unwrap_or_default(),
        deb_url: deb.map(|a| a.browser_download_url.clone()),
        deb_name: deb.map(|a| a.name.clone()),
        checksums_url: checksums.map(|a| a.browser_download_url.clone()),
        signature_url: signature.map(|a| a.browser_download_url.clone()),
        checked_at: chrono::Utc::now().to_rfc3339(),
    })
}

/// Parses a standard `SHA256SUMS` file (`<hex>  <filename>`) and verifies `bytes` for `filename`.
pub fn verify_sha256(checksums_text: &str, filename: &str, bytes: &[u8]) -> Result<(), String> {
    let expected = checksums_text
        .lines()
        .find_map(|line| {
            let mut parts = line.split_whitespace();
            let hash = parts.next()?;
            let name = parts.next()?.trim_start_matches('*');
            let base = name.rsplit('/').next().unwrap_or(name);
            (base == filename).then(|| hash.to_ascii_lowercase())
        })
        .ok_or_else(|| format!("checksum-missing-for-{filename}"))?;

    let actual = hex::encode(Sha256::digest(bytes));
    if actual != expected {
        return Err("checksum-mismatch".into());
    }
    Ok(())
}

/// Decodes a base64 minisign public key (2-byte algorithm `Ed` + 8-byte key id + 32-byte Ed25519
/// key; the base64 text starts with `RW` because that is how `Ed` encodes).
fn decode_minisign_pubkey(pubkey_b64: &str) -> Result<([u8; 8], [u8; 32]), String> {
    let line = pubkey_b64
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty() && !l.starts_with("untrusted comment:"))
        .ok_or_else(|| "empty-minisign-pubkey".to_owned())?;
    let raw = base64::engine::general_purpose::STANDARD
        .decode(line)
        .map_err(|e| format!("invalid-pubkey-base64: {e}"))?;
    if raw.len() != 42 || &raw[0..2] != b"Ed" {
        return Err("invalid-minisign-pubkey-format".into());
    }
    let mut key_id = [0u8; 8];
    key_id.copy_from_slice(&raw[2..10]);
    let mut pk = [0u8; 32];
    pk.copy_from_slice(&raw[10..42]);
    Ok((key_id, pk))
}

/// Verifies a minisign `.minisig` signature over `message` against `pubkey_b64`.
/// Supports both pure Ed25519 (`Ed`) and BLAKE2b-512 prehashed (`ED`) minisign signatures, and
/// also checks the trusted comment signature line when present.
pub fn verify_minisign(pubkey_b64: &str, minisig_text: &str, message: &[u8]) -> Result<(), String> {
    if pubkey_b64.trim().is_empty() {
        return Err("release-signing-key-not-configured".into());
    }
    let (expected_key_id, pk) = decode_minisign_pubkey(pubkey_b64)?;
    let lines: Vec<&str> = minisig_text.lines().map(str::trim).collect();
    if lines.len() < 4 || !lines[0].starts_with("untrusted comment:") {
        return Err("invalid-minisig-format".into());
    }
    let sig_raw = base64::engine::general_purpose::STANDARD
        .decode(lines[1])
        .map_err(|e| format!("invalid-sig-base64: {e}"))?;
    if sig_raw.len() != 74 {
        return Err("invalid-minisig-length".into());
    }
    let alg = &sig_raw[0..2];
    let sig_key_id = &sig_raw[2..10];
    let sig_bytes = &sig_raw[10..74];
    if sig_key_id != expected_key_id {
        return Err("minisign-key-id-mismatch".into());
    }

    let verifier = UnparsedPublicKey::new(&ED25519, &pk);
    match alg {
        b"Ed" => verifier
            .verify(message, sig_bytes)
            .map_err(|_| "minisign-signature-invalid".to_owned())?,
        b"ED" => {
            let digest = blake2b_512(message);
            verifier
                .verify(&digest, sig_bytes)
                .map_err(|_| "minisign-signature-invalid".to_owned())?;
        }
        _ => return Err("unsupported-minisign-algorithm".into()),
    }

    // Verify trusted comment global signature (`sig_bytes || trusted_comment_bytes`).
    let trusted_comment = lines[2]
        .strip_prefix("trusted comment: ")
        .ok_or_else(|| "missing-trusted-comment".to_owned())?;
    let global_sig = base64::engine::general_purpose::STANDARD
        .decode(lines[3])
        .map_err(|e| format!("invalid-global-sig-base64: {e}"))?;
    if global_sig.len() != 64 {
        return Err("invalid-global-sig-length".into());
    }
    let mut global_msg = Vec::with_capacity(64 + trusted_comment.len());
    global_msg.extend_from_slice(sig_bytes);
    global_msg.extend_from_slice(trusted_comment.as_bytes());
    verifier
        .verify(&global_msg, &global_sig)
        .map_err(|_| "minisign-trusted-comment-invalid".to_owned())?;

    Ok(())
}

/// Minimal RFC 7693 unkeyed BLAKE2b-512 hash (needed for minisign `ED` prehashed signatures).
fn blake2b_512(data: &[u8]) -> [u8; 64] {
    const IV: [u64; 8] = [
        0x6a09e667f3bcc908,
        0xbb67ae8584caa73b,
        0x3c6ef372fe94f82b,
        0xa54ff53a5f1d36f1,
        0x510e527fade682d1,
        0x9b05688c2b3e6c1f,
        0x1f83d9abfb41bd6b,
        0x5be0cd19137e2179,
    ];
    const SIGMA: [[usize; 16]; 12] = [
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
        [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
        [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
        [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
        [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
        [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
        [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
        [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
        [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
    ];

    fn g(v: &mut [u64; 16], a: usize, b: usize, c: usize, d: usize, x: u64, y: u64) {
        v[a] = v[a].wrapping_add(v[b]).wrapping_add(x);
        v[d] = (v[d] ^ v[a]).rotate_right(32);
        v[c] = v[c].wrapping_add(v[d]);
        v[b] = (v[b] ^ v[c]).rotate_right(24);
        v[a] = v[a].wrapping_add(v[b]).wrapping_add(y);
        v[d] = (v[d] ^ v[a]).rotate_right(16);
        v[c] = v[c].wrapping_add(v[d]);
        v[b] = (v[b] ^ v[c]).rotate_right(63);
    }

    fn compress(h: &mut [u64; 8], block: &[u8; 128], t: u128, last: bool) {
        let mut m = [0u64; 16];
        for (i, chunk) in block.as_chunks::<8>().0.iter().enumerate() {
            m[i] = u64::from_le_bytes(*chunk);
        }
        let mut v = [0u64; 16];
        v[..8].copy_from_slice(h);
        v[8..].copy_from_slice(&IV);
        v[12] ^= t as u64;
        v[13] ^= (t >> 64) as u64;
        if last {
            v[14] = !v[14];
        }
        for s in SIGMA {
            g(&mut v, 0, 4, 8, 12, m[s[0]], m[s[1]]);
            g(&mut v, 1, 5, 9, 13, m[s[2]], m[s[3]]);
            g(&mut v, 2, 6, 10, 14, m[s[4]], m[s[5]]);
            g(&mut v, 3, 7, 11, 15, m[s[6]], m[s[7]]);
            g(&mut v, 0, 5, 10, 15, m[s[8]], m[s[9]]);
            g(&mut v, 1, 6, 11, 12, m[s[10]], m[s[11]]);
            g(&mut v, 2, 7, 8, 13, m[s[12]], m[s[13]]);
            g(&mut v, 3, 4, 9, 14, m[s[14]], m[s[15]]);
        }
        for i in 0..8 {
            h[i] ^= v[i] ^ v[i + 8];
        }
    }

    let mut h = IV;
    h[0] ^= 0x0101_0040; // digest length = 64, fanout = 1, depth = 1
    let mut offset = 0usize;
    let mut t = 0u128;
    while data.len().saturating_sub(offset) > 128 {
        let mut block = [0u8; 128];
        block.copy_from_slice(&data[offset..offset + 128]);
        offset += 128;
        t += 128;
        compress(&mut h, &block, t, false);
    }
    let rem = &data[offset..];
    let mut block = [0u8; 128];
    block[..rem.len()].copy_from_slice(rem);
    t += rem.len() as u128;
    compress(&mut h, &block, t, true);

    let mut out = [0u8; 64];
    for (i, word) in h.iter().enumerate() {
        out[i * 8..i * 8 + 8].copy_from_slice(&word.to_le_bytes());
    }
    out
}

/// The assets an installable release must have. Checked before anything is downloaded.
#[derive(Debug, PartialEq, Eq)]
struct ReleaseAssets<'a> {
    deb_url: &'a str,
    deb_name: &'a str,
    checksums_url: &'a str,
    sig_url: &'a str,
}

/// Refuses a release that can't be verified: no signing key built in, no `.minisig` asset, no
/// `SHA256SUMS`, or an odd `.deb` name.
fn installable_assets<'a>(info: &'a UpdateInfo, pubkey: &str) -> Result<ReleaseAssets<'a>, String> {
    if pubkey.is_empty() {
        return Err("release-signing-key-not-configured".into());
    }
    let deb_url = info
        .deb_url
        .as_deref()
        .ok_or_else(|| "no-deb-asset".to_owned())?;
    let deb_name = info
        .deb_name
        .as_deref()
        .ok_or_else(|| "no-deb-name".to_owned())?;
    if deb_name.contains('/') || deb_name.contains("..") || !deb_name.ends_with(".deb") {
        return Err("invalid-deb-filename".into());
    }
    let checksums_url = info
        .checksums_url
        .as_deref()
        .ok_or_else(|| "missing-checksums-asset".to_owned())?;
    let sig_url = info
        .signature_url
        .as_deref()
        .ok_or_else(|| "missing-signature-asset".to_owned())?;
    Ok(ReleaseAssets {
        deb_url,
        deb_name,
        checksums_url,
        sig_url,
    })
}

/// Downloads, verifies (SHA-256 + minisign), and installs an update `.deb` via `pkexec apt install`.
pub async fn download_and_install(info: &UpdateInfo) -> Result<PathBuf, String> {
    let ReleaseAssets {
        deb_url,
        deb_name,
        checksums_url,
        sig_url,
    } = installable_assets(info, RELEASE_MINISIGN_PUBKEY)?;

    let (checksums_bytes, _) = crate::http::fetch_limited(
        checksums_url,
        MAX_META_BYTES,
        &["text/", "application/octet-stream"],
    )
    .await?;
    let (sig_bytes, _) = crate::http::fetch_limited(
        sig_url,
        MAX_META_BYTES,
        &["text/", "application/octet-stream"],
    )
    .await?;
    let checksums_text =
        String::from_utf8(checksums_bytes.clone()).map_err(|_| "checksums-not-utf8".to_owned())?;
    let sig_text = String::from_utf8(sig_bytes).map_err(|_| "signature-not-utf8".to_owned())?;

    // Verify signature on SHA256SUMS before downloading the larger .deb package.
    verify_minisign(RELEASE_MINISIGN_PUBKEY, &sig_text, &checksums_bytes)?;

    let (deb_bytes, _) = crate::http::fetch_limited(
        deb_url,
        MAX_DEB_BYTES,
        &[
            "application/octet-stream",
            "application/vnd.debian.binary-package",
            "application/x-debian-package",
        ],
    )
    .await?;
    verify_sha256(&checksums_text, deb_name, &deb_bytes)?;

    let cache = crate::paths::cache_dir().map_err(|e| e.to_string())?;
    let dest = cache.join("updates").join(deb_name);
    crate::paths::write_atomic(&dest, &deb_bytes).map_err(|e| e.to_string())?;

    let status = tokio::process::Command::new("pkexec")
        .args(["apt", "install", "-y"])
        .arg(&dest)
        .status()
        .await
        .map_err(|e| format!("pkexec-failed: {e}"))?;
    if !status.success() {
        return Err(format!("apt-install-failed: {status}"));
    }
    Ok(dest)
}

/// Background daily update checker: checks once shortly after startup and every 24 h while
/// `settings.privacy.update_checks` is enabled.
pub async fn run_daily_check(hub: Arc<Hub>) {
    // Give startup a quiet window before making any background request.
    tokio::time::sleep(Duration::from_secs(60)).await;
    loop {
        if hub.settings().privacy.update_checks {
            match check_latest().await {
                Ok(info) => {
                    tracing::info!(
                        current = %info.current_version,
                        latest = %info.latest_version,
                        available = info.update_available,
                        "update check completed"
                    );
                    hub.set_latest_update(Some(info));
                }
                Err(error) => tracing::debug!(%error, "daily update check skipped or failed"),
            }
        }
        tokio::time::sleep(CHECK_INTERVAL).await;
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use ring::signature::{Ed25519KeyPair, KeyPair};

    use super::*;

    fn release(sig: Option<&str>) -> UpdateInfo {
        UpdateInfo {
            current_version: "1.1.0".into(),
            latest_version: "1.2.0".into(),
            update_available: true,
            release_url: "https://github.com/ali-kenjo/opaline/releases/tag/v1.2.0".into(),
            notes: String::new(),
            deb_url: Some("https://example.invalid/Opaline_1.2.0_amd64.deb".into()),
            deb_name: Some("Opaline_1.2.0_amd64.deb".into()),
            checksums_url: Some("https://example.invalid/SHA256SUMS".into()),
            signature_url: sig.map(str::to_owned),
            checked_at: String::new(),
        }
    }

    #[test]
    fn a_release_without_a_signature_is_refused() {
        let info = release(None);
        assert_eq!(
            installable_assets(&info, "RWSkey"),
            Err("missing-signature-asset".into())
        );
    }

    #[test]
    fn nothing_installs_without_a_built_in_signing_key() {
        let info = release(Some("https://example.invalid/SHA256SUMS.minisig"));
        assert_eq!(
            installable_assets(&info, ""),
            Err("release-signing-key-not-configured".into())
        );
        assert!(installable_assets(&info, "RWSkey").is_ok());
    }

    #[test]
    fn odd_deb_names_are_refused() {
        let mut info = release(Some("https://example.invalid/SHA256SUMS.minisig"));
        info.deb_name = Some("../evil.deb".into());
        assert_eq!(
            installable_assets(&info, "RWSkey"),
            Err("invalid-deb-filename".into())
        );
    }

    #[test]
    fn semver_comparisons() {
        assert!(is_newer("0.1.0", "1.0.0"));
        assert!(is_newer("1.0.0", "v1.0.1"));
        assert!(is_newer("1.2.3", "1.10.0"));
        assert!(!is_newer("1.0.0", "1.0.0"));
        assert!(!is_newer("1.2.0", "1.1.9"));
    }

    #[test]
    fn sha256_verification_accepts_match_and_rejects_tamper() {
        let data = b"hello opaline deb";
        let digest = hex::encode(Sha256::digest(data));
        let sums = format!("{digest}  opaline_1.0.0_amd64.deb\n");
        assert!(verify_sha256(&sums, "opaline_1.0.0_amd64.deb", data).is_ok());
        assert!(verify_sha256(&sums, "opaline_1.0.0_amd64.deb", b"tampered").is_err());
        assert!(verify_sha256(&sums, "other.deb", data).is_err());
    }

    #[test]
    fn blake2b_512_matches_rfc7693_vector() {
        let hash = blake2b_512(b"abc");
        let hex_hash = hex::encode(hash);
        assert_eq!(
            hex_hash,
            "ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d1\
             7d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923"
        );
    }

    #[test]
    fn minisign_verifies_ed_and_prehashed_ed_and_rejects_tamper() {
        let rng = ring::rand::SystemRandom::new();
        let pkcs8 = Ed25519KeyPair::generate_pkcs8(&rng).unwrap();
        let kp = Ed25519KeyPair::from_pkcs8(pkcs8.as_ref()).unwrap();
        let key_id = [1u8, 2, 3, 4, 5, 6, 7, 8];

        let mut pub_raw = Vec::with_capacity(42);
        pub_raw.extend_from_slice(b"Ed");
        pub_raw.extend_from_slice(&key_id);
        pub_raw.extend_from_slice(kp.public_key().as_ref());
        let pub_b64 = base64::engine::general_purpose::STANDARD.encode(&pub_raw);

        let msg = b"deadbeef  opaline_1.0.0_amd64.deb\n";
        let digest = blake2b_512(msg);
        let sig = kp.sign(&digest);

        let mut sig_raw = Vec::with_capacity(74);
        sig_raw.extend_from_slice(b"ED");
        sig_raw.extend_from_slice(&key_id);
        sig_raw.extend_from_slice(sig.as_ref());
        let sig_b64 = base64::engine::general_purpose::STANDARD.encode(&sig_raw);

        let trusted = "timestamp:1700000000\tfile:SHA256SUMS";
        let mut global_msg = Vec::new();
        global_msg.extend_from_slice(sig.as_ref());
        global_msg.extend_from_slice(trusted.as_bytes());
        let global_sig = kp.sign(&global_msg);
        let global_b64 = base64::engine::general_purpose::STANDARD.encode(global_sig.as_ref());

        let minisig = format!(
            "untrusted comment: signature from opaline test\n{sig_b64}\ntrusted comment: {trusted}\n{global_b64}\n"
        );
        assert!(verify_minisign(&pub_b64, &minisig, msg).is_ok());
        assert!(verify_minisign(&pub_b64, &minisig, b"tampered").is_err());
        assert!(verify_minisign("", &minisig, msg).is_err());
    }

    /// A signature made by the real `minisign` 0.12 CLI (throwaway key, password piped on stdin
    /// exactly as `.github/workflows/release.yml` does), so the verifier is checked against the
    /// tool's actual output and not only against signatures built by this test module.
    #[test]
    fn minisign_cli_signature_verifies() {
        let pubkey = "untrusted comment: minisign public key 0820600882522549\n\
                      RWRJJVKCCGAgCOMo+8p1bu/E/E9VaUUSNHXkGwc4TqU+gmsMqiUmJ+Fw\n";
        let minisig = "untrusted comment: signature from minisign secret key\n\
             RURJJVKCCGAgCFw9puC+zKuDPE771uKjZvrbRMUVdr7pK9iqSEknwBqgR2HFZCVETOpQLOpEjbuiFDph3/z0Gv0AhyAEBaLO1Aw=\n\
             trusted comment: timestamp:1795796357\tfile:SHA256SUMS\thashed\n\
             bxpyNWh8Jr4tkmDzo0IH5odpZy1epHl3EsxM3zxI7y83lmlmDNwOyjstfViECBkPu5RQRk9ohB1jgx5O2RD8Bw==\n";
        let sums = b"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  Opaline_2.0.0_amd64.deb\n";
        assert_eq!(verify_minisign(pubkey, minisig, sums), Ok(()));
        assert!(verify_minisign(pubkey, minisig, b"tampered").is_err());
        assert_eq!(
            verify_minisign(RELEASE_MINISIGN_PUBKEY, minisig, sums),
            Err("minisign-key-id-mismatch".into())
        );
        let forged_comment = minisig.replace("file:SHA256SUMS", "file:OTHER");
        assert!(verify_minisign(pubkey, &forged_comment, sums).is_err());
    }

    #[test]
    fn built_in_signing_keys_are_well_formed() {
        assert!(decode_minisign_pubkey(RELEASE_MINISIGN_PUBKEY).is_ok());
        assert!(decode_minisign_pubkey(crate::gallery::GALLERY_MINISIGN_PUBKEY).is_ok());
        assert_ne!(
            RELEASE_MINISIGN_PUBKEY,
            crate::gallery::GALLERY_MINISIGN_PUBKEY
        );
    }
}

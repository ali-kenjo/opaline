//! Community gallery client and cryptographic verifier (PLAN-2 9.3, brief §9.4).
//!
//! Fetches `index.json` **only while the Gallery UI is explicitly open** (zero background
//! requests, zero accounts, zero telemetry). Every package download verifies BOTH its SHA-256
//! checksum and its minisign Ed25519 signature (reusing `updates::verify_minisign`) before
//! extracting safely via `PluginsManager::install_zip` (where permissions still await user approval).

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::hub::Hub;
use crate::plugins::{PluginKind, PluginPermissions, PluginStatus};

/// Default GitHub raw URL for the community gallery index (`ali-kenjo/opaline-gallery`).
pub const GALLERY_INDEX_URL: &str =
    "https://raw.githubusercontent.com/ali-kenjo/opaline-gallery/main/index.json";

/// Official gallery signing key (minisign key id `876F67B4BCCC92FA`, minted 2026-11-27). Gallery
/// packages must be signed with its secret half; anything else is refused (same rule as `updates.rs`).
pub const GALLERY_MINISIGN_PUBKEY: &str =
    "RWT6ksy8tGdvh5EOpAP3LdnWNm3Bj6CXUydzXgpovOatInQkEcMzBwbn";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GalleryPackage {
    pub id: String,
    pub name: String,
    pub kind: PluginKind,
    pub version: String,
    pub author: String,
    pub license: String,
    pub description: String,
    pub download_url: String,
    pub sha256: String,
    pub signature: String,
    #[serde(default = "default_min_opaline")]
    pub min_opaline_version: String,
    #[serde(default)]
    pub permissions: PluginPermissions,
}

fn default_min_opaline() -> String {
    "2.0.0".into()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GalleryIndex {
    pub version: u32,
    pub updated_at: String,
    pub packages: Vec<GalleryPackage>,
}

/// Verifies `bytes` against BOTH `expected_sha256` (lowercase hex) AND `minisig_text`
/// using `pubkey_b64` (reusing `crate::updates::verify_minisign`).
pub fn verify_package_bytes(
    pubkey_b64: &str,
    expected_sha256: &str,
    minisig_text: &str,
    bytes: &[u8],
) -> Result<(), String> {
    if pubkey_b64.trim().is_empty() {
        return Err("gallery-signing-key-not-configured".into());
    }
    let expected = expected_sha256.trim().to_ascii_lowercase();
    if expected.len() != 64 || !expected.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("invalid-expected-sha256".into());
    }
    let actual = hex::encode(Sha256::digest(bytes));
    if actual != expected {
        return Err("gallery-checksum-mismatch".into());
    }
    crate::updates::verify_minisign(pubkey_b64, minisig_text, bytes)
        .map_err(|e| format!("gallery-signature-failed: {e}"))
}

/// Explicitly fetches the gallery `index.json` over HTTPS (only called while Gallery UI is open).
pub async fn fetch_index(index_url: Option<&str>) -> Result<GalleryIndex, String> {
    let url = index_url.unwrap_or(GALLERY_INDEX_URL);
    if !url.starts_with("https://") {
        return Err("gallery-index-must-be-https".into());
    }
    let raw = crate::http::get_json(url).await?;
    let index: GalleryIndex =
        serde_json::from_value(raw).map_err(|e| format!("invalid-gallery-index: {e}"))?;
    if index.version != 1 {
        return Err(format!(
            "unsupported-gallery-index-version: {}",
            index.version
        ));
    }
    Ok(index)
}

/// Downloads a gallery package over HTTPS, verifies SHA-256 + minisign signature, and installs it
/// into `PluginsManager` (requiring explicit user permission approval before execution).
pub async fn install_package(
    hub: &Hub,
    pkg: &GalleryPackage,
    pubkey_override: Option<&str>,
) -> Result<PluginStatus, String> {
    if !pkg.download_url.starts_with("https://") {
        return Err("gallery-package-must-be-https".into());
    }
    let pubkey = pubkey_override.unwrap_or(GALLERY_MINISIGN_PUBKEY);
    if pubkey.trim().is_empty() {
        return Err("gallery-signing-key-not-configured".into());
    }
    let (bytes, _) = crate::http::fetch_limited(
        &pkg.download_url,
        crate::zip_pkg::MAX_ARCHIVE_BYTES,
        &["application/zip", "application/octet-stream"],
    )
    .await?;
    verify_package_bytes(pubkey, &pkg.sha256, &pkg.signature, &bytes)?;
    let mgr = hub
        .plugins()
        .ok_or_else(|| "plugins-unavailable".to_owned())?;
    mgr.install_zip(hub, &bytes)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;
    use base64::Engine as _;
    use ring::signature::{Ed25519KeyPair, KeyPair};

    fn make_signed_fixture(payload: &[u8]) -> (String, String, String) {
        let seed = [0x42u8; 32];
        let kp = Ed25519KeyPair::from_seed_unchecked(&seed).unwrap();
        let key_id = *b"OPALGAL1";

        let mut pub_raw = Vec::with_capacity(42);
        pub_raw.extend_from_slice(b"Ed");
        pub_raw.extend_from_slice(&key_id);
        pub_raw.extend_from_slice(kp.public_key().as_ref());
        let pub_b64 = base64::engine::general_purpose::STANDARD.encode(&pub_raw);

        let sig = kp.sign(payload);
        let mut sig_raw = Vec::with_capacity(74);
        sig_raw.extend_from_slice(b"Ed");
        sig_raw.extend_from_slice(&key_id);
        sig_raw.extend_from_slice(sig.as_ref());
        let sig_b64 = base64::engine::general_purpose::STANDARD.encode(&sig_raw);

        let trusted = "timestamp:1700000000\tfile:demo.opaline-plugin";
        let mut global_msg = Vec::with_capacity(64 + trusted.len());
        global_msg.extend_from_slice(sig.as_ref());
        global_msg.extend_from_slice(trusted.as_bytes());
        let global_sig = kp.sign(&global_msg);
        let global_b64 = base64::engine::general_purpose::STANDARD.encode(global_sig.as_ref());

        let minisig = format!(
            "untrusted comment: gallery sig\n{sig_b64}\ntrusted comment: {trusted}\n{global_b64}\n"
        );
        let sha256 = hex::encode(Sha256::digest(payload));
        (pub_b64, sha256, minisig)
    }

    #[test]
    fn verifies_valid_package_and_rejects_tamper_or_missing_key() {
        let payload = b"synthetic-opaline-package-zip";
        let (pubkey, sha, sig) = make_signed_fixture(payload);

        // Valid signature + checksum passes.
        assert!(verify_package_bytes(&pubkey, &sha, &sig, payload).is_ok());

        // Tampered payload fails checksum.
        assert!(verify_package_bytes(&pubkey, &sha, &sig, b"tampered").is_err());

        // Matching checksum of tampered payload fails minisign.
        let tampered_sha = hex::encode(Sha256::digest(b"tampered"));
        assert!(verify_package_bytes(&pubkey, &tampered_sha, &sig, b"tampered").is_err());

        // Empty gallery pubkey refuses install fail-closed.
        assert!(verify_package_bytes("", &sha, &sig, payload).is_err());
    }
}

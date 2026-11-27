//! Sandboxed code plugins and declarative packages (PLAN-2 9.1, 9.4, brief §9, ADR 0014).
//!
//! Plugins live under `~/.local/share/opaline/plugins/<id>/` with a validated `plugin.json`
//! manifest. Approval is recorded per `(id, pluginVersion, SHA-256 fingerprint of permissions +
//! entry script)` in `~/.config/opaline/plugins-trust.json`: any change to permissions or code
//! automatically revokes approval until the user reviews and approves again.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};

use opaline_ipc::{Topic, TopicUpdate};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::hub::Hub;
use crate::zip_pkg;

pub const MANIFEST_VERSION: u32 = 1;
pub const TOPIC: &str = "plugins.state";
const MAX_ENTRY_BYTES: usize = 512 * 1024; // 512 KiB max plugin worker script
const MAX_MANIFEST_BYTES: usize = 128 * 1024;

/// Allowed composition/plugin command names (strictly matches `docs/COMPOSITION.md`).
const ALLOWED_PLUGIN_ACTIONS: &[&str] = &[
    "media-toggle",
    "media-next",
    "media-prev",
    "power-profile",
    "control-toggle",
    "timer-action",
    "todo-toggle",
    "note-toggle-checkbox",
    "ha-toggle-entity",
    "n8n-set-workflow-active",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum PluginKind {
    #[default]
    CodeWidget,
    DeclarativeWidget,
    Theme,
    Rice,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PluginPermissions {
    /// Core topics this plugin may receive (filtered at the layer bridge).
    pub topics: Vec<String>,
    /// Custom source IDs declared or referenced by this package.
    pub sources: Vec<String>,
    /// Allow-listed actions this plugin may request (validated against `ALLOWED_PLUGIN_ACTIONS`).
    pub actions: Vec<String>,
}

/// Plugin manifest (`plugin.json`, brief §9.3).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    #[serde(default = "default_version")]
    pub version: u32,
    pub id: String,
    pub name: String,
    pub plugin_version: String,
    pub author: String,
    pub license: String,
    #[serde(default = "default_min_opaline")]
    pub min_opaline_version: String,
    #[serde(default)]
    pub kind: PluginKind,
    /// Relative entry path (`worker.js` for code widgets, `composition.json` for declarative).
    pub entry: String,
    #[serde(default = "default_sizes")]
    pub sizes: Vec<String>,
    #[serde(default)]
    pub description: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub translations: BTreeMap<String, BTreeMap<String, String>>,
    #[serde(default)]
    pub permissions: PluginPermissions,
}

fn default_version() -> u32 {
    MANIFEST_VERSION
}

fn default_min_opaline() -> String {
    "2.0.0".into()
}

fn default_sizes() -> Vec<String> {
    vec!["S".into(), "M".into()]
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PluginTrustState {
    Approved,
    NeedsApproval,
    Disabled,
    Error,
}

/// Runtime status returned to Settings → Plugins & Gallery and `"plugins.state"`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginStatus {
    pub id: String,
    pub name: String,
    pub plugin_version: String,
    pub author: String,
    pub license: String,
    pub description: String,
    pub kind: PluginKind,
    pub entry: String,
    pub sizes: Vec<String>,
    pub permissions: PluginPermissions,
    pub permission_summary: String,
    pub fingerprint: String,
    pub state: PluginTrustState,
    pub error: Option<String>,
}

/// Output of `opaline pack <dir>`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackReport {
    pub id: String,
    pub plugin_version: String,
    pub output_path: String,
    pub file_count: usize,
    pub bytes: usize,
    pub sha256: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct TrustRecord {
    plugin_version: String,
    fingerprint: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct TrustFile {
    version: u32,
    approved: BTreeMap<String, TrustRecord>,
}

/// Validates a plugin identifier (`[a-z0-9_-]`, 2..=48 chars, not `"spike"`).
pub fn validate_id(id: &str) -> Result<(), String> {
    if id.len() < 2 || id.len() > 48 {
        return Err("plugin id must be 2..=48 characters".into());
    }
    if id == "spike" {
        return Err("plugin id 'spike' is reserved".into());
    }
    if !id
        .bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
    {
        return Err("plugin id may contain only lowercase letters, digits, '-' and '_'".into());
    }
    Ok(())
}

/// Validates a plugin manifest (schema version, id, semver, entry path, permissions allowlist).
pub fn validate_manifest(m: &PluginManifest) -> Result<(), String> {
    if m.version != MANIFEST_VERSION {
        return Err(format!(
            "unsupported manifest version {} (expected {MANIFEST_VERSION})",
            m.version
        ));
    }
    validate_id(&m.id)?;
    if m.name.trim().is_empty() || m.name.len() > 80 {
        return Err("manifest name must be 1..=80 characters".into());
    }
    if crate::updates::parse_semver(&m.plugin_version).is_none() {
        return Err(format!(
            "invalid semver pluginVersion '{}'",
            m.plugin_version
        ));
    }
    if m.author.trim().is_empty() || m.author.len() > 80 {
        return Err("manifest author must be 1..=80 characters".into());
    }
    if m.license.trim().is_empty() || m.license.len() > 48 {
        return Err("manifest license must be 1..=48 characters".into());
    }
    if !zip_pkg::is_safe_entry_path(&m.entry) {
        return Err(format!("unsafe manifest entry path '{}'", m.entry));
    }
    if m.kind == PluginKind::CodeWidget && !m.entry.ends_with(".js") {
        return Err("code-widget entry must be a .js file".into());
    }
    if m.permissions.topics.len() > 64 {
        return Err("too many requested topics (max 64)".into());
    }
    for topic in &m.permissions.topics {
        if topic.trim().is_empty()
            || topic.len() > 64
            || !topic
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
        {
            return Err(format!("invalid requested topic '{topic}'"));
        }
    }
    for action in &m.permissions.actions {
        if !ALLOWED_PLUGIN_ACTIONS.contains(&action.as_str()) {
            return Err(format!(
                "disallowed plugin action '{action}' (not in composition allowlist)"
            ));
        }
    }
    Ok(())
}

/// Computes the approval fingerprint over permissions + entry script bytes.
/// Any change to permissions OR code changes this hash and forces re-approval.
pub fn permission_fingerprint(m: &PluginManifest, entry_bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(m.id.as_bytes());
    h.update([0]);
    h.update(m.plugin_version.as_bytes());
    h.update([0]);
    h.update(m.entry.as_bytes());
    h.update([0]);
    if let Ok(perms_json) = serde_json::to_vec(&m.permissions) {
        h.update(&perms_json);
    }
    h.update([0]);
    h.update(entry_bytes);
    hex::encode(h.finalize())
}

/// Human-readable permission summary shown on install and in Settings → Plugins & Gallery.
pub fn permission_summary(m: &PluginManifest) -> String {
    let mut parts = Vec::new();
    if m.permissions.topics.is_empty() {
        parts.push("Reads no topics".to_owned());
    } else {
        parts.push(format!("Reads topics: {}", m.permissions.topics.join(", ")));
    }
    if !m.permissions.sources.is_empty() {
        parts.push(format!(
            "Uses sources: {}",
            m.permissions.sources.join(", ")
        ));
    }
    if m.permissions.actions.is_empty() {
        parts.push("No actions".to_owned());
    } else {
        parts.push(format!("Actions: {}", m.permissions.actions.join(", ")));
    }
    parts.push("No direct network or Tauri IPC access (ADR 0014 sandbox)".to_owned());
    parts.join(" · ")
}

/// Validates a local plugin source directory (`opaline validate <dir>`).
pub fn validate_dir(dir: &Path) -> Result<PluginManifest, String> {
    if !dir.is_dir() {
        return Err(format!("not a directory: {}", dir.display()));
    }
    let manifest_path = dir.join("plugin.json");
    let raw = std::fs::read(&manifest_path)
        .map_err(|e| format!("could not read {}: {e}", manifest_path.display()))?;
    if raw.len() > MAX_MANIFEST_BYTES {
        return Err("plugin.json exceeds 128 KiB limit".into());
    }
    let manifest: PluginManifest =
        serde_json::from_slice(&raw).map_err(|e| format!("invalid plugin.json: {e}"))?;
    validate_manifest(&manifest)?;

    let entry_path = dir.join(&manifest.entry);
    let entry_bytes = std::fs::read(&entry_path)
        .map_err(|e| format!("missing entry '{}': {e}", manifest.entry))?;
    if entry_bytes.len() > MAX_ENTRY_BYTES {
        return Err(format!(
            "entry '{}' exceeds {MAX_ENTRY_BYTES} byte limit",
            manifest.entry
        ));
    }

    // Walk directory files to ensure no unsafe paths or remote CSS imports exist.
    let files = collect_dir_files(dir, dir)?;
    if files.len() > zip_pkg::MAX_ENTRIES {
        return Err("package contains too many files".into());
    }
    for (rel, bytes) in &files {
        if rel.ends_with(".css") {
            let css =
                std::str::from_utf8(bytes).map_err(|_| format!("non-UTF-8 CSS file '{rel}'"))?;
            crate::css::validate_css(rel, css)
                .map_err(|e| format!("disallowed CSS in '{rel}': {e:?}"))?;
        }
    }
    Ok(manifest)
}

/// Validates and packs a plugin directory into a `.opaline-plugin` ZIP archive (`opaline pack <dir>`).
pub fn pack_dir(dir: &Path, out_path: Option<&Path>) -> Result<PackReport, String> {
    let manifest = validate_dir(dir)?;
    let files = collect_dir_files(dir, dir)?;
    let zip_bytes = zip_pkg::write_zip(&files)?;
    let sha256 = hex::encode(Sha256::digest(&zip_bytes));

    let target = match out_path {
        Some(p) => p.to_path_buf(),
        None => dir.parent().unwrap_or(dir).join(format!(
            "{}-{}.opaline-plugin",
            manifest.id, manifest.plugin_version
        )),
    };
    crate::paths::write_atomic(&target, &zip_bytes)
        .map_err(|e| format!("could not write {}: {e}", target.display()))?;

    Ok(PackReport {
        id: manifest.id,
        plugin_version: manifest.plugin_version,
        output_path: target.display().to_string(),
        file_count: files.len(),
        bytes: zip_bytes.len(),
        sha256,
    })
}

fn collect_dir_files(root: &Path, cur: &Path) -> Result<BTreeMap<String, Vec<u8>>, String> {
    let mut out = BTreeMap::new();
    let entries = std::fs::read_dir(cur).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let meta = std::fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if meta.file_type().is_symlink() {
            return Err(format!(
                "symlinks are not allowed in packages: {}",
                path.display()
            ));
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "node_modules" {
            continue;
        }
        if meta.is_dir() {
            let sub = collect_dir_files(root, &path)?;
            out.extend(sub);
        } else if meta.is_file() {
            let rel = path
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            if !zip_pkg::is_safe_entry_path(&rel) {
                return Err(format!("unsafe relative path '{rel}'"));
            }
            let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
            if bytes.len() > zip_pkg::MAX_ENTRY_BYTES {
                return Err(format!("file '{rel}' exceeds size limit"));
            }
            out.insert(rel, bytes);
        }
    }
    Ok(out)
}

/// Thread-safe manager for installed plugins and trust approvals.
#[derive(Debug)]
pub struct PluginsManager {
    plugins_dir: PathBuf,
    trust_path: PathBuf,
    trust: Mutex<TrustFile>,
}

impl PluginsManager {
    pub fn new(data_dir: PathBuf, config_dir: PathBuf) -> Arc<Self> {
        let plugins_dir = data_dir.join("plugins");
        let trust_path = config_dir.join("plugins-trust.json");
        let trust = load_trust(&trust_path);
        Arc::new(Self {
            plugins_dir,
            trust_path,
            trust: Mutex::new(trust),
        })
    }

    pub fn plugins_dir(&self) -> &Path {
        &self.plugins_dir
    }

    /// Lists all installed plugins with their live trust/approval state.
    pub fn list(&self, safe_mode: bool) -> Vec<PluginStatus> {
        let trust = lock(&self.trust).clone();
        let Ok(entries) = std::fs::read_dir(&self.plugins_dir) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        for entry in entries.flatten() {
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            let folder_id = entry.file_name().to_string_lossy().to_string();
            match self.inspect_plugin_dir(&dir, &trust, safe_mode) {
                Ok(status) => out.push(status),
                Err(err) => out.push(PluginStatus {
                    id: folder_id.clone(),
                    name: folder_id,
                    plugin_version: "0.0.0".into(),
                    author: String::new(),
                    license: String::new(),
                    description: String::new(),
                    kind: PluginKind::CodeWidget,
                    entry: String::new(),
                    sizes: Vec::new(),
                    permissions: PluginPermissions::default(),
                    permission_summary: String::new(),
                    fingerprint: String::new(),
                    state: PluginTrustState::Error,
                    error: Some(err),
                }),
            }
        }
        out.sort_by(|a, b| a.id.cmp(&b.id));
        out
    }

    fn inspect_plugin_dir(
        &self,
        dir: &Path,
        trust: &TrustFile,
        safe_mode: bool,
    ) -> Result<PluginStatus, String> {
        let manifest = validate_dir(dir)?;
        let entry_bytes = std::fs::read(dir.join(&manifest.entry))
            .map_err(|e| format!("entry read failed: {e}"))?;
        let fingerprint = permission_fingerprint(&manifest, &entry_bytes);
        let approved = trust.approved.get(&manifest.id).is_some_and(|rec| {
            rec.plugin_version == manifest.plugin_version && rec.fingerprint == fingerprint
        });
        let state = if safe_mode && manifest.kind == PluginKind::CodeWidget {
            PluginTrustState::Disabled
        } else if approved {
            PluginTrustState::Approved
        } else {
            PluginTrustState::NeedsApproval
        };
        Ok(PluginStatus {
            permission_summary: permission_summary(&manifest),
            id: manifest.id,
            name: manifest.name,
            plugin_version: manifest.plugin_version,
            author: manifest.author,
            license: manifest.license,
            description: manifest.description,
            kind: manifest.kind,
            entry: manifest.entry,
            sizes: manifest.sizes,
            permissions: manifest.permissions,
            fingerprint,
            state,
            error: None,
        })
    }

    /// Approves an installed plugin at its current `(version, permission+code fingerprint)`.
    pub fn approve(&self, hub: &Hub, id: &str) -> Result<PluginStatus, String> {
        validate_id(id)?;
        let dir = self.plugins_dir.join(id);
        let manifest = validate_dir(&dir)?;
        let entry_bytes = std::fs::read(dir.join(&manifest.entry))
            .map_err(|e| format!("entry read failed: {e}"))?;
        let fingerprint = permission_fingerprint(&manifest, &entry_bytes);
        let snapshot = {
            let mut guard = lock(&self.trust);
            guard.version = MANIFEST_VERSION;
            guard.approved.insert(
                id.to_owned(),
                TrustRecord {
                    plugin_version: manifest.plugin_version,
                    fingerprint,
                },
            );
            guard.clone()
        };
        save_trust(&self.trust_path, &snapshot)?;
        self.publish_state(hub);
        self.list(hub.safe_mode())
            .into_iter()
            .find(|p| p.id == id)
            .ok_or_else(|| "plugin-not-found".into())
    }

    /// Revokes approval for a plugin (immediately blocks its sandbox execution).
    pub fn revoke(&self, hub: &Hub, id: &str) -> Result<(), String> {
        validate_id(id)?;
        let snapshot = {
            let mut guard = lock(&self.trust);
            guard.approved.remove(id);
            guard.clone()
        };
        save_trust(&self.trust_path, &snapshot)?;
        self.publish_state(hub);
        Ok(())
    }

    /// Extracts a validated `.opaline-plugin` ZIP archive into `plugins/<id>/`.
    /// Newly installed or updated packages ALWAYS start as `NeedsApproval`.
    pub fn install_zip(&self, hub: &Hub, zip_bytes: &[u8]) -> Result<PluginStatus, String> {
        let files = zip_pkg::read_zip(zip_bytes)?;
        let manifest_raw = files
            .get("plugin.json")
            .ok_or_else(|| "archive missing plugin.json".to_owned())?;
        let manifest: PluginManifest = serde_json::from_slice(manifest_raw)
            .map_err(|e| format!("invalid plugin.json: {e}"))?;
        validate_manifest(&manifest)?;
        if !files.contains_key(&manifest.entry) {
            return Err(format!("archive missing entry '{}'", manifest.entry));
        }

        // Write into a staging dir and validate before swapping into place.
        let dest = self.plugins_dir.join(&manifest.id);
        if dest.exists() {
            std::fs::remove_dir_all(&dest).map_err(|e| e.to_string())?;
        }
        std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
        for (rel, bytes) in &files {
            if !zip_pkg::is_safe_entry_path(rel) {
                return Err(format!("unsafe archive path '{rel}'"));
            }
            let out = dest.join(rel);
            if let Some(parent) = out.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::write(&out, bytes).map_err(|e| e.to_string())?;
        }
        if let Err(err) = validate_dir(&dest) {
            let _ = std::fs::remove_dir_all(&dest);
            return Err(err);
        }

        // Revoke any previous approval so updates always re-prompt on permission/code change.
        let _ = self.revoke(hub, &manifest.id);
        self.publish_state(hub);
        self.list(hub.safe_mode())
            .into_iter()
            .find(|p| p.id == manifest.id)
            .ok_or_else(|| "plugin-install-failed".into())
    }

    /// Removes an installed plugin and its trust record.
    pub fn remove(&self, hub: &Hub, id: &str) -> Result<bool, String> {
        validate_id(id)?;
        let dir = self.plugins_dir.join(id);
        let existed = dir.exists();
        if existed {
            std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
        }
        let _ = self.revoke(hub, id);
        self.publish_state(hub);
        Ok(existed)
    }

    /// Reads an asset file for an APPROVED plugin (used by the `opaline-plugin://` URI scheme).
    /// Returns `None` for unapproved, tampered, or missing plugins.
    pub fn read_approved_file(
        &self,
        plugin_id: &str,
        rel_path: &str,
        safe_mode: bool,
    ) -> Option<Vec<u8>> {
        if safe_mode || validate_id(plugin_id).is_err() || !zip_pkg::is_safe_entry_path(rel_path) {
            return None;
        }
        let trust = lock(&self.trust).clone();
        let dir = self.plugins_dir.join(plugin_id);
        let status = self.inspect_plugin_dir(&dir, &trust, safe_mode).ok()?;
        if status.state != PluginTrustState::Approved {
            return None;
        }
        std::fs::read(dir.join(rel_path)).ok()
    }

    pub fn publish_state(&self, hub: &Hub) {
        let items = self.list(hub.safe_mode());
        if let Ok(val) = serde_json::to_value(&items) {
            hub.publish(vec![TopicUpdate {
                topic: Topic::new(TOPIC),
                value: crate::json::from_json(&val),
            }]);
        }
    }
}

fn load_trust(path: &Path) -> TrustFile {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_trust(path: &Path, file: &TrustFile) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(file).map_err(|e| e.to_string())?;
    crate::paths::write_atomic(path, &bytes).map_err(|e| e.to_string())
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;
    use opaline_ipc::BackendKind;

    fn write_sample_plugin(dir: &Path, worker_js: &str) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(
            dir.join("plugin.json"),
            r#"{
              "version": 1,
              "id": "demo-gauge",
              "name": "Demo Gauge",
              "pluginVersion": "1.0.0",
              "author": "Opaline",
              "license": "GPL-3.0-or-later",
              "minOpalineVersion": "2.0.0",
              "kind": "code-widget",
              "entry": "worker.js",
              "sizes": ["S", "M"],
              "permissions": {
                "topics": ["cpu.load"],
                "sources": [],
                "actions": ["media-toggle"]
              }
            }"#,
        )
        .unwrap();
        std::fs::write(dir.join("worker.js"), worker_js).unwrap();
    }

    #[test]
    fn pack_validate_install_approve_and_invalidate_on_code_change() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("src");
        write_sample_plugin(&src, "self.onmessage = () => {};");

        // Validate and pack
        let m = validate_dir(&src).unwrap();
        assert_eq!(m.id, "demo-gauge");
        let archive = tmp.path().join("demo.opaline-plugin");
        let report = pack_dir(&src, Some(&archive)).unwrap();
        assert_eq!(report.id, "demo-gauge");
        assert_eq!(report.file_count, 2);

        // Install -> starts as NeedsApproval; read_approved_file refuses it.
        let hub = Hub::new(BackendKind::Instant, Vec::new());
        let mgr = PluginsManager::new(tmp.path().join("data"), tmp.path().join("cfg"));
        let zip_bytes = std::fs::read(&archive).unwrap();
        let installed = mgr.install_zip(&hub, &zip_bytes).unwrap();
        assert_eq!(installed.state, PluginTrustState::NeedsApproval);
        assert!(
            mgr.read_approved_file("demo-gauge", "worker.js", false)
                .is_none()
        );

        // Approve -> now readable, except in safe mode.
        let approved = mgr.approve(&hub, "demo-gauge").unwrap();
        assert_eq!(approved.state, PluginTrustState::Approved);
        assert!(
            mgr.read_approved_file("demo-gauge", "worker.js", false)
                .is_some()
        );
        assert!(
            mgr.read_approved_file("demo-gauge", "worker.js", true)
                .is_none()
        );

        // Tampering with worker.js on disk changes fingerprint -> automatically unapproved!
        std::fs::write(
            mgr.plugins_dir().join("demo-gauge/worker.js"),
            "self.onmessage = () => { /* changed */ };",
        )
        .unwrap();
        let list = mgr.list(false);
        assert_eq!(list[0].state, PluginTrustState::NeedsApproval);
        assert!(
            mgr.read_approved_file("demo-gauge", "worker.js", false)
                .is_none()
        );
    }

    #[test]
    fn rejects_disallowed_actions_and_unsafe_paths() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("plugin.json"),
            r#"{
              "version": 1,
              "id": "bad-act",
              "name": "Bad",
              "pluginVersion": "1.0.0",
              "author": "A",
              "license": "MIT",
              "kind": "code-widget",
              "entry": "worker.js",
              "permissions": { "topics": [], "sources": [], "actions": ["run-arbitrary-shell"] }
            }"#,
        )
        .unwrap();
        std::fs::write(tmp.path().join("worker.js"), "").unwrap();
        assert!(validate_dir(tmp.path()).is_err());
    }

    #[test]
    fn template_plugin_example_is_valid_and_packs_cleanly() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/template-plugin");
        let manifest = validate_dir(&root).unwrap();
        assert_eq!(manifest.id, "template-pulse");
        let tmp = tempfile::tempdir().unwrap();
        let out = tmp.path().join("template-pulse.opaline-plugin");
        let report = pack_dir(&root, Some(&out)).unwrap();
        assert_eq!(report.id, "template-pulse");
        assert!(out.is_file());
    }
}

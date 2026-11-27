//! Schema-backed data model for custom sources, trust approvals, and custom widget packages
//! (PLAN-2 tasks 6.1, 6.2, 6.4, 6.6, 6.7).

use std::collections::BTreeMap;
use std::path::Path;

use opaline_compose::{Composition, SizeClass};
use schemars::{JsonSchema, schema_for};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const SOURCE_SCHEMA_VERSION: u32 = 1;
pub const CUSTOM_WIDGET_SCHEMA_VERSION: u32 = 1;

/// Validates an identifier for custom sources and custom widgets: 1–48 lowercase ASCII
/// letters, digits, `.`, `_`, or `-`, starting with a letter or digit.
pub fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 48 {
        return Err("id must be 1..=48 characters".into());
    }
    let bytes = id.as_bytes();
    if !bytes[0].is_ascii_lowercase() && !bytes[0].is_ascii_digit() {
        return Err("id must start with a lowercase letter or digit".into());
    }
    if !bytes
        .iter()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'-' | b'_' | b'.'))
    {
        return Err("id may only contain lowercase letters, digits, '-', '_', '.'".into());
    }
    Ok(())
}

/// How raw output bytes from a command, file, HTTP endpoint, or MQTT message are parsed.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum OutputFormat {
    #[default]
    Text,
    Lines,
    Json,
    Csv,
    Regex,
    Markdown,
    Todotxt,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum DbusBus {
    #[default]
    Session,
    System,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum DbusMode {
    #[default]
    Property,
    Signal,
}

/// Where a source came from. User-created sources run immediately; imported sources stay off
/// until the user approves their exact command/paths/hosts/D-Bus names (brief §4.5, PLAN-2 6.6).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum SourceOrigin {
    #[default]
    User,
    Imported {
        #[serde(rename = "packageId")]
        package_id: String,
        #[serde(rename = "packageVersion")]
        package_version: String,
    },
}

fn default_true() -> bool {
    true
}
fn default_interval_s() -> u64 {
    30
}
fn default_timeout_ms() -> u64 {
    5000
}
fn default_max_bytes() -> usize {
    256 * 1024
}
fn default_mqtt_port() -> u16 {
    8883
}
fn default_source_version() -> u32 {
    SOURCE_SCHEMA_VERSION
}
fn default_widget_version() -> u32 {
    CUSTOM_WIDGET_SCHEMA_VERSION
}

/// One of the six custom source types (brief §4.4).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum SourceKind {
    Command {
        argv: Vec<String>,
        #[serde(default)]
        shell: bool,
        #[serde(default = "default_interval_s", rename = "intervalS")]
        interval_s: u64,
        #[serde(default = "default_timeout_ms", rename = "timeoutMs")]
        timeout_ms: u64,
        #[serde(default = "default_max_bytes", rename = "maxBytes")]
        max_bytes: usize,
        #[serde(default, rename = "envAllowlist")]
        env_allowlist: Vec<String>,
        #[serde(default)]
        format: OutputFormat,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        regex: Option<String>,
    },
    File {
        path: String,
        #[serde(default = "default_max_bytes", rename = "maxBytes")]
        max_bytes: usize,
        #[serde(default)]
        format: OutputFormat,
        #[serde(default, skip_serializing_if = "Option::is_none", rename = "jsonPath")]
        json_path: Option<String>,
    },
    Http {
        url: String,
        #[serde(default, rename = "allowLocalHttp")]
        allow_local_http: bool,
        #[serde(default = "default_interval_s", rename = "intervalS")]
        interval_s: u64,
        #[serde(default = "default_timeout_ms", rename = "timeoutMs")]
        timeout_ms: u64,
        #[serde(default = "default_max_bytes", rename = "maxBytes")]
        max_bytes: usize,
        #[serde(default)]
        headers: BTreeMap<String, String>,
        #[serde(default = "default_json_format")]
        format: OutputFormat,
        #[serde(default, skip_serializing_if = "Option::is_none", rename = "jsonPath")]
        json_path: Option<String>,
    },
    Dbus {
        #[serde(default)]
        bus: DbusBus,
        destination: String,
        path: String,
        interface: String,
        member: String,
        #[serde(default)]
        mode: DbusMode,
        #[serde(default = "default_interval_s", rename = "intervalS")]
        interval_s: u64,
    },
    Mqtt {
        host: String,
        #[serde(default = "default_mqtt_port")]
        port: u16,
        #[serde(default = "default_true")]
        tls: bool,
        topic: String,
        #[serde(default, skip_serializing_if = "Option::is_none", rename = "clientId")]
        client_id: Option<String>,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            rename = "usernameSecret"
        )]
        username_secret: Option<String>,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            rename = "passwordSecret"
        )]
        password_secret: Option<String>,
        #[serde(default)]
        format: OutputFormat,
        #[serde(default, skip_serializing_if = "Option::is_none", rename = "jsonPath")]
        json_path: Option<String>,
    },
    Variable {
        #[serde(default = "default_true")]
        persist: bool,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            rename = "defaultValue"
        )]
        default_value: Option<serde_json::Value>,
    },
}

fn default_json_format() -> OutputFormat {
    OutputFormat::Json
}

/// On-disk definition of a custom source (`~/.config/opaline/sources/<id>.json`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SourceSpec {
    #[serde(default, rename = "$schema", skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    #[serde(default = "default_source_version")]
    pub version: u32,
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub origin: SourceOrigin,
    #[serde(flatten)]
    pub kind: SourceKind,
}

impl SourceSpec {
    pub fn schema() -> serde_json::Value {
        serde_json::to_value(schema_for!(Self)).unwrap_or(serde_json::Value::Null)
    }

    /// The hub topic published by this source (`var.<id>` for Variables, `source.<id>` otherwise).
    pub fn topic_name(&self) -> String {
        match self.kind {
            SourceKind::Variable { .. } => format!("var.{}", self.id),
            _ => format!("source.{}", self.id),
        }
    }

    pub fn kind_label(&self) -> &'static str {
        match self.kind {
            SourceKind::Command { .. } => "command",
            SourceKind::File { .. } => "file",
            SourceKind::Http { .. } => "http",
            SourceKind::Dbus { .. } => "dbus",
            SourceKind::Mqtt { .. } => "mqtt",
            SourceKind::Variable { .. } => "variable",
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.version != SOURCE_SCHEMA_VERSION {
            return Err(format!("unsupported source version {}", self.version));
        }
        validate_id(&self.id)?;
        if self.name.trim().is_empty() || self.name.len() > 80 {
            return Err("source name must be 1..=80 characters".into());
        }
        match &self.kind {
            SourceKind::Command {
                argv,
                interval_s,
                timeout_ms,
                max_bytes,
                ..
            } => {
                if argv.is_empty() || argv[0].trim().is_empty() {
                    return Err("command argv must have at least one non-empty entry".into());
                }
                if *interval_s == 0 || *interval_s > 86_400 {
                    return Err("command intervalS must be 1..=86400".into());
                }
                if *timeout_ms < 100 || *timeout_ms > 30_000 {
                    return Err("command timeoutMs must be 100..=30000".into());
                }
                if *max_bytes < 64 || *max_bytes > 2 << 20 {
                    return Err("command maxBytes must be 64..=2097152".into());
                }
            }
            SourceKind::File {
                path, max_bytes, ..
            } => {
                if path.trim().is_empty() {
                    return Err("file path must not be empty".into());
                }
                if *max_bytes < 64 || *max_bytes > 2 << 20 {
                    return Err("file maxBytes must be 64..=2097152".into());
                }
            }
            SourceKind::Http {
                url,
                interval_s,
                timeout_ms,
                max_bytes,
                ..
            } => {
                let parsed = url::Url::parse(url).map_err(|e| format!("invalid url: {e}"))?;
                if parsed.scheme() != "https" && parsed.scheme() != "http" {
                    return Err("http source url must use https:// or http://".into());
                }
                if !parsed.username().is_empty() || parsed.password().is_some() {
                    return Err(
                        "url must not embed credentials; use {{secret:name}} headers".into(),
                    );
                }
                if *interval_s == 0 || *interval_s > 86_400 {
                    return Err("http intervalS must be 1..=86400".into());
                }
                if *timeout_ms < 500 || *timeout_ms > 30_000 {
                    return Err("http timeoutMs must be 500..=30000".into());
                }
                if *max_bytes < 1024 || *max_bytes > 2 << 20 {
                    return Err("http maxBytes must be 1024..=2097152".into());
                }
            }
            SourceKind::Dbus {
                destination,
                path,
                interface,
                member,
                interval_s,
                ..
            } => {
                if destination.trim().is_empty()
                    || !path.starts_with('/')
                    || interface.trim().is_empty()
                    || member.trim().is_empty()
                {
                    return Err(
                        "dbus source requires destination, /path, interface, and member".into(),
                    );
                }
                if *interval_s == 0 || *interval_s > 86_400 {
                    return Err("dbus intervalS must be 1..=86400".into());
                }
            }
            SourceKind::Mqtt {
                host,
                port,
                topic,
                username_secret,
                password_secret,
                ..
            } => {
                if host.trim().is_empty() || *port == 0 || topic.trim().is_empty() {
                    return Err("mqtt source requires host, non-zero port, and topic".into());
                }
                if let Some(u) = username_secret {
                    crate::secrets::validate_secret_name(u)?;
                }
                if let Some(p) = password_secret {
                    crate::secrets::validate_secret_name(p)?;
                }
            }
            SourceKind::Variable { .. } => {}
        }
        Ok(())
    }

    /// SHA-256 fingerprint over every security-relevant field of the source.
    /// Any edit to commands, paths, hosts, headers, D-Bus endpoints, or MQTT broker changes
    /// this fingerprint and forces re-approval for imported sources (PLAN-2 6.6).
    pub fn trust_fingerprint(&self) -> String {
        let mut h = Sha256::new();
        h.update(self.id.as_bytes());
        h.update([0]);
        match &self.kind {
            SourceKind::Command {
                argv,
                shell,
                env_allowlist,
                ..
            } => {
                h.update(b"command\0");
                h.update([u8::from(*shell)]);
                for arg in argv {
                    h.update(arg.as_bytes());
                    h.update([0]);
                }
                h.update(b"env\0");
                for env in env_allowlist {
                    h.update(env.as_bytes());
                    h.update([0]);
                }
            }
            SourceKind::File { path, .. } => {
                h.update(b"file\0");
                h.update(path.as_bytes());
            }
            SourceKind::Http {
                url,
                allow_local_http,
                headers,
                ..
            } => {
                h.update(b"http\0");
                h.update([u8::from(*allow_local_http)]);
                h.update(url.as_bytes());
                h.update([0]);
                for (k, v) in headers {
                    h.update(k.as_bytes());
                    h.update(b"=");
                    h.update(v.as_bytes());
                    h.update([0]);
                }
            }
            SourceKind::Dbus {
                bus,
                destination,
                path,
                interface,
                member,
                mode,
                ..
            } => {
                h.update(b"dbus\0");
                h.update(
                    format!("{bus:?}:{mode:?}:{destination}:{path}:{interface}.{member}")
                        .as_bytes(),
                );
            }
            SourceKind::Mqtt {
                host,
                port,
                tls,
                topic,
                username_secret,
                password_secret,
                ..
            } => {
                h.update(b"mqtt\0");
                h.update(
                    format!(
                        "{host}:{port}:{tls}:{topic}:{}:{}",
                        username_secret.as_deref().unwrap_or(""),
                        password_secret.as_deref().unwrap_or("")
                    )
                    .as_bytes(),
                );
            }
            SourceKind::Variable { persist, .. } => {
                h.update(b"variable\0");
                h.update([u8::from(*persist)]);
            }
        }
        hex::encode(h.finalize())
    }

    /// Plain-language summary of exact permissions shown in the Trust approval dialog (6.6).
    pub fn trust_summary(&self) -> String {
        match &self.kind {
            SourceKind::Command {
                argv,
                shell,
                env_allowlist,
                ..
            } => {
                let mode = if *shell {
                    "Runs via /bin/sh -c: "
                } else {
                    "Runs command: "
                };
                let env_note = if env_allowlist.is_empty() {
                    String::new()
                } else {
                    format!(" (env: {})", env_allowlist.join(", "))
                };
                format!("{mode}{}{env_note}", argv.join(" "))
            }
            SourceKind::File { path, .. } => format!("Reads file: {path}"),
            SourceKind::Http {
                url,
                allow_local_http,
                ..
            } => {
                let local = if *allow_local_http {
                    " (local HTTP opt-in)"
                } else {
                    ""
                };
                format!("HTTP request to: {url}{local}")
            }
            SourceKind::Dbus {
                bus,
                destination,
                path,
                interface,
                member,
                ..
            } => {
                let bus_str = match bus {
                    DbusBus::Session => "session",
                    DbusBus::System => "system (read-only)",
                };
                format!("D-Bus ({bus_str}): {destination} {path} {interface}.{member}")
            }
            SourceKind::Mqtt {
                host,
                port,
                tls,
                topic,
                ..
            } => {
                let proto = if *tls { "mqtts" } else { "mqtt" };
                format!("MQTT {proto}://{host}:{port} topic '{topic}'")
            }
            SourceKind::Variable { .. } => format!("Variable var.{}", self.id),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SourceState {
    Ok,
    Error,
    Waiting,
    NeedsApproval,
    Disabled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceLogEntry {
    pub at_ms: u64,
    pub level: String,
    pub message: String,
}

/// Live status surfaced in Settings → Data sources and the Builder (PLAN-2 6.1).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRuntimeStatus {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub topic: String,
    pub state: SourceState,
    pub enabled: bool,
    pub origin: SourceOrigin,
    pub trust_summary: String,
    pub trust_fingerprint: String,
    pub last_run_ms: Option<u64>,
    pub last_duration_us: Option<u64>,
    pub run_count: u64,
    pub error: Option<String>,
    pub logs: Vec<SourceLogEntry>,
}

/// Redacted per-source cost & health entry for `opaline --diagnose` and Settings → Diagnostics.
/// Contains NO URLs, paths, commands, headers, or secrets (brief §12, PLAN-2 6.1).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceDiagnoseEntry {
    pub kind: String,
    pub state: SourceState,
    pub imported: bool,
    pub last_duration_us: Option<u64>,
    pub run_count: u64,
}

/// Persistent record of one approved imported source (keyed by id + version + fingerprint).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustDecision {
    pub source_id: String,
    pub package_id: String,
    pub package_version: String,
    pub fingerprint: String,
    pub approved_at_ms: u64,
}

/// Disk-backed trust store (`~/.config/opaline/source-trust.json`, PLAN-2 6.6).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustStore {
    pub version: u32,
    #[serde(default)]
    pub approvals: BTreeMap<String, TrustDecision>,
}

impl TrustStore {
    pub fn load(path: &Path) -> Self {
        let Ok(bytes) = std::fs::read(path) else {
            return Self {
                version: 1,
                approvals: BTreeMap::new(),
            };
        };
        serde_json::from_slice(&bytes).unwrap_or_else(|_| Self {
            version: 1,
            approvals: BTreeMap::new(),
        })
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        let mut copy = self.clone();
        copy.version = 1;
        let bytes = serde_json::to_vec_pretty(&copy).map_err(|e| e.to_string())?;
        crate::watcher::write_atomic_tracked(path, &bytes).map_err(|e| e.to_string())
    }

    /// Returns `true` if `spec` is allowed to run (user-created sources are always trusted;
    /// imported sources require a matching `(package_id, package_version, fingerprint)` record).
    pub fn is_trusted(&self, spec: &SourceSpec) -> bool {
        match &spec.origin {
            SourceOrigin::User => true,
            SourceOrigin::Imported {
                package_id,
                package_version,
            } => {
                let fp = spec.trust_fingerprint();
                self.approvals.get(&spec.id).is_some_and(|d| {
                    d.package_id == *package_id
                        && d.package_version == *package_version
                        && d.fingerprint == fp
                })
            }
        }
    }

    pub fn approve(&mut self, spec: &SourceSpec, now_ms: u64) {
        if let SourceOrigin::Imported {
            package_id,
            package_version,
        } = &spec.origin
        {
            self.approvals.insert(
                spec.id.clone(),
                TrustDecision {
                    source_id: spec.id.clone(),
                    package_id: package_id.clone(),
                    package_version: package_version.clone(),
                    fingerprint: spec.trust_fingerprint(),
                    approved_at_ms: now_ms,
                },
            );
        }
    }

    pub fn revoke(&mut self, source_id: &str) {
        self.approvals.remove(source_id);
    }
}

/// Custom widget definition saved by the Widget Builder (`~/.config/opaline/widgets/<id>.json`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CustomWidgetPackage {
    #[serde(default, rename = "$schema", skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    #[serde(default = "default_widget_version")]
    pub version: u32,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_custom_category")]
    pub category: String,
    #[serde(default = "default_custom_icon")]
    pub icon: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "forkedFrom"
    )]
    pub forked_from: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "accessibleName"
    )]
    pub accessible_name: Option<String>,
    pub sizes: Vec<SizeClass>,
    pub default_size: SizeClass,
    #[serde(default)]
    pub topics: Vec<String>,
    pub composition: Composition,
}

fn default_custom_category() -> String {
    "custom".into()
}
fn default_custom_icon() -> String {
    "widgets".into()
}

impl CustomWidgetPackage {
    pub fn schema() -> serde_json::Value {
        serde_json::to_value(schema_for!(Self)).unwrap_or(serde_json::Value::Null)
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.version != CUSTOM_WIDGET_SCHEMA_VERSION {
            return Err(format!(
                "unsupported custom widget version {}",
                self.version
            ));
        }
        validate_id(&self.id)?;
        if self.name.trim().is_empty() || self.name.len() > 80 {
            return Err("widget name must be 1..=80 characters".into());
        }
        if self.sizes.is_empty() {
            return Err("custom widget must declare at least one size".into());
        }
        if !self.sizes.contains(&self.default_size) {
            return Err("defaultSize must be listed in sizes".into());
        }
        let problems = opaline_compose::validate(&self.composition);
        if let Some(first) = problems.first() {
            return Err(format!("invalid composition: {first}"));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    fn imported_cmd(argv: &[&str], version: &str) -> SourceSpec {
        SourceSpec {
            schema: None,
            version: 1,
            id: "pkg-uptime".into(),
            name: "Uptime".into(),
            description: None,
            enabled: true,
            origin: SourceOrigin::Imported {
                package_id: "cool-pack".into(),
                package_version: version.into(),
            },
            kind: SourceKind::Command {
                argv: argv.iter().map(|s| (*s).to_owned()).collect(),
                shell: false,
                interval_s: 10,
                timeout_ms: 2000,
                max_bytes: 4096,
                env_allowlist: Vec::new(),
                format: OutputFormat::Text,
                regex: None,
            },
        }
    }

    #[test]
    fn imported_source_stays_untrusted_until_approved_and_invalidates_on_change() {
        let mut trust = TrustStore::default();
        let src = imported_cmd(&["uptime", "-p"], "1.0.0");
        assert!(!trust.is_trusted(&src));

        // Approve v1.0.0 with exact argv.
        trust.approve(&src, 1000);
        assert!(trust.is_trusted(&src));

        // Changing command invalidates approval.
        let modified_cmd = imported_cmd(&["uptime", "-s"], "1.0.0");
        assert!(!trust.is_trusted(&modified_cmd));

        // Bumping package version invalidates approval even with same argv.
        let bumped_ver = imported_cmd(&["uptime", "-p"], "1.0.1");
        assert!(!trust.is_trusted(&bumped_ver));

        // User-created sources are trusted immediately.
        let mut user_src = src.clone();
        user_src.origin = SourceOrigin::User;
        assert!(trust.is_trusted(&user_src));
    }

    #[test]
    fn rejects_url_with_embedded_credentials() {
        let spec = SourceSpec {
            schema: None,
            version: 1,
            id: "bad-http".into(),
            name: "Bad".into(),
            description: None,
            enabled: true,
            origin: SourceOrigin::User,
            kind: SourceKind::Http {
                url: "https://user:secret@example.com/api".into(),
                allow_local_http: false,
                interval_s: 30,
                timeout_ms: 5000,
                max_bytes: 65536,
                headers: BTreeMap::new(),
                format: OutputFormat::Json,
                json_path: None,
            },
        };
        assert!(spec.validate().is_err());
    }
}

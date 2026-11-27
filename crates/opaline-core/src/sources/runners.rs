//! Execution runners for Command, File, HTTP/JSON, and D-Bus custom sources
//! (brief §4.4, PLAN-2 tasks 6.2 & 6.3).

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use opaline_ipc::Value;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use zbus::{Connection, OwnedVariant, Proxy, Variant};

use super::model::{DbusBus, OutputFormat};
use super::parsers::parse_payload;

/// Read-only allowlist of system-bus D-Bus services custom sources may query (PLAN-2 6.2).
pub const SYSTEM_BUS_ALLOWLIST: &[&str] = &[
    "org.freedesktop.UPower",
    "org.freedesktop.NetworkManager",
    "org.freedesktop.UDisks2",
    "org.freedesktop.hostname1",
    "org.freedesktop.timedate1",
    "org.freedesktop.systemd1",
    "net.hadess.PowerProfiles",
    "org.bluez",
];

const SAFE_DEFAULT_PATH: &str = "/usr/local/bin:/usr/bin:/bin";

/// Cached conditional-request validators for an HTTP source.
#[derive(Debug, Clone, Default)]
pub struct HttpCacheEntry {
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub last_value: Option<Value>,
}

/// Runs a Command source with cleared environment (+ allowlist), strict timeout, and output cap.
#[allow(clippy::too_many_arguments)]
pub async fn run_command(
    argv: &[String],
    shell: bool,
    timeout_ms: u64,
    max_bytes: usize,
    env_allowlist: &[String],
    format: OutputFormat,
    regex: Option<&str>,
) -> Result<Value, String> {
    if argv.is_empty() || argv[0].trim().is_empty() {
        return Err("empty command".into());
    }
    let mut cmd = if shell {
        let mut c = Command::new("/bin/sh");
        c.arg("-c").arg(argv.join(" "));
        c
    } else {
        let mut c = Command::new(&argv[0]);
        if argv.len() > 1 {
            c.args(&argv[1..]);
        }
        c
    };

    cmd.env_clear();
    cmd.env("PATH", SAFE_DEFAULT_PATH);
    for key in env_allowlist {
        if let Ok(val) = std::env::var(key) {
            cmd.env(key, val);
        }
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = cmd.spawn().map_err(|e| format!("spawn-failed: {e}"))?;
    let stdout = child.stdout.take().ok_or("missing stdout")?;
    let stderr = child.stderr.take().ok_or("missing stderr")?;

    let cap = max_bytes.clamp(64, 2 << 20);
    let timeout = Duration::from_millis(timeout_ms.clamp(100, 30_000));

    let read_fut = async {
        let mut out = Vec::new();
        let mut err = Vec::new();
        let mut out_reader = stdout.take((cap + 1) as u64);
        let mut err_reader = stderr.take(4096);
        let (o_res, e_res) = tokio::join!(
            out_reader.read_to_end(&mut out),
            err_reader.read_to_end(&mut err)
        );
        o_res.map_err(|e| format!("stdout-read-failed: {e}"))?;
        let _ = e_res;
        let status = child
            .wait()
            .await
            .map_err(|e| format!("wait-failed: {e}"))?;
        Ok::<_, String>((status, out, err))
    };

    let (status, mut out, err) = tokio::time::timeout(timeout, read_fut)
        .await
        .map_err(|_| format!("command timed out after {} ms", timeout.as_millis()))??;

    if !status.success() {
        let err_msg = String::from_utf8_lossy(&err);
        let trimmed = err_msg.trim();
        return Err(if trimmed.is_empty() {
            format!("command exited with {status}")
        } else {
            format!("command exited with {status}: {trimmed}")
        });
    }
    if out.len() > cap {
        out.truncate(cap);
    }
    parse_payload(&out, format, regex, None)
}

/// Expands a leading `~/` to `$HOME/`.
pub fn expand_user_path(raw: &str) -> PathBuf {
    if let Some(rest) = raw.strip_prefix("~/")
        && let Ok(home) = std::env::var("HOME")
    {
        return PathBuf::from(home).join(rest);
    }
    PathBuf::from(raw)
}

/// Reads and parses a File source up to `max_bytes`.
pub async fn run_file(
    raw_path: &str,
    max_bytes: usize,
    format: OutputFormat,
    json_path: Option<&str>,
) -> Result<Value, String> {
    let path = expand_user_path(raw_path);
    let cap = max_bytes.clamp(64, 2 << 20);
    let meta = tokio::fs::metadata(&path)
        .await
        .map_err(|e| format!("file-unavailable: {e}"))?;
    if !meta.is_file() {
        return Err("path is not a regular file".into());
    }
    if meta.len() > cap as u64 {
        return Err(format!("file exceeds {cap} byte limit"));
    }
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|e| format!("file-read-failed: {e}"))?;
    parse_payload(&bytes, format, None, json_path)
}

/// Runs an HTTP/JSON source with secret header substitution, SSRF pinning, and ETag caching.
#[allow(clippy::too_many_arguments)]
pub async fn run_http(
    url: &str,
    allow_local_http: bool,
    headers: &BTreeMap<String, String>,
    timeout_ms: u64,
    max_bytes: usize,
    format: OutputFormat,
    json_path: Option<&str>,
    cache: &mut HttpCacheEntry,
) -> Result<Value, String> {
    let mut resolved_headers = BTreeMap::new();
    let mut secret_values: Vec<String> = Vec::new();
    for (k, v) in headers {
        let names = crate::secrets::referenced_secrets(v);
        let mut resolved = v.clone();
        if !names.is_empty() {
            resolved = crate::secrets::resolve_template(v).await?;
            for name in &names {
                if let Ok(Some(sv)) = crate::secrets::get_secret(name).await {
                    secret_values.push(sv);
                }
            }
        }
        resolved_headers.insert(k.clone(), resolved);
    }
    let redact_refs: Vec<&str> = secret_values.iter().map(String::as_str).collect();

    let req = crate::http::CustomHttpRequest {
        url: url.to_owned(),
        allow_local_http,
        headers: resolved_headers,
        timeout_ms,
        max_bytes,
        etag: cache.etag.clone(),
        last_modified: cache.last_modified.clone(),
    };

    let resp = crate::http::fetch_custom(&req)
        .await
        .map_err(|e| crate::secrets::redact_text(&e, &redact_refs))?;

    match resp {
        crate::http::CustomHttpResponse::NotModified => cache
            .last_value
            .clone()
            .ok_or_else(|| "http-304-without-cached-value".to_owned()),
        crate::http::CustomHttpResponse::Ok {
            body,
            etag,
            last_modified,
            ..
        } => {
            let val = parse_payload(&body, format, None, json_path)
                .map_err(|e| crate::secrets::redact_text(&e, &redact_refs))?;
            cache.etag = etag;
            cache.last_modified = last_modified;
            cache.last_value = Some(val.clone());
            Ok(val)
        }
    }
}

/// Checks whether a system-bus D-Bus destination is on the read-only allowlist.
pub fn is_system_bus_allowed(destination: &str) -> bool {
    SYSTEM_BUS_ALLOWLIST
        .iter()
        .any(|allowed| destination == *allowed || destination.starts_with(&format!("{allowed}.")))
}

/// Reads a D-Bus property (session bus, or allowlisted read-only system bus).
pub async fn run_dbus_property(
    bus: DbusBus,
    destination: &str,
    path: &str,
    interface: &str,
    member: &str,
) -> Result<Value, String> {
    let conn = match bus {
        DbusBus::Session => Connection::session()
            .await
            .map_err(|e| format!("no-session-bus: {e}"))?,
        DbusBus::System => {
            if !is_system_bus_allowed(destination) {
                return Err(format!(
                    "system-bus destination '{destination}' is not in the read-only allowlist"
                ));
            }
            Connection::system()
                .await
                .map_err(|e| format!("no-system-bus: {e}"))?
        }
    };

    let proxy = Proxy::new(&conn, destination, path, interface)
        .await
        .map_err(|e| format!("dbus-proxy-failed: {e}"))?;
    let val: OwnedVariant = proxy
        .get_property(member)
        .await
        .map_err(|e| format!("dbus-get-property-failed: {e}"))?;
    Ok(zvariant_to_ipc(&val))
}

/// Converts any D-Bus `Variant` into an Opaline IPC [`Value`].
pub fn zvariant_to_ipc(val: &Variant<'_>) -> Value {
    match val {
        Variant::U8(n) => Value::Num(f64::from(*n)),
        Variant::Bool(b) => Value::Bool(*b),
        Variant::I16(n) => Value::Num(f64::from(*n)),
        Variant::U16(n) => Value::Num(f64::from(*n)),
        Variant::I32(n) => Value::Num(f64::from(*n)),
        Variant::U32(n) => Value::Num(f64::from(*n)),
        Variant::I64(n) => Value::Num(*n as f64),
        Variant::U64(n) => Value::Num(*n as f64),
        Variant::F64(n) => Value::Num(*n),
        Variant::Str(s) => Value::Text(s.as_str().to_owned()),
        Variant::ObjectPath(p) => Value::Text(p.as_str().to_owned()),
        Variant::Signature(s) => Value::Text(s.to_string()),
        Variant::Variant(inner) => zvariant_to_ipc(inner),
        Variant::Array(arr) => Value::List(arr.iter().map(zvariant_to_ipc).collect()),
        Variant::Structure(st) => Value::List(st.fields().iter().map(zvariant_to_ipc).collect()),
        Variant::Dict(dict) => {
            let mut map = BTreeMap::new();
            for (k, v) in dict.iter() {
                let key = match k {
                    Variant::Str(s) => s.as_str().to_owned(),
                    other => format!("{other:?}"),
                };
                map.insert(key, zvariant_to_ipc(v));
            }
            Value::Map(map)
        }
        Variant::Fd(_) => Value::Text("<fd>".into()),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::panic)]

    use super::*;

    #[tokio::test]
    async fn command_runs_argv_without_shell_and_clears_env() {
        // Direct argv: shell metacharacters are passed literally, never interpreted!
        let val = run_command(
            &["printf".into(), "%s".into(), "$(echo injected)".into()],
            false,
            3000,
            4096,
            &[],
            OutputFormat::Text,
            None,
        )
        .await
        .unwrap();
        assert_eq!(val, Value::Text("$(echo injected)".into()));

        // Env is cleared unless allowlisted.
        let env_out = run_command(
            &["printenv".into()],
            false,
            3000,
            4096,
            &[],
            OutputFormat::Lines,
            None,
        )
        .await
        .unwrap();
        let Value::List(lines) = env_out else {
            panic!("expected lines")
        };
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0], Value::Text(format!("PATH={SAFE_DEFAULT_PATH}")));
    }

    #[tokio::test]
    async fn file_runner_parses_markdown_and_rejects_oversized() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("todo.md");
        std::fs::write(&f, "# Tasks\n- [ ] Alpha\n- [x] Beta\n").unwrap();
        let val = run_file(f.to_str().unwrap(), 4096, OutputFormat::Markdown, None)
            .await
            .unwrap();
        let Value::Map(m) = val else {
            panic!("expected map")
        };
        assert_eq!(m.get("title"), Some(&Value::Text("Tasks".into())));
        assert_eq!(m.get("openCount"), Some(&Value::Num(1.0)));

        let big = dir.path().join("big.txt");
        std::fs::write(&big, "x".repeat(120)).unwrap();
        let too_big = run_file(big.to_str().unwrap(), 64, OutputFormat::Text, None).await;
        assert!(too_big.is_err());
    }

    #[test]
    fn system_dbus_allowlist_blocks_arbitrary_services() {
        assert!(is_system_bus_allowed("org.freedesktop.UPower"));
        assert!(is_system_bus_allowed("org.freedesktop.NetworkManager"));
        assert!(!is_system_bus_allowed("org.freedesktop.PolicyKit1"));
        assert!(!is_system_bus_allowed("com.evil.Service"));
    }
}

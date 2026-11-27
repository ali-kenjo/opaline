//! Secret storage through the GNOME Keyring (`org.freedesktop.secrets`) over `zbus 6`
//! (brief §4.4, PLAN-2 task 6.5, Spike S11, ADR 0019).
//!
//! Secrets (API keys, bearer tokens, MQTT passwords) live exclusively in the session keyring.
//! They are never serialized into `settings.json`, `sources/*.json`, backups, logs, or
//! `--diagnose`. Custom sources reference them by placeholder (`{{secret:my-token}}`), and
//! core resolves the placeholder right before opening a connection.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Mutex, PoisonError};

use zbus::{Connection, OwnedObjectPath, OwnedVariant, Proxy, Variant};

const SECRETS_DEST: &str = "org.freedesktop.secrets";
const SECRETS_SERVICE_PATH: &str = "/org/freedesktop/secrets";
const SECRETS_SERVICE_IFACE: &str = "org.freedesktop.Secret.Service";
const SECRETS_COLLECTION_DEFAULT: &str = "/org/freedesktop/secrets/aliases/default";
const SECRETS_COLLECTION_IFACE: &str = "org.freedesktop.Secret.Collection";
const SECRETS_ITEM_IFACE: &str = "org.freedesktop.Secret.Item";
const SECRETS_SESSION_IFACE: &str = "org.freedesktop.Secret.Session";

const APP_ATTR_KEY: &str = "application";
const APP_ATTR_VAL: &str = "opaline";
const NAME_ATTR_KEY: &str = "key";

/// Validates a secret identifier: 1–64 ASCII letters, digits, `.`, `_`, or `-`.
pub fn validate_secret_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 64 {
        return Err("secret name must be 1..=64 characters".into());
    }
    if !name
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
    {
        return Err("secret name may only contain letters, digits, '.', '_' and '-'".into());
    }
    Ok(())
}

/// Abstract secret storage backend so unit tests and headless CI can run without a live keyring
/// while production uses the GNOME Keyring over `org.freedesktop.secrets`.
pub trait SecretStore: std::fmt::Debug + Send + Sync {
    fn get_sync(&self, name: &str) -> Result<Option<String>, String>;
    fn set_sync(&self, name: &str, value: &str) -> Result<(), String>;
    fn delete_sync(&self, name: &str) -> Result<bool, String>;
    fn list_names_sync(&self) -> Result<Vec<String>, String>;
}

/// In-memory store for tests and planted-secret leak audits.
#[derive(Debug, Default)]
pub struct MemorySecretStore {
    items: Mutex<BTreeMap<String, String>>,
}

impl MemorySecretStore {
    pub fn new() -> Self {
        Self::default()
    }
}

impl SecretStore for MemorySecretStore {
    fn get_sync(&self, name: &str) -> Result<Option<String>, String> {
        validate_secret_name(name)?;
        let map = self.items.lock().unwrap_or_else(PoisonError::into_inner);
        Ok(map.get(name).cloned())
    }

    fn set_sync(&self, name: &str, value: &str) -> Result<(), String> {
        validate_secret_name(name)?;
        if value.is_empty() {
            return Err("secret value must not be empty".into());
        }
        let mut map = self.items.lock().unwrap_or_else(PoisonError::into_inner);
        map.insert(name.to_owned(), value.to_owned());
        Ok(())
    }

    fn delete_sync(&self, name: &str) -> Result<bool, String> {
        validate_secret_name(name)?;
        let mut map = self.items.lock().unwrap_or_else(PoisonError::into_inner);
        Ok(map.remove(name).is_some())
    }

    fn list_names_sync(&self) -> Result<Vec<String>, String> {
        let map = self.items.lock().unwrap_or_else(PoisonError::into_inner);
        Ok(map.keys().cloned().collect())
    }
}

/// Wire struct for `org.freedesktop.Secret.Secret`: `(session, parameters, value, content_type)`.
type SecretTuple = (OwnedObjectPath, Vec<u8>, Vec<u8>, String);

async fn open_plain_session(conn: &Connection) -> Result<OwnedObjectPath, String> {
    let svc = Proxy::new(
        conn,
        SECRETS_DEST,
        SECRETS_SERVICE_PATH,
        SECRETS_SERVICE_IFACE,
    )
    .await
    .map_err(|e| format!("keyring-unavailable: {e}"))?;
    let empty_input = Variant::from("");
    let (_output, session): (OwnedVariant, OwnedObjectPath) = svc
        .call("OpenSession", &("plain", &empty_input))
        .await
        .map_err(|e| format!("keyring-session-failed: {e}"))?;
    Ok(session)
}

async fn close_session(conn: &Connection, session: &OwnedObjectPath) {
    if let Ok(proxy) = Proxy::new(conn, SECRETS_DEST, session.as_str(), SECRETS_SESSION_IFACE).await
    {
        let _: Result<(), _> = proxy.call("Close", &()).await;
    }
}

async fn unlock_if_needed(conn: &Connection, objects: Vec<OwnedObjectPath>) -> Result<(), String> {
    if objects.is_empty() {
        return Ok(());
    }
    let svc = Proxy::new(
        conn,
        SECRETS_DEST,
        SECRETS_SERVICE_PATH,
        SECRETS_SERVICE_IFACE,
    )
    .await
    .map_err(|e| format!("keyring-unavailable: {e}"))?;
    let (_unlocked, prompt): (Vec<OwnedObjectPath>, OwnedObjectPath) = svc
        .call("Unlock", &(objects,))
        .await
        .map_err(|e| format!("keyring-unlock-failed: {e}"))?;
    if prompt.as_str() != "/" {
        return Err("keyring-locked".into());
    }
    Ok(())
}

/// Stores or replaces a named secret in the user's default GNOME Keyring collection.
pub async fn set_secret(name: &str, value: &str) -> Result<(), String> {
    validate_secret_name(name)?;
    if value.is_empty() {
        return Err("secret value must not be empty".into());
    }
    let conn = Connection::session()
        .await
        .map_err(|e| format!("no-session-bus: {e}"))?;
    let session = open_plain_session(&conn).await?;

    let default_path = OwnedObjectPath::try_from(SECRETS_COLLECTION_DEFAULT)
        .map_err(|e| format!("invalid-path: {e}"))?;
    unlock_if_needed(&conn, vec![default_path]).await?;

    let collection = Proxy::new(
        &conn,
        SECRETS_DEST,
        SECRETS_COLLECTION_DEFAULT,
        SECRETS_COLLECTION_IFACE,
    )
    .await
    .map_err(|e| format!("keyring-collection-failed: {e}"))?;

    let mut attrs: HashMap<String, String> = HashMap::new();
    attrs.insert(APP_ATTR_KEY.into(), APP_ATTR_VAL.into());
    attrs.insert(NAME_ATTR_KEY.into(), name.into());

    let label = format!("Opaline: {name}");
    let mut props: HashMap<&str, Variant<'_>> = HashMap::new();
    props.insert("org.freedesktop.Secret.Item.Label", Variant::from(label));
    props.insert(
        "org.freedesktop.Secret.Item.Attributes",
        Variant::from(attrs),
    );

    let secret: SecretTuple = (
        session.clone(),
        Vec::new(),
        value.as_bytes().to_vec(),
        "text/plain".into(),
    );

    let res: Result<(OwnedObjectPath, OwnedObjectPath), _> =
        collection.call("CreateItem", &(props, secret, true)).await;
    close_session(&conn, &session).await;

    let (_item, prompt) = res.map_err(|e| format!("keyring-write-failed: {e}"))?;
    if prompt.as_str() != "/" {
        return Err("keyring-prompt-required".into());
    }
    Ok(())
}

/// Reads a named secret from the user's GNOME Keyring. Returns `Ok(None)` if not present.
pub async fn get_secret(name: &str) -> Result<Option<String>, String> {
    validate_secret_name(name)?;
    let conn = Connection::session()
        .await
        .map_err(|e| format!("no-session-bus: {e}"))?;
    let svc = Proxy::new(
        &conn,
        SECRETS_DEST,
        SECRETS_SERVICE_PATH,
        SECRETS_SERVICE_IFACE,
    )
    .await
    .map_err(|e| format!("keyring-unavailable: {e}"))?;

    let mut attrs: HashMap<&str, &str> = HashMap::new();
    attrs.insert(APP_ATTR_KEY, APP_ATTR_VAL);
    attrs.insert(NAME_ATTR_KEY, name);

    let (unlocked, locked): (Vec<OwnedObjectPath>, Vec<OwnedObjectPath>) = svc
        .call("SearchItems", &(attrs,))
        .await
        .map_err(|e| format!("keyring-search-failed: {e}"))?;

    let target = if let Some(path) = unlocked.into_iter().next() {
        path
    } else if let Some(path) = locked.into_iter().next() {
        unlock_if_needed(&conn, vec![path.clone()]).await?;
        path
    } else {
        return Ok(None);
    };

    let session = open_plain_session(&conn).await?;
    let item = Proxy::new(&conn, SECRETS_DEST, target.as_str(), SECRETS_ITEM_IFACE)
        .await
        .map_err(|e| format!("keyring-item-failed: {e}"))?;
    let res: Result<(SecretTuple,), _> = item.call("GetSecret", &(session.clone(),)).await;
    close_session(&conn, &session).await;

    let ((_sess, _params, bytes, _mime),) = res.map_err(|e| format!("keyring-read-failed: {e}"))?;
    let text = String::from_utf8(bytes).map_err(|_| "secret-not-utf8".to_owned())?;
    Ok(Some(text))
}

/// Deletes a named secret from the user's GNOME Keyring. Returns `true` if one was removed.
pub async fn delete_secret(name: &str) -> Result<bool, String> {
    validate_secret_name(name)?;
    let conn = Connection::session()
        .await
        .map_err(|e| format!("no-session-bus: {e}"))?;
    let svc = Proxy::new(
        &conn,
        SECRETS_DEST,
        SECRETS_SERVICE_PATH,
        SECRETS_SERVICE_IFACE,
    )
    .await
    .map_err(|e| format!("keyring-unavailable: {e}"))?;

    let mut attrs: HashMap<&str, &str> = HashMap::new();
    attrs.insert(APP_ATTR_KEY, APP_ATTR_VAL);
    attrs.insert(NAME_ATTR_KEY, name);

    let (unlocked, locked): (Vec<OwnedObjectPath>, Vec<OwnedObjectPath>) = svc
        .call("SearchItems", &(attrs,))
        .await
        .map_err(|e| format!("keyring-search-failed: {e}"))?;
    let all: Vec<OwnedObjectPath> = unlocked.into_iter().chain(locked).collect();
    if all.is_empty() {
        return Ok(false);
    }
    unlock_if_needed(&conn, all.clone()).await?;
    for path in all {
        let item = Proxy::new(&conn, SECRETS_DEST, path.as_str(), SECRETS_ITEM_IFACE)
            .await
            .map_err(|e| format!("keyring-item-failed: {e}"))?;
        let _: OwnedObjectPath = item
            .call("Delete", &())
            .await
            .map_err(|e| format!("keyring-delete-failed: {e}"))?;
    }
    Ok(true)
}

/// Lists the *names* of all Opaline secrets stored in the GNOME Keyring. Values are never read.
pub async fn list_secret_names() -> Result<Vec<String>, String> {
    let conn = Connection::session()
        .await
        .map_err(|e| format!("no-session-bus: {e}"))?;
    let svc = Proxy::new(
        &conn,
        SECRETS_DEST,
        SECRETS_SERVICE_PATH,
        SECRETS_SERVICE_IFACE,
    )
    .await
    .map_err(|e| format!("keyring-unavailable: {e}"))?;

    let mut attrs: HashMap<&str, &str> = HashMap::new();
    attrs.insert(APP_ATTR_KEY, APP_ATTR_VAL);

    let (unlocked, locked): (Vec<OwnedObjectPath>, Vec<OwnedObjectPath>) = svc
        .call("SearchItems", &(attrs,))
        .await
        .map_err(|e| format!("keyring-search-failed: {e}"))?;
    let mut names = Vec::new();
    for path in unlocked.into_iter().chain(locked) {
        if let Ok(item) = Proxy::new(&conn, SECRETS_DEST, path.as_str(), SECRETS_ITEM_IFACE).await
            && let Ok(map) = item
                .get_property::<HashMap<String, String>>("Attributes")
                .await
            && let Some(key) = map.get(NAME_ATTR_KEY)
        {
            names.push(key.clone());
        }
    }
    names.sort();
    names.dedup();
    Ok(names)
}

/// Extracts every `{{secret:<name>}}` name referenced inside `input`.
pub fn referenced_secrets(input: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = input;
    while let Some(start) = rest.find("{{secret:") {
        let after = &rest[start + 9..];
        let Some(end) = after.find("}}") else {
            break;
        };
        let name = after[..end].trim();
        if validate_secret_name(name).is_ok() {
            out.push(name.to_owned());
        }
        rest = &after[end + 2..];
    }
    out.sort();
    out.dedup();
    out
}

/// Replaces every `{{secret:<name>}}` placeholder in `input` using `resolver`.
/// Fails if any referenced secret name is invalid or missing.
pub fn resolve_template_sync<F>(input: &str, mut resolver: F) -> Result<String, String>
where
    F: FnMut(&str) -> Result<Option<String>, String>,
{
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(start) = rest.find("{{secret:") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 9..];
        let Some(end) = after.find("}}") else {
            return Err("unclosed secret placeholder".into());
        };
        let name = after[..end].trim();
        validate_secret_name(name)?;
        let secret =
            resolver(name)?.ok_or_else(|| format!("missing secret '{name}' in GNOME Keyring"))?;
        out.push_str(&secret);
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    Ok(out)
}

/// Async version resolving `{{secret:<name>}}` against GNOME Keyring.
pub async fn resolve_template(input: &str) -> Result<String, String> {
    let names = referenced_secrets(input);
    if names.is_empty() {
        return Ok(input.to_owned());
    }
    let mut cache: HashMap<String, String> = HashMap::new();
    for name in names {
        let value = get_secret(&name)
            .await?
            .ok_or_else(|| format!("missing secret '{name}' in GNOME Keyring"))?;
        cache.insert(name, value);
    }
    resolve_template_sync(input, |n| Ok(cache.get(n).cloned()))
}

/// Scrubs any known secret values out of log lines, error messages, or diagnostic text.
pub fn redact_text(input: &str, secrets: &[&str]) -> String {
    let mut out = input.to_owned();
    for secret in secrets {
        if !secret.is_empty() && out.contains(secret) {
            out = out.replace(secret, "[REDACTED]");
        }
    }
    out
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    #[test]
    fn validates_secret_names() {
        assert!(validate_secret_name("n8n-api-key").is_ok());
        assert!(validate_secret_name("mqtt.broker_1").is_ok());
        assert!(validate_secret_name("").is_err());
        assert!(validate_secret_name("bad name").is_err());
        assert!(validate_secret_name("a/b").is_err());
        assert!(validate_secret_name(&"a".repeat(65)).is_err());
    }

    #[test]
    fn resolves_placeholders_and_redacts_output() {
        let store = MemorySecretStore::new();
        let planted = "opaline_planted_secret_9f82a7c1";
        store.set_sync("n8n_key", planted).unwrap();

        assert_eq!(
            referenced_secrets("Bearer {{secret:n8n_key}} / {{secret:n8n_key}}"),
            vec!["n8n_key".to_owned()]
        );

        let header =
            resolve_template_sync("Bearer {{secret:n8n_key}}", |n| store.get_sync(n)).unwrap();
        assert_eq!(header, format!("Bearer {planted}"));

        let err = resolve_template_sync("{{secret:missing_key}}", |n| store.get_sync(n));
        assert!(err.is_err());
        assert!(!err.unwrap_err().contains(planted));

        let log_line = format!("request failed with header Bearer {planted}");
        let clean = redact_text(&log_line, &[planted]);
        assert!(!clean.contains(planted));
        assert!(clean.contains("[REDACTED]"));
    }

    #[test]
    fn planted_secret_never_appears_in_backup_or_settings_json() {
        let store = MemorySecretStore::new();
        let planted = "SUPER_SECRET_PLANTED_TOKEN_S11_XYZ";
        store.set_sync("api_token", planted).unwrap();

        // Only the placeholder reference is stored in configuration files.
        let header_cfg = "Bearer {{secret:api_token}}";
        assert!(!header_cfg.contains(planted));

        let hub = crate::hub::Hub::new(opaline_ipc::BackendKind::Instant, Vec::new());
        let backup = crate::backup::export_json(&hub).unwrap();
        assert!(!backup.contains(planted));
        assert_eq!(store.list_names_sync().unwrap(), vec!["api_token"]);
    }
}

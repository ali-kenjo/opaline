# ADR 0019: Secret Storage, SSRF Defense, and Custom Source Trust

- **Status:** Accepted (2026-11-27)
- **Context:** Opaline 2.0 Phase 6 (Spike S11, brief §4.4–4.5, PLAN-2 tasks 6.1–6.6)

## Decision

### 1. Secret Storage (Spike S11)
Opaline talks directly to the Freedesktop Secret Service (`org.freedesktop.secrets`, GNOME Keyring)
over the workspace's existing **`zbus 6`** dependency (`crates/opaline-core/src/secrets.rs`), rather
than adding `oo7` (which lags behind `zbus 6` and would pull a duplicate `zbus 5` + crypto stack).

- Items live in `/org/freedesktop/secrets/aliases/default` with attributes
  `{ "application": "opaline", "key": "<name>" }` and label `"Opaline: <name>"`.
- Secret values are **never** written to `settings.json`, `sources/*.json`, `backup::export_json`,
  logs, `SourceStatus`, or `opaline --diagnose`.
- Custom sources reference secrets exclusively via `{{secret:<name>}}` placeholders (for HTTP
  headers and MQTT credentials); core resolves them in memory right before opening a connection,
  and scrubs resolved values from error messages via `redact_text`.
- Automated tests plant a sentinel token and verify it never appears in config, backups, diagnostics,
  or error output.

### 2. HTTP/JSON SSRF Defense & DNS Pinning
Custom HTTP sources extend `crates/opaline-core/src/http.rs` (`fetch_custom`):
- **HTTPS by default.** Plain `http://` is permitted **only** when `allowLocalHttp: true` is
  explicitly set on the source **and** every resolved IP is loopback (`127.0.0.0/8`, `::1`) or
  private LAN (RFC 1918 / IPv6 ULA). Public internet hosts over plain `http://` are always rejected.
- **Link-local & cloud metadata always blocked** (`169.254.0.0/16`, `fe80::/10`,
  `100.100.100.200`, `100.64.0.0/10`, `fd00:ec2::254`, `0.0.0.0/8`, `::`, multicast, broadcast,
  and IPv4-mapped IPv6 forms like `::ffff:169.254.169.254`) — checked **after DNS resolution**.
- **DNS pinning**: every resolved `SocketAddr` is validated before connecting, and the first valid
  address is pinned via `reqwest::Client::builder().resolve(host, pinned_addr)` with automatic
  redirects disabled (redirects are followed manually up to 3 hops, re-validating every hop).
  This eliminates DNS-rebinding TOCTOU attacks.
- Credentials embedded in URLs (`https://user:pass@host`) are rejected; secrets must use
  `{{secret:...}}` headers.

### 3. Imported Source Trust Model
- Sources created locally by the user (`origin: "user"`) run immediately.
- Sources arriving from an imported package (`origin: { "imported": { packageId, packageVersion } }`)
  start in **`needs-approval`** and never execute until explicitly approved by the user.
- Core computes a SHA-256 **trust fingerprint** over the source's security-relevant fields (exact
  `argv` + `shell` + `envAllowlist`, file `path`, HTTP `url` + `allowLocalHttp` + header keys,
  D-Bus `bus`/`destination`/`path`/`interface`/`member`, MQTT `host`/`port`/`tls`/`topic`).
- Approvals are stored in `~/.config/opaline/source-trust.json` keyed by `(source_id, package_version,
  fingerprint)`. Any change to the package version or any security-relevant field invalidates the
  approval and returns the source to `needs-approval`.

## Consequences
- Zero extra D-Bus or crypto crate versions; binary size and compile time stay small.
- Works offline in CI and unit tests via `MemorySecretStore` while using real GNOME Keyring at runtime.
- `opaline --safe-mode` disables all custom sources cleanly at startup.

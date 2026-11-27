# Opaline 2.0 Security Review & Threat Model

Updated: 2026-11-27 (Opaline 2.0, Phase 10)

This document covers Opaline's threat model and automated security controls across every trust boundary specified in `OPALINE_2_BRIEF.md` §12, `docs/ARCHITECTURE.md` §7, ADR 0014, ADR 0016, and ADR 0019.

---

## 1. Threat Model & Trust Boundaries

| Attack Surface | Threat | Controls & Enforcement | Automated Tests |
| - | - | - | - |
| **Layer Webviews** | Compromise via untrusted data or navigation | Strict CSP (`default-src 'self'`, `connect-src ipc: http://ipc.localhost`, `object-src 'none'`, `frame-ancestors 'none'`), `freezePrototype: true`, `withGlobalTauri: false`, minimal `layer.json` capabilities, main-frame navigation guard (`is_allowed_layer_navigation`, ADR 0014) | `layer::plugin_scheme::tests::navigation_guard_allows_only_layer_origins` |
| **Code Plugins (`.opaline-plugin`)** | Arbitrary JS trying to reach Tauri IPC, network, other widgets, storage, DOM, or infinite CPU/RAM loops | Dedicated Web Worker under `opaline-plugin://<id>/` with response CSP (`default-src 'none'; script-src 'self'; worker-src 'self' blob:; connect-src 'self'; frame-ancestors tauri://localhost`), `<iframe sandbox="allow-scripts allow-same-origin">`, strict `event.source` + origin checks, manifest-only topic filtering, allow-listed commands, 2 s heartbeat watchdog + exponential backoff, SHA-256 fingerprint approval on install & every change, disabled in `--safe-mode` | `app/src/plugins/hostile.test.ts` (6 tests), `layer::plugin_scheme::tests`, `plugins::tests` |
| **Imported Packages (`.opaline-theme`, `.opaline-rice`, `.opaline-plugin`)** | Zip-slip path traversal, zip bombs, corrupt archives, remote CSS exfiltration (`@import` / `url(https://...)`), oversized files | Pure-Rust bounded ZIP reader (`zip_pkg.rs`): rejects `..`, absolute paths, backslashes, NUL bytes, symlinks, CRC-32 mismatches, > 16 MiB archives, > 256 entries, > 100× expansion ratio. CSS validator rejects `@import`, `url(http/https/data/javascript)`, `expression()`, `-moz-binding`. | `crates/opaline-core/tests/security.rs`, `zip_pkg::tests`, `css::tests` |
| **Custom Data Sources (Command, File, HTTP/JSON, D-Bus, MQTT)** | Command injection, SSRF to cloud metadata / link-local, path/size DoS, unauthorized system D-Bus access, untrusted imported sources | Command sources run `argv` directly without shell by default with cleared environment (`env_clear()` + allow-list) and timeout/byte caps. HTTP/JSON sources enforce HTTPS-only (loopback opt-in), pinned DNS resolution blocking `169.254.0.0/16`, `fe80::/10`, `fd00:ec2::254`, `100.64.0.0/10`, and redirect re-checks. System D-Bus requires an explicit read-only service allowlist. Imported sources stay disabled until explicitly approved per `(id, version, SHA-256 fingerprint)`. | `crates/opaline-core/tests/security.rs`, `http::tests`, `sources::runners::tests`, `sources::model::tests`, `sources::mqtt::tests` |
| **Secret Storage (GNOME Keyring, ADR 0019)** | Secrets leaking into `settings.json`, backups, `.opaline-rice`, logs, error strings, or `--diagnose` | Stored exclusively in `org.freedesktop.secrets` over `zbus 6` (`secrets.rs`), referenced only as `{{secret:name}}` placeholders resolved in memory immediately before outbound requests, never echoed by Settings or backups, and scrubbed from logs/diagnostics. | `secrets::tests::planted_secret_never_appears_in_backup_or_settings_json`, `crates/opaline-core/tests/security.rs` |
| **Feed / Content Rendering** | XSS / HTML injection via untrusted RSS/Atom/JSON Feeds or Markdown notes | Feeds parsed in pure Rust and strictly stripped of all HTML tags, scripts, and styles before crossing IPC (`providers/integrations.rs`); webviews render plain text only (zero `dangerouslySetInnerHTML`). | `providers::integrations::tests` |
| **Quick Controls & Privileged Writes (ADR 0016)** | Arbitrary command/file execution or spoofing | Core validates every toggle, slider range, launcher target (`.desktop` / `http(s)` / existing path), process UID + `/proc/<pid>/stat` start time (`EndTask`), and live drive/container/entity allow-lists before acting. Privileged RAPL helper is strictly read-only, polkit-gated to active local sessions, and rate-limited. | `providers::controls::tests`, `opaline-privileged` tests |
| **Local IPC & D-Bus API v2** | Cross-user IPC hijacking or malformed scripted D-Bus arguments | `$XDG_RUNTIME_DIR/opaline/` (`0700`), `ipc.sock` (`0600`), `SO_PEERCRED` UID check, bounded MessagePack framing. D-Bus `io.github.ali_kenjo.Opaline1` validates every JSON path, grid coordinate, widget kind, look enum, and profile/variable id before mutating state. | `opaline-ipc` tests, `app_service::tests`, `crates/opaline-core/tests/security.rs` |
| **Updates & Community Gallery** | MITM, unsigned or tampered `.deb` / gallery packages | HTTPS-only downloads. Both updater (`updates.rs`) and gallery (`gallery.rs`) verify SHA-256 **and** minisign Ed25519/BLAKE2b-512 signatures fail-closed before extracting or invoking `pkexec apt install`. Gallery connects **only** when explicitly clicked (zero background traffic). | `updates::tests`, `gallery::tests` |

---

## 2. Diagnostic & Log Redaction

`opaline --diagnose` and **Settings → Diagnostics → Copy debug report** strip:
- All topic values (SSIDs, IP addresses, calendar titles, notes, media titles, process names),
- Monitor hardware serial numbers (`serial_present: bool` only),
- Custom source commands, URLs, hostnames, file paths, and tokens (`SourceDiagnoseEntry` reports only kind, state, and timing),
- Any `${secret:...}` values via `secrets::redact()`.

---

## 3. Safe Mode Recovery

Launching `opaline --safe-mode` — or crashing twice in a row during startup (tracked via `~/.local/state/opaline/startup-crashes`) — automatically disables user CSS, theme CSS, custom data sources, and code plugins so a broken or hostile package can never lock a user out of their desktop.

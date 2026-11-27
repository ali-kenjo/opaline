//! The one HTTP client core uses (weather, album art, public IP, update checks, and Phase 6
//! custom HTTP/JSON sources). Webviews never load remote content; core fetches with limits,
//! SSRF protection, pinned DNS resolution, and caches (ARCHITECTURE §7, brief §4.4, PLAN-2 6.3).

use std::collections::BTreeMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::OnceLock;
use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderName, HeaderValue, IF_MODIFIED_SINCE, IF_NONE_MATCH};
use url::Url;

const TIMEOUT: Duration = Duration::from_secs(10);
const MAX_CUSTOM_TIMEOUT_MS: u64 = 30_000;
const MAX_CUSTOM_BYTES: usize = 2 << 20;
const MAX_REDIRECTS: usize = 3;

/// A shared client for built-in https endpoints (weather, updates, art): rustls with the
/// system's certificate store, a generic user agent (no personal data), and a 10 s timeout.
pub fn client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .user_agent(concat!("Opaline/", env!("CARGO_PKG_VERSION")))
                .timeout(TIMEOUT)
                .build()
                .map_err(|e| e.to_string())
        })
        .as_ref()
        .map_err(Clone::clone)
}

/// Downloads `url` (https only) if its content type starts with one of `types`, reading at most
/// `max_bytes`. Returns the body and the content type.
pub async fn fetch_limited(
    url: &str,
    max_bytes: usize,
    types: &[&str],
) -> Result<(Vec<u8>, String), String> {
    if !url.starts_with("https://") {
        return Err("only https is allowed".into());
    }
    let mut response = client()?.get(url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_owned();
    if !types.iter().any(|t| content_type.starts_with(t)) {
        return Err(format!("unexpected content type {content_type:?}"));
    }
    if response
        .content_length()
        .is_some_and(|len| len > max_bytes as u64)
    {
        return Err("too large".into());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if body.len() + chunk.len() > max_bytes {
            return Err("too large".into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok((body, content_type))
}

/// Fetches JSON from an https URL (at most 2 MB).
pub async fn get_json(url: &str) -> Result<serde_json::Value, String> {
    let (body, _) = fetch_limited(url, 2 << 20, &["application/json", "text/json"]).await?;
    serde_json::from_slice(&body).map_err(|e| e.to_string())
}

/// Returns `true` if `ip` is loopback or private LAN (RFC 1918 / IPv6 ULA), excluding
/// cloud-metadata addresses.
pub fn is_loopback_or_private_lan(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_loopback() || v4.is_private(),
        IpAddr::V6(v6) => {
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return mapped.is_loopback() || mapped.is_private();
            }
            if v6.is_loopback() {
                return true;
            }
            // Unique Local Address fc00::/7, explicitly excluding AWS EC2 metadata fd00:ec2::254.
            let segs = v6.segments();
            let is_ula = (segs[0] & 0xfe00) == 0xfc00;
            let is_aws_v6_meta = v6 == Ipv6Addr::new(0xfd00, 0x0ec2, 0, 0, 0, 0, 0, 0x0254);
            is_ula && !is_aws_v6_meta
        }
    }
}

/// Returns `true` if `ip` is ALWAYS blocked for SSRF defense (link-local, cloud metadata,
/// unspecified, broadcast, multicast, or IPv4-mapped versions thereof).
pub fn is_always_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_always_blocked_v4(v4),
        IpAddr::V6(v6) => {
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return is_always_blocked_v4(mapped);
            }
            let segs = v6.segments();
            let is_link_local = (segs[0] & 0xffc0) == 0xfe80;
            let is_aws_v6_meta = v6 == Ipv6Addr::new(0xfd00, 0x0ec2, 0, 0, 0, 0, 0, 0x0254);
            v6.is_unspecified() || v6.is_multicast() || is_link_local || is_aws_v6_meta
        }
    }
}

fn is_always_blocked_v4(v4: Ipv4Addr) -> bool {
    let octets = v4.octets();
    let is_cgnat = octets[0] == 100 && (64..=127).contains(&octets[1]);
    let is_alibaba_meta = octets == [100, 100, 100, 200];
    let is_this_net = octets[0] == 0;
    v4.is_link_local()
        || v4.is_unspecified()
        || v4.is_broadcast()
        || v4.is_multicast()
        || is_this_net
        || is_cgnat
        || is_alibaba_meta
}

/// Validates a resolved `IpAddr` against scheme (`https` vs `http`) and `allow_local_http`.
pub fn validate_resolved_ip(
    scheme: &str,
    ip: IpAddr,
    allow_local_http: bool,
) -> Result<(), String> {
    if is_always_blocked_ip(ip) {
        return Err(format!("blocked-address: {ip} is link-local or metadata"));
    }
    match scheme {
        "https" => Ok(()),
        "http" => {
            if !allow_local_http {
                return Err(
                    "plain-http-disabled: enable allowLocalHttp for local endpoints".into(),
                );
            }
            if !is_loopback_or_private_lan(ip) {
                return Err(format!(
                    "plain-http-public-blocked: {ip} is not loopback or private LAN"
                ));
            }
            Ok(())
        }
        other => Err(format!("unsupported-scheme: {other}")),
    }
}

/// Resolves `host:port`, checks EVERY returned IP against the SSRF policy, and returns the first
/// validated `SocketAddr` for DNS pinning.
pub async fn resolve_and_validate(
    scheme: &str,
    host: &str,
    port: u16,
    allow_local_http: bool,
) -> Result<SocketAddr, String> {
    if let Ok(ip) = host
        .trim_matches(|c| c == '[' || c == ']')
        .parse::<IpAddr>()
    {
        validate_resolved_ip(scheme, ip, allow_local_http)?;
        return Ok(SocketAddr::new(ip, port));
    }
    let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host, port))
        .await
        .map_err(|e| format!("dns-resolve-failed: {e}"))?
        .collect();
    if addrs.is_empty() {
        return Err("dns-no-addresses".into());
    }
    // Check EVERY returned IP so a split-horizon / rebinding record can never smuggle a blocked IP.
    for addr in &addrs {
        validate_resolved_ip(scheme, addr.ip(), allow_local_http)?;
    }
    Ok(addrs[0])
}

/// Options for a custom HTTP/JSON source fetch (PLAN-2 6.3).
#[derive(Debug, Clone)]
pub struct CustomHttpRequest {
    pub url: String,
    pub allow_local_http: bool,
    pub headers: BTreeMap<String, String>,
    pub timeout_ms: u64,
    pub max_bytes: usize,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}

/// Result of a custom HTTP/JSON source fetch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CustomHttpResponse {
    NotModified,
    Ok {
        body: Vec<u8>,
        content_type: String,
        etag: Option<String>,
        last_modified: Option<String>,
    },
}

/// Performs an SSRF-hardened HTTP(S) GET with post-DNS IP checks, pinned `SocketAddr`
/// resolution (preventing DNS rebinding), validated redirect hops, conditional `ETag` /
/// `If-Modified-Since` caching, custom headers, and strict byte/time bounds.
pub async fn fetch_custom(req: &CustomHttpRequest) -> Result<CustomHttpResponse, String> {
    let timeout = Duration::from_millis(req.timeout_ms.clamp(500, MAX_CUSTOM_TIMEOUT_MS));
    let max_bytes = req.max_bytes.clamp(1024, MAX_CUSTOM_BYTES);

    let mut current_url = Url::parse(&req.url).map_err(|e| format!("invalid-url: {e}"))?;

    for hop in 0..=MAX_REDIRECTS {
        let scheme = current_url.scheme();
        if scheme != "https" && scheme != "http" {
            return Err(format!("unsupported-scheme: {scheme}"));
        }
        if !current_url.username().is_empty() || current_url.password().is_some() {
            return Err("credentials-in-url-forbidden: store secrets in GNOME Keyring".into());
        }
        let host = current_url
            .host_str()
            .ok_or_else(|| "url-missing-host".to_owned())?
            .to_owned();
        let port = current_url
            .port_or_known_default()
            .ok_or_else(|| "url-missing-port".to_owned())?;

        // Check every resolved IP after DNS lookup and pin the connection to the validated address.
        let pinned = resolve_and_validate(scheme, &host, port, req.allow_local_http).await?;

        let pinned_client = reqwest::Client::builder()
            .user_agent(concat!("Opaline/", env!("CARGO_PKG_VERSION")))
            .timeout(timeout)
            .redirect(reqwest::redirect::Policy::none())
            .resolve(&host, pinned)
            .build()
            .map_err(|e| format!("http-client-error: {e}"))?;

        let mut hdrs = HeaderMap::new();
        for (k, v) in &req.headers {
            let name = HeaderName::from_bytes(k.as_bytes())
                .map_err(|_| format!("invalid-header-name: {k}"))?;
            let val =
                HeaderValue::from_str(v).map_err(|_| format!("invalid-header-value for {k}"))?;
            hdrs.insert(name, val);
        }
        if let Some(etag) = &req.etag
            && let Ok(val) = HeaderValue::from_str(etag)
        {
            hdrs.insert(IF_NONE_MATCH, val);
        }
        if let Some(lm) = &req.last_modified
            && let Ok(val) = HeaderValue::from_str(lm)
        {
            hdrs.insert(IF_MODIFIED_SINCE, val);
        }

        let mut response = pinned_client
            .get(current_url.as_str())
            .headers(hdrs)
            .send()
            .await
            .map_err(|e| format!("http-request-failed: {e}"))?;

        if response.status() == reqwest::StatusCode::NOT_MODIFIED {
            return Ok(CustomHttpResponse::NotModified);
        }

        if response.status().is_redirection() {
            if hop == MAX_REDIRECTS {
                return Err("too-many-redirects".into());
            }
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| "redirect-missing-location".to_owned())?;
            current_url = current_url
                .join(location)
                .map_err(|e| format!("invalid-redirect-url: {e}"))?;
            continue;
        }

        if !response.status().is_success() {
            return Err(format!("HTTP {}", response.status()));
        }
        if response
            .content_length()
            .is_some_and(|len| len > max_bytes as u64)
        {
            return Err("response-too-large".into());
        }

        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_owned();
        let etag = response
            .headers()
            .get(reqwest::header::ETAG)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);
        let last_modified = response
            .headers()
            .get(reqwest::header::LAST_MODIFIED)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);

        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
            if body.len() + chunk.len() > max_bytes {
                return Err("response-too-large".into());
            }
            body.extend_from_slice(&chunk);
        }

        return Ok(CustomHttpResponse::Ok {
            body,
            content_type,
            etag,
            last_modified,
        });
    }

    Err("too-many-redirects".into())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::panic)]

    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    use super::*;

    #[tokio::test]
    async fn plain_http_is_refused() {
        assert_eq!(
            fetch_limited("http://example.com/a.png", 10, &["image/"]).await,
            Err("only https is allowed".into())
        );
        assert!(
            fetch_limited("file:///etc/passwd", 10, &["image/"])
                .await
                .is_err()
        );
    }

    #[test]
    fn ssrf_policy_blocks_metadata_link_local_and_public_http() {
        // Cloud metadata & link-local ALWAYS blocked, even over https and even with allow_local_http.
        let blocked = [
            "169.254.169.254",
            "169.254.0.1",
            "100.100.100.200",
            "0.0.0.0",
            "224.0.0.1",
            "fe80::1",
            "fd00:ec2::254",
            "::ffff:169.254.169.254",
            "::",
        ];
        for s in blocked {
            let ip: IpAddr = s.parse().unwrap();
            assert!(
                validate_resolved_ip("https", ip, true).is_err(),
                "{s} must be blocked over https"
            );
            assert!(
                validate_resolved_ip("http", ip, true).is_err(),
                "{s} must be blocked over http"
            );
        }

        // Public IP over plain http is always rejected, even when allow_local_http is true.
        let pub_ip: IpAddr = "93.184.216.34".parse().unwrap();
        assert!(validate_resolved_ip("http", pub_ip, true).is_err());
        assert!(validate_resolved_ip("https", pub_ip, false).is_ok());

        // Loopback & private LAN over http require explicit allow_local_http = true.
        let local_ips = [
            "127.0.0.1",
            "::1",
            "192.168.1.50",
            "10.0.0.8",
            "fd12:3456::1",
        ];
        for s in local_ips {
            let ip: IpAddr = s.parse().unwrap();
            assert!(validate_resolved_ip("http", ip, false).is_err());
            assert!(validate_resolved_ip("http", ip, true).is_ok());
        }
    }

    #[tokio::test]
    async fn custom_http_supports_loopback_opt_in_and_etag_304() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let server = tokio::spawn(async move {
            for _ in 0..2 {
                let (mut sock, _) = listener.accept().await.unwrap();
                let mut buf = [0u8; 2048];
                let n = sock.read(&mut buf).await.unwrap();
                let req = String::from_utf8_lossy(&buf[..n]);
                if req.to_ascii_lowercase().contains("if-none-match: \"v1\"") {
                    let _ = sock
                        .write_all(b"HTTP/1.1 304 Not Modified\r\nETag: \"v1\"\r\nContent-Length: 0\r\n\r\n")
                        .await;
                } else {
                    let body = r#"{"workflows":[{"name":"Backup","active":true}]}"#;
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nETag: \"v1\"\r\nContent-Length: {}\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = sock.write_all(resp.as_bytes()).await;
                }
            }
        });

        let url = format!("http://127.0.0.1:{}/api/v1/workflows", addr.port());

        // Without opt-in, plain http to loopback is refused.
        let denied = fetch_custom(&CustomHttpRequest {
            url: url.clone(),
            allow_local_http: false,
            headers: BTreeMap::new(),
            timeout_ms: 5000,
            max_bytes: 65536,
            etag: None,
            last_modified: None,
        })
        .await;
        assert!(denied.is_err());

        // With opt-in, first fetch returns 200 + ETag.
        let first = fetch_custom(&CustomHttpRequest {
            url: url.clone(),
            allow_local_http: true,
            headers: BTreeMap::new(),
            timeout_ms: 5000,
            max_bytes: 65536,
            etag: None,
            last_modified: None,
        })
        .await
        .unwrap();
        let etag = match first {
            CustomHttpResponse::Ok { body, etag, .. } => {
                assert!(String::from_utf8_lossy(&body).contains("Backup"));
                etag
            }
            CustomHttpResponse::NotModified => panic!("expected 200"),
        };
        assert_eq!(etag.as_deref(), Some("\"v1\""));

        // Second fetch with ETag returns 304 NotModified.
        let second = fetch_custom(&CustomHttpRequest {
            url,
            allow_local_http: true,
            headers: BTreeMap::new(),
            timeout_ms: 5000,
            max_bytes: 65536,
            etag,
            last_modified: None,
        })
        .await
        .unwrap();
        assert_eq!(second, CustomHttpResponse::NotModified);

        server.await.unwrap();
    }
}

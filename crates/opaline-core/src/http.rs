//! The one HTTP client core uses (weather, album art, public IP, update checks). Webviews never
//! load remote content; core fetches with limits and caches (ARCHITECTURE §7).

use std::sync::OnceLock;
use std::time::Duration;

const TIMEOUT: Duration = Duration::from_secs(10);

/// A shared client: rustls with the system's certificate store, a generic user agent (no
/// personal data), and a 10 s timeout.
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

#[cfg(test)]
mod tests {
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
}

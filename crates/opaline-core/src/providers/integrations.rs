//! First-party opt-in Developer & Online integration helpers: RSS/Atom/JSON Feed sanitizer,
//! GitHub, Home Assistant, and n8n REST APIs (brief §8.5, PLAN-2 task 7.5).
//!
//! All network calls go through `crate::http::fetch_custom` (SSRF-hardened, DNS-pinned) and all
//! credentials come exclusively from GNOME Keyring (`crate::secrets`). Feed items are strictly
//! stripped to plain text so zero remote HTML ever reaches a webview.

use std::collections::BTreeMap;

use opaline_ipc::Value;

const MAX_FEED_ITEMS: usize = 30;

/// Strips HTML tags and decodes common entities into clean plain text (zero HTML in webviews).
pub fn strip_html_to_text(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut in_tag = false;
    for ch in raw.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Extracts the first inner text of `<tag>...</tag>` (case-insensitive, CDATA-aware).
fn xml_tag_text(block: &str, tag: &str) -> Option<String> {
    let open_prefix = format!("<{tag}");
    let close_tag = format!("</{tag}>");
    let lower = block.to_ascii_lowercase();
    let start = lower.find(&open_prefix)?;
    let after_open = &block[start + open_prefix.len()..];
    let gt = after_open.find('>')?;
    let body_start = start + open_prefix.len() + gt + 1;
    let end_rel = lower[body_start..].find(&close_tag)?;
    let raw = block[body_start..body_start + end_rel].trim();
    let un_cdata = raw
        .strip_prefix("<![CDATA[")
        .and_then(|s| s.strip_suffix("]]>"))
        .unwrap_or(raw);
    Some(strip_html_to_text(un_cdata))
}

fn xml_atom_link(block: &str) -> Option<String> {
    let lower = block.to_ascii_lowercase();
    let idx = lower.find("<link")?;
    let rest = &block[idx..];
    let end = rest.find('>')?;
    let tag = &rest[..end];
    let href_idx = tag.find("href=")?;
    let after = &tag[href_idx + 5..];
    let quote = after.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let val_end = after[1..].find(quote)?;
    Some(after[1..1 + val_end].to_owned())
}

/// Parses RSS 2.0, Atom 1.0, or JSON Feed 1.1 bytes into a sanitized plain-text `Value`.
pub fn parse_feed(bytes: &[u8]) -> Result<Value, String> {
    let text = std::str::from_utf8(bytes).map_err(|_| "feed is not valid UTF-8".to_owned())?;
    let trimmed = text.trim();

    // JSON Feed 1.0 / 1.1
    if trimmed.starts_with('{') {
        let doc: serde_json::Value =
            serde_json::from_str(trimmed).map_err(|e| format!("invalid JSON Feed: {e}"))?;
        let feed_title = doc
            .get("title")
            .and_then(serde_json::Value::as_str)
            .map(strip_html_to_text)
            .unwrap_or_else(|| "Feed".into());
        let mut items = Vec::new();
        if let Some(arr) = doc.get("items").and_then(serde_json::Value::as_array) {
            for item in arr.iter().take(MAX_FEED_ITEMS) {
                let title = item
                    .get("title")
                    .and_then(serde_json::Value::as_str)
                    .map(strip_html_to_text)
                    .unwrap_or_default();
                let url = item
                    .get("url")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("")
                    .to_owned();
                let date = item
                    .get("date_published")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("")
                    .to_owned();
                let summary = item
                    .get("summary")
                    .or_else(|| item.get("content_text"))
                    .or_else(|| item.get("content_html"))
                    .and_then(serde_json::Value::as_str)
                    .map(strip_html_to_text)
                    .unwrap_or_default();
                if !title.is_empty() {
                    items.push(Value::map([
                        ("title", Value::Text(title)),
                        ("url", Value::Text(url)),
                        ("date", Value::Text(date)),
                        ("summary", Value::Text(summary)),
                    ]));
                }
            }
        }
        return Ok(Value::map([
            ("title", Value::Text(feed_title)),
            ("items", Value::List(items)),
        ]));
    }

    // RSS 2.0 (<item>) or Atom 1.0 (<entry>)
    let is_atom = trimmed.contains("<entry") && !trimmed.contains("<item>");
    let (item_open, item_close) = if is_atom {
        ("<entry", "</entry>")
    } else {
        ("<item", "</item>")
    };
    let feed_title = xml_tag_text(trimmed, "title").unwrap_or_else(|| "Feed".into());

    let mut items = Vec::new();
    let mut rest = trimmed;
    while items.len() < MAX_FEED_ITEMS {
        let Some(s) = rest.find(item_open) else { break };
        let after = &rest[s..];
        let Some(e) = after.find(item_close) else {
            break;
        };
        let block = &after[..e + item_close.len()];
        let title = xml_tag_text(block, "title").unwrap_or_default();
        let url = if is_atom {
            xml_atom_link(block).unwrap_or_default()
        } else {
            xml_tag_text(block, "link").unwrap_or_default()
        };
        let date = xml_tag_text(block, "pubdate")
            .or_else(|| xml_tag_text(block, "updated"))
            .or_else(|| xml_tag_text(block, "published"))
            .unwrap_or_default();
        let summary = xml_tag_text(block, "description")
            .or_else(|| xml_tag_text(block, "summary"))
            .unwrap_or_default();
        if !title.is_empty() {
            items.push(Value::map([
                ("title", Value::Text(title)),
                ("url", Value::Text(url)),
                ("date", Value::Text(date)),
                ("summary", Value::Text(summary)),
            ]));
        }
        rest = &after[e + item_close.len()..];
    }

    Ok(Value::map([
        ("title", Value::Text(feed_title)),
        ("items", Value::List(items)),
    ]))
}

/// Triggers a validated Home Assistant toggle (`POST /api/services/homeassistant/toggle`) using
/// SSRF-checked resolution and a GNOME Keyring long-lived token.
pub async fn ha_toggle_entity(
    base_url: &str,
    entity_id: &str,
    secret_name: &str,
    allow_local_http: bool,
) -> Result<(), String> {
    if !entity_id.contains('.')
        || !entity_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_'))
    {
        return Err("invalid-ha-entity-id".into());
    }
    let token = crate::secrets::get_secret(secret_name)
        .await?
        .ok_or_else(|| format!("missing secret '{secret_name}'"))?;
    let url = format!(
        "{}/api/services/homeassistant/toggle",
        base_url.trim_end_matches('/')
    );
    let parsed = url::Url::parse(&url).map_err(|e| format!("invalid-url: {e}"))?;
    let host = parsed.host_str().ok_or("missing-host")?.to_owned();
    let port = parsed.port_or_known_default().ok_or("missing-port")?;
    let pinned =
        crate::http::resolve_and_validate(parsed.scheme(), &host, port, allow_local_http).await?;
    let client = reqwest::Client::builder()
        .resolve(&host, pinned)
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let body = serde_json::json!({ "entity_id": entity_id }).to_string();
    let resp = client
        .post(url)
        .bearer_auth(&token)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| crate::secrets::redact_text(&e.to_string(), &[&token]))?;
    if !resp.status().is_success() {
        return Err(format!("Home Assistant HTTP {}", resp.status()));
    }
    Ok(())
}

/// Activates or deactivates an n8n workflow via REST API (`POST /api/v1/workflows/<id>/activate`).
pub async fn n8n_set_workflow_active(
    base_url: &str,
    workflow_id: &str,
    active: bool,
    secret_name: &str,
    allow_local_http: bool,
) -> Result<(), String> {
    if workflow_id.is_empty()
        || !workflow_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
    {
        return Err("invalid-n8n-workflow-id".into());
    }
    let api_key = crate::secrets::get_secret(secret_name)
        .await?
        .ok_or_else(|| format!("missing secret '{secret_name}'"))?;
    let action = if active { "activate" } else { "deactivate" };
    let url = format!(
        "{}/api/v1/workflows/{workflow_id}/{action}",
        base_url.trim_end_matches('/')
    );
    let parsed = url::Url::parse(&url).map_err(|e| format!("invalid-url: {e}"))?;
    let host = parsed.host_str().ok_or("missing-host")?.to_owned();
    let port = parsed.port_or_known_default().ok_or("missing-port")?;
    let pinned =
        crate::http::resolve_and_validate(parsed.scheme(), &host, port, allow_local_http).await?;
    let client = reqwest::Client::builder()
        .resolve(&host, pinned)
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post(url)
        .header("X-N8N-API-KEY", &api_key)
        .send()
        .await
        .map_err(|e| crate::secrets::redact_text(&e.to_string(), &[&api_key]))?;
    if !resp.status().is_success() {
        return Err(format!("n8n HTTP {}", resp.status()));
    }
    Ok(())
}

/// Fetches and parses a feed URL via core's SSRF-hardened HTTP client (text only, zero HTML).
pub async fn fetch_feed(url: &str) -> Result<Value, String> {
    let resp = crate::http::fetch_custom(&crate::http::CustomHttpRequest {
        url: url.to_owned(),
        allow_local_http: false,
        headers: BTreeMap::new(),
        timeout_ms: 10_000,
        max_bytes: 512 * 1024,
        etag: None,
        last_modified: None,
    })
    .await?;
    match resp {
        crate::http::CustomHttpResponse::Ok { body, .. } => parse_feed(&body),
        crate::http::CustomHttpResponse::NotModified => {
            Ok(Value::map([("items", Value::List(Vec::new()))]))
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::panic)]

    use super::*;

    #[test]
    fn parses_rss_atom_and_json_feed_and_strips_all_html() {
        let rss = br#"<rss><channel><title>Linux &amp; News</title>
            <item><title><![CDATA[<b>GNOME 50</b> Released]]></title>
            <link>https://example.org/g50</link>
            <description><script>alert(1)</script>Hello &amp; welcome!</description></item>
            </channel></rss>"#;
        let parsed = parse_feed(rss).unwrap();
        let Value::Map(m) = parsed else {
            panic!("expected map")
        };
        assert_eq!(m.get("title"), Some(&Value::Text("Linux & News".into())));
        let Value::List(items) = m.get("items").unwrap() else {
            panic!("expected list")
        };
        assert_eq!(items.len(), 1);
        let Value::Map(it) = &items[0] else {
            panic!("expected item map")
        };
        assert_eq!(
            it.get("title"),
            Some(&Value::Text("GNOME 50 Released".into()))
        );
        let summary = format!("{:?}", it.get("summary"));
        assert!(!summary.contains("<script>"));
        assert!(!summary.contains("<b>"));

        let atom = br#"<feed><title>Atom Feed</title>
            <entry><title>Entry One</title><link href="https://example.org/1"/><summary>Hi</summary></entry>
            </feed>"#;
        let parsed_atom = parse_feed(atom).unwrap();
        let Value::Map(am) = parsed_atom else {
            panic!("expected map")
        };
        let Value::List(aitems) = am.get("items").unwrap() else {
            panic!("expected list")
        };
        assert_eq!(aitems.len(), 1);

        let jf = br#"{"version":"https://jsonfeed.org/version/1.1","title":"JF","items":[{"title":"Post <i>1</i>","url":"https://example.org/p1","content_html":"<p>Body</p>"}]}"#;
        let parsed_jf = parse_feed(jf).unwrap();
        let Value::Map(jm) = parsed_jf else {
            panic!("expected map")
        };
        let Value::List(jitems) = jm.get("items").unwrap() else {
            panic!("expected list")
        };
        assert_eq!(jitems.len(), 1);
    }
}

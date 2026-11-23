//! `opaline-asset://<kind>/<file>`: images core rendered or cached for the webviews (wallpaper
//! variants, album art). Only plain file names inside Opaline's own cache folders are served;
//! the webviews never get file system access (ARCHITECTURE §7).

use std::borrow::Cow;

use tauri::http::{Request, Response, StatusCode, header};

const KINDS: [&str; 2] = ["wallpaper", "art"];

/// A file name we would have written ourselves: `[A-Za-z0-9._-]+` with an image extension.
pub fn safe_name(name: &str) -> Option<&'static str> {
    if name.is_empty() || name.len() > 128 || name.starts_with('.') {
        return None;
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    {
        return None;
    }
    match name.rsplit_once('.').map(|(_, ext)| ext) {
        Some("png") => Some("image/png"),
        Some("jpg" | "jpeg") => Some("image/jpeg"),
        Some("webp") => Some("image/webp"),
        _ => None,
    }
}

fn respond(status: StatusCode, content_type: &str, body: Vec<u8>) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        // The layer page (another origin) uploads wallpapers to WebGL, which needs CORS.
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        // Files are named by content hash, so they never change under the same name.
        .header(header::CACHE_CONTROL, "max-age=31536000, immutable")
        .body(Cow::<'static, [u8]>::Owned(body))
        .unwrap_or_else(|_| Response::new(Cow::<'static, [u8]>::Borrowed(&[])))
}

/// Reads an asset by its `opaline-asset://kind/name` URL, with the same checks as the scheme.
pub fn read_url(url: &str) -> Option<Vec<u8>> {
    let rest = url.strip_prefix("opaline-asset://")?;
    let (kind, name) = rest.split_once('/')?;
    if !KINDS.contains(&kind) || safe_name(name).is_none() {
        return None;
    }
    let dir = opaline_core::paths::cache_dir().ok()?;
    std::fs::read(dir.join(kind).join(name)).ok()
}

/// The bytes of an asset, for pages that need a same-origin copy (WebGL textures): WebKitGTK
/// doesn't allow cross-origin reads of the custom scheme.
#[tauri::command]
pub fn layer_asset(url: String) -> Result<tauri::ipc::Response, String> {
    read_url(&url)
        .map(tauri::ipc::Response::new)
        .ok_or_else(|| "not-found".to_owned())
}

pub fn handle(request: &Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let uri = request.uri();
    let kind = uri.host().unwrap_or("");
    let name = uri.path().trim_start_matches('/');
    let (Some(content_type), true) = (safe_name(name), KINDS.contains(&kind)) else {
        return respond(StatusCode::NOT_FOUND, "text/plain", Vec::new());
    };
    let Ok(dir) = opaline_core::paths::cache_dir() else {
        return respond(StatusCode::NOT_FOUND, "text/plain", Vec::new());
    };
    match std::fs::read(dir.join(kind).join(name)) {
        Ok(bytes) => respond(StatusCode::OK, content_type, bytes),
        Err(_) => respond(StatusCode::NOT_FOUND, "text/plain", Vec::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_plain_image_names() {
        assert_eq!(safe_name("0123abcd-glass.png"), Some("image/png"));
        assert_eq!(read_url("opaline-asset://wallpaper/../../etc/passwd"), None);
        assert_eq!(read_url("opaline-asset://secrets/a.png"), None);
        assert_eq!(read_url("file:///etc/passwd"), None);
        assert_eq!(safe_name("a.jpg"), Some("image/jpeg"));
        assert_eq!(safe_name("../settings.json"), None);
        assert_eq!(safe_name("..png"), None);
        assert_eq!(safe_name("x/y.png"), None);
        assert_eq!(safe_name("notes.txt"), None);
        assert_eq!(safe_name(""), None);
    }
}

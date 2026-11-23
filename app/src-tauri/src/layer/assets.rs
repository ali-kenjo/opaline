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
        // Files are named by content hash, so they never change under the same name.
        .header(header::CACHE_CONTROL, "max-age=31536000, immutable")
        .body(Cow::<'static, [u8]>::Owned(body))
        .unwrap_or_else(|_| Response::new(Cow::<'static, [u8]>::Borrowed(&[])))
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
        assert_eq!(safe_name("a.jpg"), Some("image/jpeg"));
        assert_eq!(safe_name("../settings.json"), None);
        assert_eq!(safe_name("..png"), None);
        assert_eq!(safe_name("x/y.png"), None);
        assert_eq!(safe_name("notes.txt"), None);
        assert_eq!(safe_name(""), None);
    }
}

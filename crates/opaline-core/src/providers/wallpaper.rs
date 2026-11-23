//! Wallpaper: renders each monitor's wallpaper the way GNOME places it, at quarter resolution,
//! as a soft blur for the glass and a heavier one for the Edit/Peek backdrop, plus a 128×128
//! thumbnail for the source color and an 8×8 luminance grid for adaptive legibility
//! (brief §6 "Wallpaper", ARCHITECTURE §3.8). Files go to `~/.cache/opaline/wallpaper/` and the
//! layer loads them through `opaline-asset://wallpaper/<file>`.

use std::collections::BTreeMap;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use image::{Rgb, RgbImage, imageops};
use opaline_ipc::{MonitorInfo, TopicUpdate, Value};
use tokio::sync::Notify;
use zbus::{Connection, MatchRule, MessageStream};

use crate::engine::{update, while_subscribed_notified};
use crate::hub::Hub;

pub const MONITORS: &str = "wallpaper.monitors";
pub const SOURCE: &str = "wallpaper.source";
pub const TOPICS: &[&str] = &[MONITORS, SOURCE];
/// Safety net; changes normally arrive as dconf signals. Slideshows change on their own.
const PERIOD: Duration = Duration::from_secs(300);
const SCALE: u32 = 4;
const GLASS_RADIUS: u32 = 6;
const BACKDROP_RADIUS: u32 = 18;
const GRID: u32 = 8;
const THUMB: u32 = 128;
pub const ASSET_PREFIX: &str = "opaline-asset://wallpaper/";

/// `org.gnome.desktop.background`.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Background {
    pub uri: Option<String>,
    pub uri_dark: Option<String>,
    pub options: String,
    pub primary: [u8; 3],
    pub secondary: [u8; 3],
    pub shading: String,
}

fn unquote(v: &str) -> &str {
    v.trim().trim_matches('\'')
}

/// GSettings colors: `#rrggbb` or GTK's 16-bit `#rrrrggggbbbb`.
pub fn parse_color(s: &str) -> Option<[u8; 3]> {
    let hex = s.strip_prefix('#')?;
    let step = match hex.len() {
        6 => 2,
        12 => 4,
        _ => return None,
    };
    let c = |i: usize| u8::from_str_radix(hex.get(i * step..i * step + 2)?, 16).ok();
    Some([c(0)?, c(1)?, c(2)?])
}

/// Parses `gsettings list-recursively org.gnome.desktop.background`.
pub fn parse_background(text: &str) -> Background {
    let mut b = Background {
        options: "zoom".into(),
        shading: "solid".into(),
        ..Background::default()
    };
    for line in text.lines() {
        let mut parts = line.splitn(3, ' ');
        let (Some(_), Some(key), Some(value)) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        let v = unquote(value);
        match key {
            "picture-uri" => b.uri = Some(v.to_owned()).filter(|u| !u.is_empty()),
            "picture-uri-dark" => b.uri_dark = Some(v.to_owned()).filter(|u| !u.is_empty()),
            "picture-options" => b.options = v.to_owned(),
            "primary-color" => b.primary = parse_color(v).unwrap_or([0, 0, 0]),
            "secondary-color" => b.secondary = parse_color(v).unwrap_or([0, 0, 0]),
            "color-shading-type" => b.shading = v.to_owned(),
            _ => {}
        }
    }
    b
}

fn file_path(uri: &str) -> Option<PathBuf> {
    let path = uri.strip_prefix("file://")?;
    let mut out = Vec::new();
    let bytes = path.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && let Some(b) = path
                .get(i + 1..i + 3)
                .and_then(|h| u8::from_str_radix(h, 16).ok())
        {
            out.push(b);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    Some(PathBuf::from(String::from_utf8_lossy(&out).into_owned()))
}

/// GNOME slideshow XML: the file showing at `elapsed` seconds after `<starttime>`.
pub fn slideshow_file(xml: &str, elapsed: f64) -> Option<String> {
    let mut slides: Vec<(f64, String)> = Vec::new();
    let mut rest = xml;
    while let Some(i) = rest.find("<static>") {
        let block_end = rest[i..].find("</static>").map_or(rest.len(), |e| i + e);
        let block = &rest[i..block_end];
        let tag = |t: &str| {
            let s = block.find(&format!("<{t}>"))? + t.len() + 2;
            let e = block[s..].find(&format!("</{t}>"))? + s;
            Some(block[s..e].trim().to_owned())
        };
        if let (Some(d), Some(f)) = (
            tag("duration").and_then(|d| d.parse::<f64>().ok()),
            tag("file"),
        ) {
            slides.push((d, f));
        }
        rest = &rest[block_end..];
    }
    let total: f64 = slides.iter().map(|(d, _)| d).sum();
    if total <= 0.0 {
        return slides.first().map(|(_, f)| f.clone());
    }
    let mut t = elapsed.rem_euclid(total);
    for (d, f) in &slides {
        if t < *d {
            return Some(f.clone());
        }
        t -= d;
    }
    slides.last().map(|(_, f)| f.clone())
}

/// Decodes PNG/JPEG/WebP, JPEG XL, or a slideshow's current slide. SVG isn't rendered (the
/// colors are used instead).
fn load(path: &Path) -> Option<RgbImage> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "xml" => {
            let xml = std::fs::read_to_string(path).ok()?;
            let start = slideshow_start(&xml).unwrap_or(0);
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.as_secs());
            let file = slideshow_file(&xml, now.saturating_sub(start) as f64)?;
            load(Path::new(&file))
        }
        "jxl" => {
            let img = jxl_oxide::JxlImage::builder().open(path).ok()?;
            let frame = img.render_frame(0).ok()?;
            let fb = frame.image_all_channels();
            let (w, h, ch) = (fb.width(), fb.height(), fb.channels());
            let buf = fb.buf();
            let to8 = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
            RgbImage::from_fn(w as u32, h as u32, |x, y| {
                let i = (y as usize * w + x as usize) * ch;
                if ch >= 3 {
                    Rgb([to8(buf[i]), to8(buf[i + 1]), to8(buf[i + 2])])
                } else {
                    let g = to8(buf[i]);
                    Rgb([g, g, g])
                }
            })
            .into()
        }
        "svg" | "svgz" => None,
        _ => image::open(path).ok().map(|i| i.to_rgb8()),
    }
}

fn slideshow_start(xml: &str) -> Option<u64> {
    let s = xml.find("<starttime>")?;
    let e = xml[s..].find("</starttime>")? + s;
    let block = &xml[s..e];
    let tag = |t: &str| -> Option<u32> {
        let a = block.find(&format!("<{t}>"))? + t.len() + 2;
        let b = block[a..].find(&format!("</{t}>"))? + a;
        block[a..b].trim().parse().ok()
    };
    let date = chrono::NaiveDate::from_ymd_opt(
        i32::try_from(tag("year")?).ok()?,
        tag("month")?,
        tag("day")?,
    )?;
    let dt = date.and_hms_opt(tag("hour")?, tag("minute")?, tag("second")?)?;
    use chrono::TimeZone;
    chrono::Local
        .from_local_datetime(&dt)
        .earliest()
        .map(|t| t.timestamp().max(0) as u64)
}

/// The background colors: solid, or a horizontal/vertical gradient from primary to secondary.
fn colors(b: &Background, w: u32, h: u32) -> RgbImage {
    let mix = |t: f32| {
        let c = |i: usize| {
            (f32::from(b.primary[i]) * (1.0 - t) + f32::from(b.secondary[i]) * t).round() as u8
        };
        Rgb([c(0), c(1), c(2)])
    };
    RgbImage::from_fn(w, h, |x, y| match b.shading.as_str() {
        "horizontal" => mix(x as f32 / w.max(2).saturating_sub(1) as f32),
        "vertical" => mix(y as f32 / h.max(2).saturating_sub(1) as f32),
        _ => Rgb(b.primary),
    })
}

/// Logical rectangle in the union-of-monitors space.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Renders what GNOME shows on a monitor (`mon`) at `out_w × out_h` pixels. `union` is the
/// bounding box of all monitors, used by `spanned`.
pub fn render(
    b: &Background,
    image: Option<&RgbImage>,
    mon: Rect,
    union: Rect,
    out_w: u32,
    out_h: u32,
) -> RgbImage {
    let mut canvas = colors(b, out_w, out_h);
    let Some(img) = image.filter(|_| b.options != "none") else {
        return canvas;
    };
    let (iw, ih) = (img.width() as f64, img.height() as f64);
    let px = out_w as f64 / mon.w; // output pixels per logical pixel
    match b.options.as_str() {
        "stretched" => return imageops::resize(img, out_w, out_h, imageops::FilterType::Triangle),
        "spanned" => {
            // Cover the union, then crop this monitor's part.
            let s = (union.w / iw).max(union.h / ih);
            let (sw, sh) = (iw * s, ih * s);
            let (ox, oy) = ((union.w - sw) / 2.0, (union.h - sh) / 2.0);
            let crop_x = ((mon.x - union.x - ox) / s).max(0.0);
            let crop_y = ((mon.y - union.y - oy) / s).max(0.0);
            let crop = imageops::crop_imm(
                img,
                crop_x as u32,
                crop_y as u32,
                (mon.w / s) as u32,
                (mon.h / s) as u32,
            )
            .to_image();
            return imageops::resize(&crop, out_w, out_h, imageops::FilterType::Triangle);
        }
        "zoom" => {
            let s = (out_w as f64 / iw).max(out_h as f64 / ih);
            let (sw, sh) = ((iw * s).ceil() as u32, (ih * s).ceil() as u32);
            let scaled =
                imageops::resize(img, sw.max(1), sh.max(1), imageops::FilterType::Triangle);
            let (cx, cy) = (sw.saturating_sub(out_w) / 2, sh.saturating_sub(out_h) / 2);
            return imageops::crop_imm(&scaled, cx, cy, out_w, out_h).to_image();
        }
        "scaled" => {
            let s = (out_w as f64 / iw).min(out_h as f64 / ih);
            let (sw, sh) = (
                ((iw * s).round() as u32).max(1),
                ((ih * s).round() as u32).max(1),
            );
            let scaled = imageops::resize(img, sw, sh, imageops::FilterType::Triangle);
            imageops::overlay(
                &mut canvas,
                &scaled,
                i64::from((out_w - sw.min(out_w)) / 2),
                i64::from((out_h - sh.min(out_h)) / 2),
            );
        }
        "wallpaper" => {
            let (tw, th) = (
                ((iw * px).round() as u32).max(1),
                ((ih * px).round() as u32).max(1),
            );
            let tile = imageops::resize(img, tw, th, imageops::FilterType::Triangle);
            for ty in (0..out_h).step_by(th as usize) {
                for tx in (0..out_w).step_by(tw as usize) {
                    imageops::overlay(&mut canvas, &tile, i64::from(tx), i64::from(ty));
                }
            }
        }
        _ => {
            // "centered": original size (in logical pixels) in the middle.
            let (tw, th) = (
                ((iw * px).round() as u32).max(1),
                ((ih * px).round() as u32).max(1),
            );
            let tile = imageops::resize(img, tw, th, imageops::FilterType::Triangle);
            imageops::overlay(
                &mut canvas,
                &tile,
                (i64::from(out_w) - i64::from(tw)) / 2,
                (i64::from(out_h) - i64::from(th)) / 2,
            );
        }
    }
    canvas
}

/// Three box-blur passes per axis ≈ a Gaussian with σ ≈ radius (clamped edges).
pub fn blur(img: &RgbImage, radius: u32) -> RgbImage {
    let mut out = img.clone();
    for _ in 0..3 {
        out = box_pass(&out, radius, true);
        out = box_pass(&out, radius, false);
    }
    out
}

fn box_pass(img: &RgbImage, r: u32, horizontal: bool) -> RgbImage {
    let (w, h) = img.dimensions();
    let (len, lines) = if horizontal { (w, h) } else { (h, w) };
    let r = r.min(len.saturating_sub(1)) as i64;
    let mut out = RgbImage::new(w, h);
    let at = |line: u32, i: i64| {
        let i = i.clamp(0, i64::from(len) - 1) as u32;
        if horizontal {
            img.get_pixel(i, line)
        } else {
            img.get_pixel(line, i)
        }
    };
    let n = (2 * r + 1) as u32;
    for line in 0..lines {
        let mut sum = [0u32; 3];
        for i in -r..=r {
            let p = at(line, i);
            for c in 0..3 {
                sum[c] += u32::from(p[c]);
            }
        }
        for i in 0..i64::from(len) {
            let px = Rgb([(sum[0] / n) as u8, (sum[1] / n) as u8, (sum[2] / n) as u8]);
            let (x, y) = if horizontal {
                (i as u32, line)
            } else {
                (line, i as u32)
            };
            out.put_pixel(x, y, px);
            let (add, sub) = (at(line, i + r + 1), at(line, i - r));
            for c in 0..3 {
                sum[c] = sum[c] + u32::from(add[c]) - u32::from(sub[c]);
            }
        }
    }
    out
}

/// Mean relative luminance (sRGB → linear, Rec. 709 weights) per cell of an 8×8 grid.
pub fn luminance_grid(img: &RgbImage) -> Vec<f64> {
    let lin = |c: u8| {
        let c = f64::from(c) / 255.0;
        if c <= 0.04045 {
            c / 12.92
        } else {
            ((c + 0.055) / 1.055).powf(2.4)
        }
    };
    let (w, h) = img.dimensions();
    let mut out = Vec::with_capacity((GRID * GRID) as usize);
    for gy in 0..GRID {
        for gx in 0..GRID {
            let (x0, x1) = (
                gx * w / GRID,
                ((gx + 1) * w / GRID).max(gx * w / GRID + 1).min(w),
            );
            let (y0, y1) = (
                gy * h / GRID,
                ((gy + 1) * h / GRID).max(gy * h / GRID + 1).min(h),
            );
            let (mut sum, mut n) = (0.0, 0.0);
            for y in y0..y1 {
                for x in x0..x1 {
                    let p = img.get_pixel(x, y);
                    sum += 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
                    n += 1.0;
                }
            }
            out.push(if n > 0.0 { sum / n } else { 0.0 });
        }
    }
    out
}

fn cache_dir() -> Option<PathBuf> {
    crate::paths::cache_dir().ok().map(|d| d.join("wallpaper"))
}

/// Writes `img` as `<key>-<variant>.png` once; returns the asset URL.
fn store(dir: &Path, key: u64, variant: &str, img: &RgbImage) -> Option<String> {
    let name = format!("{key:016x}-{variant}.png");
    let path = dir.join(&name);
    if !path.exists() {
        let mut bytes = Vec::new();
        img.write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Png,
        )
        .ok()?;
        crate::paths::write_atomic(&path, &bytes).ok()?;
    }
    Some(format!("{ASSET_PREFIX}{name}"))
}

fn prefers_dark() -> bool {
    std::process::Command::new("gsettings")
        .args(["get", "org.gnome.desktop.interface", "color-scheme"])
        .output()
        .ok()
        .is_some_and(|o| String::from_utf8_lossy(&o.stdout).contains("dark"))
}

fn read_background() -> Background {
    std::process::Command::new("gsettings")
        .args(["list-recursively", "org.gnome.desktop.background"])
        .output()
        .ok()
        .map(|o| parse_background(&String::from_utf8_lossy(&o.stdout)))
        .unwrap_or_default()
}

/// Renders everything for the current monitors (blocking work).
fn build(monitors: &[MonitorInfo]) -> Vec<TopicUpdate> {
    let b = read_background();
    let uri = if prefers_dark() {
        b.uri_dark.clone().or(b.uri.clone())
    } else {
        b.uri.clone()
    };
    let path = uri.as_deref().and_then(file_path);
    let meta = path.as_ref().and_then(|p| std::fs::metadata(p).ok());
    let image = path.as_deref().and_then(load);
    let Some(dir) = cache_dir() else {
        return vec![update(MONITORS, Value::unavailable("no-cache-dir"))];
    };
    let union = monitors.iter().fold(None::<Rect>, |acc, m| {
        let r = Rect {
            x: f64::from(m.x),
            y: f64::from(m.y),
            w: f64::from(m.width),
            h: f64::from(m.height),
        };
        Some(match acc {
            None => r,
            Some(a) => {
                let (x0, y0) = (a.x.min(r.x), a.y.min(r.y));
                let (x1, y1) = ((a.x + a.w).max(r.x + r.w), (a.y + a.h).max(r.y + r.h));
                Rect {
                    x: x0,
                    y: y0,
                    w: x1 - x0,
                    h: y1 - y0,
                }
            }
        })
    });
    let base_key = {
        let mut h = std::collections::hash_map::DefaultHasher::new();
        (&uri, &b.options, b.primary, b.secondary, &b.shading).hash(&mut h);
        meta.as_ref()
            .map(|m| (m.len(), m.modified().ok()))
            .hash(&mut h);
        h.finish()
    };
    let mut per_monitor = BTreeMap::new();
    for m in monitors {
        let mon = Rect {
            x: f64::from(m.x),
            y: f64::from(m.y),
            w: f64::from(m.width),
            h: f64::from(m.height),
        };
        let (w, h) = ((m.width / SCALE).max(1), (m.height / SCALE).max(1));
        let key = {
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            (base_key, m.x, m.y, m.width, m.height).hash(&mut hasher);
            hasher.finish()
        };
        let rendered = render(&b, image.as_ref(), mon, union.unwrap_or(mon), w, h);
        let glass = blur(&rendered, GLASS_RADIUS);
        let backdrop = blur(&rendered, BACKDROP_RADIUS);
        per_monitor.insert(
            m.key.clone(),
            Value::map([
                ("glass", Value::from(store(&dir, key, "glass", &glass))),
                (
                    "backdrop",
                    Value::from(store(&dir, key, "backdrop", &backdrop)),
                ),
                ("width", Value::Num(f64::from(w))),
                ("height", Value::Num(f64::from(h))),
                ("luminance", Value::Nums(luminance_grid(&glass))),
            ]),
        );
    }
    let thumb = match &image {
        Some(img) => imageops::thumbnail(img, THUMB, THUMB),
        None => colors(&b, THUMB, THUMB),
    };
    vec![
        update(MONITORS, Value::Map(per_monitor)),
        update(
            SOURCE,
            Value::map([
                (
                    "thumbnail",
                    Value::from(store(&dir, base_key, "thumb", &thumb)),
                ),
                ("options", Value::from(b.options.as_str())),
                ("image", Value::Bool(image.is_some())),
            ]),
        ),
    ]
}

async fn listen(conn: &Connection, wake: &Notify) -> Result<(), String> {
    // dconf's writer announces every change to the user database.
    let rule = MatchRule::builder()
        .msg_type(zbus::message::Type::Signal)
        .interface("ca.desrt.dconf.Writer")
        .member("Notify")
        .build()
        .map_err(|e| e.to_string())?;
    let mut stream = MessageStream::for_match_rule(rule, conn, None)
        .await
        .map_err(|e| e.to_string())?;
    while let Some(Ok(msg)) = stream.next().await {
        if let Ok((prefix, changes, _tag)) =
            msg.body().deserialize::<(String, Vec<String>, String)>()
        {
            let relevant = |p: &str| {
                p.starts_with("/org/gnome/desktop/background") || p.contains("color-scheme")
            };
            if relevant(&prefix) || changes.iter().any(|c| relevant(&format!("{prefix}{c}"))) {
                wake.notify_one();
            }
        }
    }
    Err("dconf signal stream ended".into())
}

pub async fn run(hub: Arc<Hub>) -> Result<(), String> {
    let conn = Connection::session().await.map_err(|e| e.to_string())?;
    let wake = Arc::new(Notify::new());
    // Monitor changes re-render too.
    let mut monitors = {
        let hub = hub.clone();
        let wake = wake.clone();
        let mut events = hub.events();
        tokio::spawn(async move {
            while let Ok(e) = events.recv().await {
                if matches!(e, opaline_ipc::CoreEvent::MonitorsChanged { .. }) {
                    wake.notify_one();
                }
            }
        })
    };
    let watch = while_subscribed_notified(&hub, TOPICS, PERIOD, &wake, || {
        let hub = hub.clone();
        async move {
            let mons = hub.monitors();
            tokio::task::spawn_blocking(move || build(&mons))
                .await
                .map_err(|e| e.to_string())
        }
    });
    let result = tokio::select! {
        r = watch => r,
        r = listen(&conn, &wake) => r,
    };
    monitors.abort();
    let _ = (&mut monitors).await;
    result
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::float_cmp)]

    use super::*;

    #[test]
    fn background_settings() {
        let b = parse_background(
            "org.gnome.desktop.background color-shading-type 'vertical'\norg.gnome.desktop.background picture-options 'scaled'\norg.gnome.desktop.background picture-uri 'file:///home/u/a%20b.png'\norg.gnome.desktop.background primary-color '#ffff00000000'\norg.gnome.desktop.background secondary-color '#0000ff'\n",
        );
        assert_eq!(b.options, "scaled");
        assert_eq!(b.primary, [255, 0, 0]);
        assert_eq!(b.secondary, [0, 0, 255]);
        assert_eq!(
            file_path(b.uri.as_deref().unwrap()),
            Some(PathBuf::from("/home/u/a b.png"))
        );
    }

    fn checker(w: u32, h: u32) -> RgbImage {
        RgbImage::from_fn(w, h, |x, _| {
            if x < w / 2 {
                Rgb([255, 255, 255])
            } else {
                Rgb([0, 0, 0])
            }
        })
    }

    fn mon(w: f64, h: f64) -> Rect {
        Rect {
            x: 0.0,
            y: 0.0,
            w,
            h,
        }
    }

    #[test]
    fn placement_modes() {
        let b = |options: &str| Background {
            options: options.into(),
            primary: [10, 20, 30],
            ..Background::default()
        };
        let img = checker(200, 100);
        // zoom: fills, keeps the image's left/right halves.
        let z = render(
            &b("zoom"),
            Some(&img),
            mon(400.0, 400.0),
            mon(400.0, 400.0),
            100,
            100,
        );
        assert_eq!(z.dimensions(), (100, 100));
        assert_eq!(z.get_pixel(10, 50), &Rgb([255, 255, 255]));
        assert_eq!(z.get_pixel(90, 50), &Rgb([0, 0, 0]));
        // scaled: letterboxed with the primary color.
        let s = render(
            &b("scaled"),
            Some(&img),
            mon(400.0, 400.0),
            mon(400.0, 400.0),
            100,
            100,
        );
        assert_eq!(s.get_pixel(50, 2), &Rgb([10, 20, 30]));
        // none: just the colors.
        let n = render(
            &b("none"),
            Some(&img),
            mon(400.0, 400.0),
            mon(400.0, 400.0),
            10,
            10,
        );
        assert_eq!(n.get_pixel(5, 5), &Rgb([10, 20, 30]));
        // spanned: the right monitor of two side by side gets the image's right (black) half.
        let left = Rect {
            x: 0.0,
            y: 0.0,
            w: 200.0,
            h: 200.0,
        };
        let right = Rect {
            x: 200.0,
            y: 0.0,
            w: 200.0,
            h: 200.0,
        };
        let union = Rect {
            x: 0.0,
            y: 0.0,
            w: 400.0,
            h: 200.0,
        };
        let r = render(&b("spanned"), Some(&img), right, union, 50, 50);
        assert_eq!(r.get_pixel(25, 25), &Rgb([0, 0, 0]));
        let l = render(&b("spanned"), Some(&img), left, union, 50, 50);
        assert_eq!(l.get_pixel(25, 25), &Rgb([255, 255, 255]));
    }

    #[test]
    fn gradients_blur_and_luminance() {
        let b = Background {
            options: "none".into(),
            primary: [0, 0, 0],
            secondary: [255, 255, 255],
            shading: "horizontal".into(),
            ..Background::default()
        };
        let g = render(&b, None, mon(100.0, 10.0), mon(100.0, 10.0), 100, 10);
        assert_eq!(g.get_pixel(0, 0), &Rgb([0, 0, 0]));
        assert_eq!(g.get_pixel(99, 0), &Rgb([255, 255, 255]));
        let blurred = blur(&checker(64, 8), 4);
        let mid = blurred.get_pixel(32, 4)[0];
        assert!(mid > 40 && mid < 215, "the edge is softened ({mid})");
        let lum = luminance_grid(&checker(64, 64));
        assert_eq!(lum.len(), 64);
        assert!(lum[0] > 0.99 && lum[7] < 0.01);
    }

    #[test]
    fn slideshows() {
        let xml = "<background><starttime><year>2026</year><month>1</month><day>1</day><hour>0</hour><minute>0</minute><second>0</second></starttime><static><duration>60</duration><file>/a.png</file></static><transition><duration>5</duration><from>/a.png</from><to>/b.png</to></transition><static><duration>60</duration><file>/b.png</file></static></background>";
        assert_eq!(slideshow_file(xml, 10.0).as_deref(), Some("/a.png"));
        assert_eq!(slideshow_file(xml, 70.0).as_deref(), Some("/b.png"));
        assert_eq!(slideshow_file(xml, 130.0).as_deref(), Some("/a.png"));
        assert!(slideshow_start(xml).is_some());
    }

    #[test]
    fn colors_parse() {
        assert_eq!(parse_color("#000000000000"), Some([0, 0, 0]));
        assert_eq!(parse_color("#ff8000"), Some([255, 128, 0]));
        assert_eq!(parse_color("red"), None);
    }
}

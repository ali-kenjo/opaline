//! Media: MPRIS players (metadata, status, position with extrapolation data, capabilities),
//! the most recently active one, controls, and album art (brief §6 "Media").
//! Event-driven: `PropertiesChanged`, `Seeked` and `NameOwnerChanged` wake a fetch.

use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use opaline_ipc::{TopicUpdate, Value};
use tokio::sync::Notify;
use zbus::{Connection, MatchRule, MessageStream, OwnedVariant};

use super::props::{Props, PropsExt, from_variants};
use crate::engine::{update, while_subscribed_notified};
use crate::hub::{Hub, now_ms};

pub const PLAYER: &str = "media.player";
pub const PLAYERS: &str = "media.players";
/// The visualizer needs to know whether something plays, so it keeps this provider running too.
const WATCH: &[&str] = &[PLAYER, PLAYERS, super::audio::SPECTRUM];
pub const TOPICS: &[&str] = &[PLAYER, PLAYERS];

const PREFIX: &str = "org.mpris.MediaPlayer2.";
const PATH: &str = "/org/mpris/MediaPlayer2";
const ROOT_IFACE: &str = "org.mpris.MediaPlayer2";
const PLAYER_IFACE: &str = "org.mpris.MediaPlayer2.Player";
const PERIOD: Duration = Duration::from_secs(30);
const ART_MAX: usize = 5 << 20;

/// One player as read from D-Bus.
#[derive(Debug, Clone, Default)]
pub struct Player {
    pub bus: String,
    pub root: Props,
    pub player: Props,
    /// `Metadata` (a{sv}) flattened: `xesam:artist` is a string list.
    pub metadata: Props,
    pub position_us: Option<f64>,
}

/// Picks the player to show: a playing one first, then the most recently active.
pub fn select<'a>(
    players: &'a [Player],
    active_at: &HashMap<String, Instant>,
) -> Option<&'a Player> {
    players.iter().max_by_key(|p| {
        let playing = p.player.str("PlaybackStatus") == Some("Playing");
        (playing, active_at.get(&p.bus).copied())
    })
}

pub fn player_value(p: &Player, art: Option<&str>) -> Value {
    let m = &p.metadata;
    let flag = |k: &str| Value::Bool(p.player.flag(k).unwrap_or(false));
    let mut e = vec![
        ("bus", Value::from(p.bus.as_str())),
        (
            "identity",
            Value::from(p.root.str("Identity").map(str::to_owned)),
        ),
        (
            "desktopEntry",
            Value::from(p.root.str("DesktopEntry").map(str::to_owned)),
        ),
        (
            "status",
            Value::from(p.player.str("PlaybackStatus").unwrap_or("Stopped")),
        ),
        (
            "title",
            Value::from(
                m.str("xesam:title")
                    .filter(|t| !t.is_empty())
                    .map(str::to_owned),
            ),
        ),
        (
            "artists",
            Value::List(
                m.strs("xesam:artist")
                    .into_iter()
                    .map(Value::from)
                    .collect(),
            ),
        ),
        (
            "album",
            Value::from(
                m.str("xesam:album")
                    .filter(|t| !t.is_empty())
                    .map(str::to_owned),
            ),
        ),
        (
            "lengthUs",
            Value::from(m.num("mpris:length").filter(|l| *l > 0.0)),
        ),
        // The UI extrapolates: position + (now − positionAtMs) × rate while playing.
        ("positionUs", Value::from(p.position_us)),
        ("positionAtMs", Value::Num(now_ms() as f64)),
        ("rate", Value::Num(p.player.num("Rate").unwrap_or(1.0))),
        ("canPlay", flag("CanPlay")),
        ("canPause", flag("CanPause")),
        ("canNext", flag("CanGoNext")),
        ("canPrevious", flag("CanGoPrevious")),
        ("canSeek", flag("CanSeek")),
        ("canControl", flag("CanControl")),
    ];
    if let Some(path) = art {
        e.push(("artPath", Value::from(path)));
    }
    Value::map(e)
}

/// `file://` art is read directly; returns the local path.
fn file_art(url: &str) -> Option<String> {
    let path = url.strip_prefix("file://")?;
    let decoded = percent_decode(path);
    std::path::Path::new(&decoded).is_file().then_some(decoded)
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && let Some(b) = s
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
    String::from_utf8_lossy(&out).into_owned()
}

fn art_cache_path(url: &str, content_type: &str) -> Option<PathBuf> {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    url.hash(&mut h);
    let ext = match content_type {
        t if t.starts_with("image/png") => "png",
        t if t.starts_with("image/webp") => "webp",
        _ => "jpg",
    };
    crate::paths::cache_dir()
        .ok()
        .map(|d| d.join("art").join(format!("{:016x}.{ext}", h.finish())))
}

/// Album art as a local file: `file://` directly, `https://` downloaded once (≤ 5 MB, images
/// only) into the cache.
async fn art(url: &str, cache: &Mutex<HashMap<String, Option<String>>>) -> Option<String> {
    if let Some(hit) = cache
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get(url)
    {
        return hit.clone();
    }
    let result = if url.starts_with("file://") {
        file_art(url)
    } else if url.starts_with("https://") {
        match crate::http::fetch_limited(url, ART_MAX, &["image/"]).await {
            Ok((bytes, ct)) => art_cache_path(url, &ct).and_then(|path| {
                crate::paths::write_atomic(&path, &bytes).ok()?;
                Some(path.to_string_lossy().into_owned())
            }),
            Err(error) => {
                tracing::debug!(%error, "album art not fetched");
                None
            }
        }
    } else {
        None
    };
    cache
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(url.to_owned(), result.clone());
    result
}

async fn get_all(
    conn: &Connection,
    bus: &str,
    iface: &str,
) -> Result<HashMap<String, OwnedVariant>, String> {
    conn.call_method(
        Some(bus),
        PATH,
        Some("org.freedesktop.DBus.Properties"),
        "GetAll",
        &(iface,),
    )
    .await
    .map_err(|e| e.to_string())?
    .body()
    .deserialize()
    .map_err(|e| e.to_string())
}

async fn list_players(conn: &Connection) -> Result<Vec<String>, String> {
    let names: Vec<String> = conn
        .call_method(
            Some("org.freedesktop.DBus"),
            "/org/freedesktop/DBus",
            Some("org.freedesktop.DBus"),
            "ListNames",
            &(),
        )
        .await
        .map_err(|e| e.to_string())?
        .body()
        .deserialize()
        .map_err(|e| e.to_string())?;
    Ok(names
        .into_iter()
        .filter(|n| n.starts_with(PREFIX))
        .collect())
}

#[derive(Debug, Default)]
struct Memory {
    /// When each player last started playing.
    active_at: HashMap<String, Instant>,
    was_playing: HashMap<String, bool>,
    art: Mutex<HashMap<String, Option<String>>>,
}

async fn fetch(
    conn: &Connection,
    hub: &Hub,
    memory: &Mutex<Memory>,
) -> Result<Vec<TopicUpdate>, String> {
    let mut players = Vec::new();
    for bus in list_players(conn).await? {
        let (Ok(root), Ok(raw)) = (
            get_all(conn, &bus, ROOT_IFACE).await,
            get_all(conn, &bus, PLAYER_IFACE).await,
        ) else {
            continue;
        };
        let metadata = raw
            .get("Metadata")
            .and_then(|v| v.try_clone().ok())
            .and_then(|v| HashMap::<String, OwnedVariant>::try_from(v).ok())
            .map(|m| from_variants(&m))
            .unwrap_or_default();
        let position_us = raw
            .get("Position")
            .and_then(|v| i64::try_from(v).ok())
            .map(|p| p as f64);
        players.push(Player {
            bus,
            root: from_variants(&root),
            player: from_variants(&raw),
            metadata,
            position_us,
        });
    }

    let now = Instant::now();
    let (selected, art_url) = {
        let mut mem = memory.lock().unwrap_or_else(PoisonError::into_inner);
        for p in &players {
            let playing = p.player.str("PlaybackStatus") == Some("Playing");
            let was = mem
                .was_playing
                .insert(p.bus.clone(), playing)
                .unwrap_or(false);
            if playing && !was {
                mem.active_at.insert(p.bus.clone(), now);
            }
        }
        let live: Vec<&str> = players.iter().map(|p| p.bus.as_str()).collect();
        mem.was_playing.retain(|b, _| live.contains(&b.as_str()));
        mem.active_at.retain(|b, _| live.contains(&b.as_str()));
        let selected = select(&players, &mem.active_at).cloned();
        let art_url = selected
            .as_ref()
            .and_then(|p| p.metadata.str("mpris:artUrl").map(str::to_owned));
        (selected, art_url)
    };
    hub.set_media_playing(if players.is_empty() {
        None
    } else {
        Some(
            players
                .iter()
                .any(|p| p.player.str("PlaybackStatus") == Some("Playing")),
        )
    });

    let art_path = match art_url {
        Some(url) => {
            let cache =
                std::mem::take(&mut memory.lock().unwrap_or_else(PoisonError::into_inner).art);
            let path = art(&url, &cache).await;
            memory.lock().unwrap_or_else(PoisonError::into_inner).art = cache;
            path
        }
        None => None,
    };
    let list = Value::List(players.iter().map(|p| player_value(p, None)).collect());
    Ok(vec![
        update(
            PLAYER,
            selected.map_or_else(
                || Value::unavailable("no-player"),
                |p| player_value(&p, art_path.as_deref()),
            ),
        ),
        update(PLAYERS, list),
    ])
}

async fn listen(conn: &Connection, wake: &Notify) -> Result<(), String> {
    let rules = [
        MatchRule::builder()
            .msg_type(zbus::message::Type::Signal)
            .interface("org.freedesktop.DBus.Properties")
            .member("PropertiesChanged")
            .path(PATH)
            .build(),
        MatchRule::builder()
            .msg_type(zbus::message::Type::Signal)
            .interface(PLAYER_IFACE)
            .member("Seeked")
            .build(),
        MatchRule::builder()
            .msg_type(zbus::message::Type::Signal)
            .sender("org.freedesktop.DBus")
            .interface("org.freedesktop.DBus")
            .member("NameOwnerChanged")
            .arg0ns(ROOT_IFACE)
            .build(),
    ];
    let mut streams = Vec::new();
    for rule in rules {
        let rule = rule.map_err(|e| e.to_string())?;
        streams.push(
            MessageStream::for_match_rule(rule, conn, None)
                .await
                .map_err(|e| e.to_string())?,
        );
    }
    let mut merged = futures_util::stream::select_all(streams);
    while merged.next().await.is_some() {
        wake.notify_one();
    }
    Err("MPRIS signal stream ended".into())
}

pub async fn run(hub: Arc<Hub>) -> Result<(), String> {
    let conn = Connection::session().await.map_err(|e| e.to_string())?;
    let wake = Notify::new();
    let memory = Arc::new(Mutex::new(Memory::default()));
    let watch = while_subscribed_notified(&hub, WATCH, PERIOD, &wake, || {
        let (conn, hub, memory) = (conn.clone(), hub.clone(), memory.clone());
        async move { fetch(&conn, &hub, &memory).await }
    });
    tokio::select! {
        r = watch => r,
        r = listen(&conn, &wake) => r,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaAction {
    Play,
    Pause,
    PlayPause,
    Next,
    Previous,
}

/// Sends a control to a player that is currently on the bus.
pub async fn control(bus: &str, action: MediaAction) -> Result<(), String> {
    let conn = Connection::session().await.map_err(|e| e.to_string())?;
    if !list_players(&conn).await?.iter().any(|p| p == bus) {
        return Err("unknown-player".into());
    }
    let method = match action {
        MediaAction::Play => "Play",
        MediaAction::Pause => "Pause",
        MediaAction::PlayPause => "PlayPause",
        MediaAction::Next => "Next",
        MediaAction::Previous => "Previous",
    };
    conn.call_method(Some(bus), PATH, Some(PLAYER_IFACE), method, &())
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Seeks to an absolute position in the current track.
pub async fn set_position(bus: &str, position_us: i64) -> Result<(), String> {
    let conn = Connection::session().await.map_err(|e| e.to_string())?;
    if !list_players(&conn).await?.iter().any(|p| p == bus) {
        return Err("unknown-player".into());
    }
    let raw = get_all(&conn, bus, PLAYER_IFACE).await?;
    let track = raw
        .get("Metadata")
        .and_then(|v| v.try_clone().ok())
        .and_then(|v| HashMap::<String, OwnedVariant>::try_from(v).ok())
        .and_then(|m| {
            m.get("mpris:trackid")
                .and_then(|t| <&zbus::ObjectPath<'_>>::try_from(t).ok())
                .map(|p| p.to_owned())
        })
        .ok_or("no-track")?;
    conn.call_method(
        Some(bus),
        PATH,
        Some(PLAYER_IFACE),
        "SetPosition",
        &(track, position_us.max(0)),
    )
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::panic)]

    use super::*;
    use crate::providers::props::Prop;

    fn props(pairs: &[(&str, Prop)]) -> Props {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_owned(), v.clone()))
            .collect()
    }

    fn player(bus: &str, status: &str) -> Player {
        Player {
            bus: bus.into(),
            root: props(&[("Identity", Prop::Str("Player".into()))]),
            player: props(&[
                ("PlaybackStatus", Prop::Str(status.into())),
                ("CanPause", Prop::Bool(true)),
            ]),
            metadata: props(&[
                ("xesam:title", Prop::Str("Song".into())),
                ("xesam:artist", Prop::Strs(vec!["A".into(), "B".into()])),
                ("mpris:length", Prop::Num(180_000_000.0)),
            ]),
            position_us: Some(1_000_000.0),
        }
    }

    #[test]
    fn playing_wins_then_most_recent() {
        let players = vec![
            player("org.mpris.MediaPlayer2.a", "Paused"),
            player("org.mpris.MediaPlayer2.b", "Playing"),
        ];
        assert_eq!(
            select(&players, &HashMap::new()).unwrap().bus,
            "org.mpris.MediaPlayer2.b"
        );
        let paused = vec![
            player("org.mpris.MediaPlayer2.a", "Paused"),
            player("org.mpris.MediaPlayer2.b", "Paused"),
        ];
        let mut active = HashMap::new();
        active.insert("org.mpris.MediaPlayer2.a".to_owned(), Instant::now());
        assert_eq!(
            select(&paused, &active).unwrap().bus,
            "org.mpris.MediaPlayer2.a"
        );
        assert!(select(&[], &active).is_none());
    }

    #[test]
    fn value_shape() {
        let Value::Map(m) = player_value(
            &player("org.mpris.MediaPlayer2.x", "Playing"),
            Some("/tmp/a.jpg"),
        ) else {
            panic!()
        };
        assert_eq!(m["title"], Value::from("Song"));
        assert_eq!(
            m["artists"],
            Value::List(vec![Value::from("A"), Value::from("B")])
        );
        assert_eq!(m["lengthUs"], Value::Num(180_000_000.0));
        assert_eq!(m["canPause"], Value::Bool(true));
        assert_eq!(m["canNext"], Value::Bool(false));
        assert_eq!(m["artPath"], Value::from("/tmp/a.jpg"));
    }

    #[test]
    fn file_urls_are_decoded() {
        assert_eq!(
            percent_decode("/home/u/Music/A%20B%C3%A4.jpg"),
            "/home/u/Music/A Bä.jpg"
        );
    }
}

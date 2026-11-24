//! Message types.
//!
//! Compatibility rule: new fields must be `#[serde(default)]` so that a peer one version
//! behind can still decode them; removing or retyping a field bumps
//! [`crate::PROTOCOL_VERSION`].

use serde::{Deserialize, Serialize};

/// A topic name such as `system.loadavg` or `cpu.load`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Topic(pub String);

impl Topic {
    pub fn new(name: impl Into<String>) -> Self {
        Self(name.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for Topic {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// Which kind of client is connecting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Role {
    Layer,
}

/// How urgently a subscriber needs fresh data (brief §5.4). The sampler runs each topic
/// at the fastest interval any subscriber asks for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ActivityClass {
    /// Screen locked or session idle.
    Idle,
    /// Layer covered by a maximized or fullscreen window.
    Covered,
    /// Widgets visible but dimmed.
    Ambient,
    /// Desktop focused, Peek, Edit or a detail view open.
    Interactive,
}

/// Which desktop-integration backend is placing the layer windows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BackendKind {
    /// The GNOME Shell helper spawns and places the layer (trusted Wayland client).
    Native,
    /// Core spawns the layer through Xwayland with keep-below hints.
    Instant,
}

/// One monitor as reported by `org.gnome.Mutter.DisplayConfig`, in logical pixels.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MonitorInfo {
    /// Stable layout key: `<vendor>-<product>-<serial>:<connector>`.
    pub key: String,
    /// Mutter connector name, e.g. `eDP-1`, `HDMI-2`.
    pub connector: String,
    pub vendor: String,
    pub product: String,
    pub serial: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
    pub primary: bool,
    pub builtin: bool,
    /// Work area `(x, y, width, height)` in logical pixels when supplied by the backend
    /// (Native mode queries the shell helper's `GetWorkAreas`).
    #[serde(default)]
    pub work_area: Option<(i32, i32, u32, u32)>,
}

impl MonitorInfo {
    /// Builds the layout key from the identity fields.
    pub fn make_key(vendor: &str, product: &str, serial: &str, connector: &str) -> String {
        format!("{vendor}-{product}-{serial}:{connector}")
    }
}

/// Why a value is missing. Codes are stable identifiers that the UI translates; they are
/// never shown raw.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum Availability {
    Unavailable { reason: String },
    Asleep,
    NeedsPermission { fix: String },
}

/// The value carried by a topic update.
///
/// Scalars and number arrays cover most topics; `List` and `Map` carry structured data (drives,
/// processes, containers) without a new message type per provider.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "v", rename_all = "kebab-case")]
pub enum Value {
    Num(f64),
    Nums(Vec<f64>),
    Text(String),
    Bool(bool),
    List(Vec<Value>),
    Map(std::collections::BTreeMap<String, Value>),
    Missing(Availability),
}

impl Value {
    /// The value's numbers if it's numeric, for history and alerts.
    pub fn numbers(&self) -> Option<&[f64]> {
        match self {
            Self::Num(v) => Some(std::slice::from_ref(v)),
            Self::Nums(v) => Some(v),
            _ => None,
        }
    }

    /// A `Missing(Unavailable)` value with a stable reason code.
    pub fn unavailable(reason: impl Into<String>) -> Self {
        Self::Missing(Availability::Unavailable {
            reason: reason.into(),
        })
    }

    /// Builds a `Map` from key/value pairs.
    pub fn map<K: Into<String>>(entries: impl IntoIterator<Item = (K, Value)>) -> Self {
        Self::Map(entries.into_iter().map(|(k, v)| (k.into(), v)).collect())
    }
}

impl From<f64> for Value {
    fn from(v: f64) -> Self {
        Self::Num(v)
    }
}

impl From<bool> for Value {
    fn from(v: bool) -> Self {
        Self::Bool(v)
    }
}

impl From<String> for Value {
    fn from(v: String) -> Self {
        Self::Text(v)
    }
}

impl From<&str> for Value {
    fn from(v: &str) -> Self {
        Self::Text(v.to_owned())
    }
}

impl<T: Into<Value>> From<Option<T>> for Value {
    /// `None` becomes "not reported" (the source exists but doesn't give this field).
    fn from(v: Option<T>) -> Self {
        v.map_or_else(|| Self::unavailable("not-reported"), Into::into)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TopicUpdate {
    pub topic: Topic,
    pub value: Value,
}

/// All topic changes from one sampler tick, sent as one frame.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UpdateBatch {
    pub seq: u64,
    /// Milliseconds since the Unix epoch when the tick was sampled.
    pub at_ms: u64,
    pub updates: Vec<TopicUpdate>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Hello {
    pub protocol: u16,
    pub role: Role,
    pub pid: u32,
    pub app_version: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Welcome {
    pub protocol: u16,
    pub core_version: String,
    pub backend: BackendKind,
    pub monitors: Vec<MonitorInfo>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RejectReason {
    ProtocolMismatch,
    HelloExpected,
}

/// Things that happen in core that the layer has to react to.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "kebab-case")]
pub enum CoreEvent {
    MonitorsChanged {
        monitors: Vec<MonitorInfo>,
    },
    PeekRequested,
    EditRequested,
    UpdatesPaused {
        paused: bool,
    },
    /// The user clicked "Open" on an alert notification: show that widget's detail.
    AlertOpened {
        rule: String,
    },
    /// Native mode: the desktop (or the layer) has focus, not an app window. Drives the
    /// Automatic appearance.
    DesktopFocusChanged {
        focused: bool,
    },
    /// Core switched between Instant and Native placement.
    BackendChanged {
        backend: BackendKind,
    },
    /// Native mode: one monitor's layer is covered by a maximized/fullscreen window (or uncovered).
    LayerCovered {
        connector: String,
        covered: bool,
    },
}

/// An action the layer asks core to perform. Core validates every one against its own current
/// listing before acting (ARCHITECTURE §3.7).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "cmd", rename_all = "kebab-case")]
pub enum Command {
    /// Eject removable media from a drive in `storage.drives` (block name, e.g. `sdb`).
    DriveEject { drive: String },
    /// Power off a drive (USB disks) so it can be unplugged safely.
    DrivePowerOff { drive: String },
    /// Switch the power profile to one listed in `power.profile`.
    SetPowerProfile { profile: String },
    /// Control an MPRIS player listed in `media.players` (bus name).
    Media { player: String, action: MediaAction },
    /// Seek a player to an absolute position.
    MediaSeek { player: String, position_us: i64 },
    /// SIGTERM (or SIGKILL with `force`) to one of the user's processes; `start` (from
    /// `processes.list`) guards against PID reuse.
    EndTask { pid: u32, start: u64, force: bool },
    /// Start, stop or restart a container from `docker.containers`.
    Container { id: String, action: ContainerAction },
    /// Start Docker Desktop (its systemd user unit).
    StartDockerDesktop,
    /// Change settings with a JSON merge patch (as a `Map`; a missing value clears a field).
    UpdateSettings { patch: Value },
    /// Search places for the weather location (Open-Meteo geocoding); answers with data.
    GeocodeSearch { query: String, language: String },
    /// The last `seconds` of a numeric series (`cpu.load`, `cpu.perThread#3`); answers with
    /// `{ stepS, values }`.
    History { series: String, seconds: u64 },
    /// Installed font families (fontconfig) for the font picker; answers with a list of names.
    ListFonts,
    /// Peek or Edit started (`true`) or ended: in Native mode core asks the helper to raise or
    /// lower the layer; in Instant mode the layer does it itself and this is a no-op.
    SetRaised { raised: bool },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ContainerAction {
    Start,
    Stop,
    Restart,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MediaAction {
    Play,
    Pause,
    PlayPause,
    Next,
    Previous,
}

/// How a command ended. `reason` is a stable code the UI translates.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "result", rename_all = "kebab-case")]
pub enum CommandResult {
    Ok,
    /// Success with an answer (search results and the like).
    Data {
        value: Value,
    },
    Err {
        reason: String,
    },
}

/// Messages from a client (the layer) to core.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "kebab-case")]
pub enum ClientMsg {
    Hello(Hello),
    Subscribe { topic: Topic, class: ActivityClass },
    Unsubscribe { topic: Topic },
    Command { id: u32, command: Command },
    Ping { nonce: u32 },
}

/// Messages from core to a client.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "kebab-case")]
pub enum ServerMsg {
    Welcome(Welcome),
    Rejected {
        reason: RejectReason,
        core_protocol: u16,
    },
    Update(UpdateBatch),
    Event(CoreEvent),
    CommandResult {
        id: u32,
        result: CommandResult,
    },
    Pong {
        nonce: u32,
    },
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;
    use crate::frame::{encode_message, read_frame};

    fn round_trip<T>(msg: &T) -> T
    where
        T: Serialize + serde::de::DeserializeOwned,
    {
        let mut buf = Vec::new();
        encode_message(msg, &mut buf).unwrap();
        let rt = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        rt.block_on(async {
            let mut slice: &[u8] = &buf;
            read_frame(&mut slice)
                .await
                .unwrap()
                .unwrap()
                .decode_message()
                .unwrap()
        })
    }

    fn monitor() -> MonitorInfo {
        MonitorInfo {
            key: MonitorInfo::make_key("AUO", "0x82ed", "0x00000000", "eDP-1"),
            connector: "eDP-1".into(),
            vendor: "AUO".into(),
            product: "0x82ed".into(),
            serial: "0x00000000".into(),
            x: 0,
            y: 0,
            width: 1536,
            height: 864,
            scale: 1.25,
            primary: true,
            builtin: true,
            work_area: Some((0, 32, 1536, 765)),
        }
    }

    #[test]
    fn every_server_message_round_trips() {
        let msgs = vec![
            ServerMsg::Welcome(Welcome {
                protocol: crate::PROTOCOL_VERSION,
                core_version: "0.1.0".into(),
                backend: BackendKind::Instant,
                monitors: vec![monitor()],
            }),
            ServerMsg::Rejected {
                reason: RejectReason::ProtocolMismatch,
                core_protocol: 1,
            },
            ServerMsg::Update(UpdateBatch {
                seq: 9,
                at_ms: 1_700_000_000_000,
                updates: vec![
                    TopicUpdate {
                        topic: Topic::new("system.loadavg"),
                        value: Value::Nums(vec![0.5, 0.4, 0.3]),
                    },
                    TopicUpdate {
                        topic: Topic::new("battery.percent"),
                        value: Value::Missing(Availability::Unavailable {
                            reason: "no-battery".into(),
                        }),
                    },
                    TopicUpdate {
                        topic: Topic::new("gpu.1.load"),
                        value: Value::Missing(Availability::Asleep),
                    },
                    TopicUpdate {
                        topic: Topic::new("storage.drives"),
                        value: Value::List(vec![Value::map([
                            ("name", Value::from("nvme0n1")),
                            ("removable", Value::Bool(false)),
                            ("tempC", Value::Num(41.0)),
                        ])]),
                    },
                ],
            }),
            ServerMsg::Event(CoreEvent::MonitorsChanged {
                monitors: vec![monitor()],
            }),
            ServerMsg::Event(CoreEvent::UpdatesPaused { paused: true }),
            ServerMsg::Event(CoreEvent::LayerCovered {
                connector: "eDP-1".into(),
                covered: true,
            }),
            ServerMsg::CommandResult {
                id: 7,
                result: CommandResult::Err {
                    reason: "not-supported".into(),
                },
            },
            ServerMsg::Pong { nonce: 3 },
        ];
        for msg in msgs {
            assert_eq!(round_trip(&msg), msg);
        }
    }

    #[test]
    fn every_client_message_round_trips() {
        let msgs = vec![
            ClientMsg::Hello(Hello {
                protocol: crate::PROTOCOL_VERSION,
                role: Role::Layer,
                pid: 1,
                app_version: "0.1.0".into(),
            }),
            ClientMsg::Subscribe {
                topic: Topic::new("cpu.load"),
                class: ActivityClass::Ambient,
            },
            ClientMsg::Unsubscribe {
                topic: Topic::new("cpu.load"),
            },
            ClientMsg::Command {
                id: 7,
                command: Command::DriveEject {
                    drive: "sdb".into(),
                },
            },
            ClientMsg::Ping { nonce: 1 },
        ];
        for msg in msgs {
            assert_eq!(round_trip(&msg), msg);
        }
    }

    #[test]
    fn activity_classes_order_from_idle_to_interactive() {
        assert!(ActivityClass::Idle < ActivityClass::Covered);
        assert!(ActivityClass::Covered < ActivityClass::Ambient);
        assert!(ActivityClass::Ambient < ActivityClass::Interactive);
    }
}

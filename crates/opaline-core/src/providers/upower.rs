//! Battery and power: UPower (battery, AC adapter, peripheral batteries) and power profiles,
//! event-driven through `PropertiesChanged` (brief §6 "Battery and power"). Also sets the hub's
//! Eco flag (on battery with the power-saver profile → every interval doubles).

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use opaline_ipc::{TopicUpdate, Value};
use tokio::sync::Notify;
use zbus::{Connection, MatchRule, MessageStream, OwnedVariant, Variant};

use super::props::{Props, PropsExt, from_variants};
use crate::engine::{update, while_subscribed_notified};
use crate::hub::Hub;

pub const BATTERY: &str = "power.battery";
pub const BATTERY_PERCENT: &str = "power.batteryPercent";
pub const AC: &str = "power.ac";
pub const PROFILE: &str = "power.profile";
pub const PERIPHERALS: &str = "power.peripherals";
pub const TOPICS: &[&str] = &[BATTERY, BATTERY_PERCENT, AC, PROFILE, PERIPHERALS];

/// Safety net in case a signal is missed; changes normally arrive as signals.
const PERIOD: Duration = Duration::from_secs(60);

const UPOWER: &str = "org.freedesktop.UPower";
/// Power profiles moved into UPower's name; older systems only have the hadess one.
const PROFILES: [(&str, &str, &str); 2] = [
    (
        "org.freedesktop.UPower.PowerProfiles",
        "/org/freedesktop/UPower/PowerProfiles",
        "org.freedesktop.UPower.PowerProfiles",
    ),
    (
        "net.hadess.PowerProfiles",
        "/net/hadess/PowerProfiles",
        "net.hadess.PowerProfiles",
    ),
];
const STANDARD_PROFILES: [&str; 3] = ["power-saver", "balanced", "performance"];

/// UPower device types (`Type`).
fn kind_name(t: f64) -> &'static str {
    match t as u32 {
        1 => "line-power",
        2 => "battery",
        3 => "ups",
        4 => "monitor",
        5 => "mouse",
        6 => "keyboard",
        7 => "pda",
        8 => "phone",
        9 => "media-player",
        10 => "tablet",
        11 => "computer",
        12 => "gaming-input",
        13 => "pen",
        14 => "touchpad",
        15 => "modem",
        16 => "network",
        17 => "headset",
        18 => "speakers",
        19 => "headphones",
        20 => "video",
        21 => "other-audio",
        22 => "remote-control",
        23 => "printer",
        24 => "scanner",
        25 => "camera",
        26 => "wearable",
        27 => "toy",
        28 => "bluetooth-generic",
        _ => "unknown",
    }
}

fn state_name(s: f64) -> &'static str {
    match s as u32 {
        1 => "charging",
        2 => "discharging",
        3 => "empty",
        4 => "full",
        5 => "pending-charge",
        6 => "pending-discharge",
        _ => "unknown",
    }
}

fn positive(v: Option<f64>) -> Value {
    Value::from(v.filter(|v| *v > 0.0))
}

/// The laptop battery (or batteries, merged by UPower's DisplayDevice) as one value.
pub fn battery_value(dev: &Props) -> Value {
    let full = dev.num("EnergyFull");
    let design = dev.num("EnergyFullDesign");
    let capacity = match (full, design) {
        (Some(f), Some(d)) if d > 0.0 => Some((f / d * 100.0).min(100.0)),
        _ => dev.num("Capacity").filter(|c| *c > 0.0),
    };
    Value::map([
        ("percent", Value::from(dev.num("Percentage"))),
        (
            "state",
            Value::from(state_name(dev.num("State").unwrap_or(0.0))),
        ),
        ("rateW", Value::from(dev.num("EnergyRate"))),
        ("timeToEmptyS", positive(dev.num("TimeToEmpty"))),
        ("timeToFullS", positive(dev.num("TimeToFull"))),
        ("energyWh", positive(dev.num("Energy"))),
        ("energyFullWh", positive(full)),
        ("designWh", positive(design)),
        ("capacityPercent", Value::from(capacity)),
        // -1 = the battery doesn't report cycles.
        (
            "cycles",
            Value::from(dev.num("ChargeCycles").filter(|c| *c >= 0.0)),
        ),
        (
            "vendor",
            Value::from(
                dev.str("Vendor")
                    .filter(|v| !v.is_empty())
                    .map(str::to_owned),
            ),
        ),
        (
            "model",
            Value::from(
                dev.str("Model")
                    .filter(|v| !v.is_empty())
                    .map(str::to_owned),
            ),
        ),
    ])
}

/// What one fetch read: every UPower device and the power-profile state.
#[derive(Debug, Clone, Default)]
pub struct State {
    pub devices: Vec<Props>,
    pub active_profile: Option<String>,
    pub profiles: Vec<String>,
}

pub fn values(s: &State) -> Vec<TopicUpdate> {
    let kind = |d: &Props| kind_name(d.num("Type").unwrap_or(0.0));
    let battery = s.devices.iter().find(|d| {
        kind(d) == "battery"
            && d.flag("PowerSupply").unwrap_or(false)
            && d.flag("IsPresent").unwrap_or(true)
    });
    let line = s.devices.iter().find(|d| kind(d) == "line-power");
    let mut out = vec![
        update(
            BATTERY,
            battery.map_or_else(|| Value::unavailable("no-battery"), battery_value),
        ),
        update(
            BATTERY_PERCENT,
            battery
                .and_then(|b| b.num("Percentage"))
                .map_or_else(|| Value::unavailable("no-battery"), Value::Num),
        ),
        update(
            AC,
            line.map_or_else(
                || Value::unavailable("no-ac-adapter"),
                |l| Value::Bool(l.flag("Online").unwrap_or(false)),
            ),
        ),
    ];
    let peripherals: Vec<Value> = s
        .devices
        .iter()
        .filter(|d| {
            !d.flag("PowerSupply").unwrap_or(false)
                && !matches!(kind(d), "line-power" | "battery" | "ups")
        })
        .filter(|d| d.flag("IsPresent").unwrap_or(true))
        .map(|d| {
            Value::map([
                ("kind", Value::from(kind(d))),
                (
                    "model",
                    Value::from(d.str("Model").filter(|m| !m.is_empty()).map(str::to_owned)),
                ),
                ("percent", Value::from(d.num("Percentage"))),
                (
                    "state",
                    Value::from(state_name(d.num("State").unwrap_or(0.0))),
                ),
            ])
        })
        .collect();
    out.push(update(PERIPHERALS, Value::List(peripherals)));
    out.push(update(
        PROFILE,
        match &s.active_profile {
            Some(active) => Value::map([
                ("active", Value::from(active.as_str())),
                (
                    "available",
                    Value::List(s.profiles.iter().map(|p| Value::from(p.as_str())).collect()),
                ),
            ]),
            None => Value::unavailable("power-profiles-unavailable"),
        },
    ));
    out
}

/// On battery with the power-saver profile (brief §5.4).
pub fn eco(s: &State) -> bool {
    let on_battery = s.devices.iter().any(|d| {
        kind_name(d.num("Type").unwrap_or(0.0)) == "line-power" && d.flag("Online") == Some(false)
    });
    on_battery && s.active_profile.as_deref() == Some("power-saver")
}

async fn call<B: serde::Serialize + zbus::wire::DynamicType>(
    conn: &Connection,
    dest: &str,
    path: &str,
    iface: &str,
    method: &str,
    body: &B,
) -> Result<zbus::Message, String> {
    conn.call_method(Some(dest), path, Some(iface), method, body)
        .await
        .map_err(|e| e.to_string())
}

async fn get_all_raw(
    conn: &Connection,
    dest: &str,
    path: &str,
    iface: &str,
) -> Result<HashMap<String, OwnedVariant>, String> {
    call(
        conn,
        dest,
        path,
        "org.freedesktop.DBus.Properties",
        "GetAll",
        &(iface,),
    )
    .await?
    .body()
    .deserialize()
    .map_err(|e| e.to_string())
}

/// Reads the active profile and the profile names from whichever service exists.
async fn profiles(conn: &Connection) -> (Option<String>, Vec<String>) {
    for (dest, path, iface) in PROFILES {
        let Ok(raw) = get_all_raw(conn, dest, path, iface).await else {
            continue;
        };
        let active = raw
            .get("ActiveProfile")
            .and_then(|v| <&str>::try_from(v).ok())
            .map(str::to_owned);
        let names: Vec<String> = raw
            .get("Profiles")
            .and_then(|v| v.try_clone().ok())
            .and_then(|v| Vec::<HashMap<String, OwnedVariant>>::try_from(v).ok())
            .map(|list| {
                list.iter()
                    .filter_map(|p| {
                        p.get("Profile")
                            .and_then(|v| <&str>::try_from(v).ok())
                            .map(str::to_owned)
                    })
                    .collect()
            })
            .unwrap_or_else(|| STANDARD_PROFILES.iter().map(|s| (*s).to_owned()).collect());
        return (active, names);
    }
    (None, Vec::new())
}

async fn fetch(conn: &Connection, hub: &Hub) -> Result<Vec<TopicUpdate>, String> {
    let paths: Vec<zbus::OwnedObjectPath> = call(
        conn,
        UPOWER,
        "/org/freedesktop/UPower",
        UPOWER,
        "EnumerateDevices",
        &(),
    )
    .await?
    .body()
    .deserialize()
    .map_err(|e| e.to_string())?;
    let mut devices = Vec::new();
    for path in &paths {
        if let Ok(raw) =
            get_all_raw(conn, UPOWER, path.as_str(), "org.freedesktop.UPower.Device").await
        {
            devices.push(from_variants(&raw));
        }
    }
    let (active_profile, profiles) = profiles(conn).await;
    let state = State {
        devices,
        active_profile,
        profiles,
    };
    hub.set_eco(eco(&state));
    Ok(values(&state))
}

/// Notifies `wake` on every `PropertiesChanged` from UPower or the power-profiles daemon.
async fn listen(conn: &Connection, wake: &Notify) -> Result<(), String> {
    let mut streams = Vec::new();
    for sender in [UPOWER, PROFILES[0].0, PROFILES[1].0] {
        let rule = MatchRule::builder()
            .msg_type(zbus::message::Type::Signal)
            .sender(sender)
            .interface("org.freedesktop.DBus.Properties")
            .member("PropertiesChanged")
            .build()
            .map_err(|e| e.to_string())?;
        if let Ok(stream) = MessageStream::for_match_rule(rule, conn, None).await {
            streams.push(stream);
        }
    }
    let mut merged = futures_util::stream::select_all(streams);
    while merged.next().await.is_some() {
        wake.notify_one();
    }
    Err("UPower signal stream ended".into())
}

pub async fn run(hub: Arc<Hub>) -> Result<(), String> {
    let conn = Connection::system().await.map_err(|e| e.to_string())?;
    let wake = Notify::new();
    let watch = while_subscribed_notified(&hub, TOPICS, PERIOD, &wake, || {
        let conn = conn.clone();
        let hub = hub.clone();
        async move { fetch(&conn, &hub).await }
    });
    tokio::select! {
        r = watch => r,
        r = listen(&conn, &wake) => r,
    }
}

/// Switches the power profile (the power-mode command). Only names the daemon listed.
pub async fn set_profile(profile: &str) -> Result<(), String> {
    let conn = Connection::system().await.map_err(|e| e.to_string())?;
    let (_, available) = profiles(&conn).await;
    if !available.iter().any(|p| p == profile) {
        return Err("unknown-profile".into());
    }
    for (dest, path, iface) in PROFILES {
        let body = (iface, "ActiveProfile", Variant::from(profile));
        if call(
            &conn,
            dest,
            path,
            "org.freedesktop.DBus.Properties",
            "Set",
            &body,
        )
        .await
        .is_ok()
        {
            return Ok(());
        }
    }
    Err("power-profiles-unavailable".into())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::panic, clippy::float_cmp)]

    use super::*;
    use crate::providers::props::{Prop, fixture};

    fn get<'a>(v: &'a [TopicUpdate], topic: &str) -> &'a Value {
        &v.iter().find(|u| u.topic.as_str() == topic).unwrap().value
    }

    fn field<'a>(v: &'a Value, key: &str) -> &'a Value {
        match v {
            Value::Map(m) => m.get(key).unwrap_or_else(|| panic!("no {key} in {m:?}")),
            other => panic!("not a map: {other:?}"),
        }
    }

    fn reference() -> State {
        let m = "hp-i5-10300h";
        State {
            devices: vec![
                fixture::get_all(m, "upower-battery_BAT1"),
                fixture::get_all(m, "upower-line_power_ACAD"),
            ],
            active_profile: Some("performance".into()),
            profiles: STANDARD_PROFILES.iter().map(|s| (*s).to_owned()).collect(),
        }
    }

    #[test]
    fn reference_laptop_battery() {
        let v = values(&reference());
        let b = get(&v, BATTERY);
        let Value::Num(capacity) = field(b, "capacityPercent") else {
            panic!()
        };
        assert!(
            (capacity - 75.0).abs() < 1.0,
            "39.38 of 52.5 Wh ≈ 75 % ({capacity})"
        );
        assert_eq!(field(b, "cycles"), &Value::unavailable("not-reported"));
        assert_eq!(get(&v, AC), &Value::Bool(true));
        assert_eq!(get(&v, PERIPHERALS), &Value::List(Vec::new()));
        assert_eq!(
            field(get(&v, PROFILE), "active"),
            &Value::from("performance")
        );
        assert!(!eco(&reference()), "on AC, so no Eco");
    }

    #[test]
    fn eco_needs_battery_and_power_saver() {
        let mut s = reference();
        s.active_profile = Some("power-saver".into());
        assert!(!eco(&s));
        for d in &mut s.devices {
            if d.num("Type") == Some(1.0) {
                d.insert("Online".into(), Prop::Bool(false));
            }
        }
        assert!(eco(&s));
    }

    #[test]
    fn desktop_without_battery_and_a_mouse() {
        let mouse: Props = [
            ("Type", Prop::Num(5.0)),
            ("PowerSupply", Prop::Bool(false)),
            ("Model", Prop::Str("MX Master 3".into())),
            ("Percentage", Prop::Num(55.0)),
            ("State", Prop::Num(2.0)),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_owned(), v))
        .collect();
        let v = values(&State {
            devices: vec![mouse],
            active_profile: None,
            profiles: Vec::new(),
        });
        assert_eq!(get(&v, BATTERY), &Value::unavailable("no-battery"));
        assert_eq!(get(&v, AC), &Value::unavailable("no-ac-adapter"));
        assert_eq!(
            get(&v, PROFILE),
            &Value::unavailable("power-profiles-unavailable")
        );
        let Value::List(p) = get(&v, PERIPHERALS) else {
            panic!()
        };
        assert_eq!(field(&p[0], "kind"), &Value::from("mouse"));
        assert_eq!(field(&p[0], "percent"), &Value::Num(55.0));
    }
}

//! NetworkManager: Wi-Fi (SSID, signal, band, bitrate), VPN/WireGuard, connectivity and the
//! primary connection (brief §6 "Network").

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use opaline_ipc::{TopicUpdate, Value};
use zbus::{Connection, OwnedVariant};

use super::props::{Props, PropsExt, from_variants};
use crate::engine::{update, while_subscribed};
use crate::hub::Hub;

pub const WIFI: &str = "network.wifi";
pub const CONNECTIVITY: &str = "network.connectivity";
pub const VPN: &str = "network.vpn";
pub const PRIMARY: &str = "network.primary";
pub const TOPICS: &[&str] = &[WIFI, CONNECTIVITY, VPN, PRIMARY];

/// Signal strength changes slowly; 5 s while visible is plenty.
const PERIOD: Duration = Duration::from_secs(5);

const SERVICE: &str = "org.freedesktop.NetworkManager";
const ROOT: &str = "/org/freedesktop/NetworkManager";
const DEVICE_WIFI: f64 = 2.0;

/// What one fetch read from NetworkManager.
#[derive(Debug, Clone, Default)]
pub struct State {
    pub root: Props,
    /// Device properties by object path, with the wireless properties if it's Wi-Fi.
    pub devices: HashMap<String, (Props, Option<Props>)>,
    pub active: Vec<Props>,
    /// Access point properties by object path.
    pub access_points: HashMap<String, Props>,
}

pub fn connectivity_name(code: f64) -> &'static str {
    match code as u32 {
        1 => "none",
        2 => "portal",
        3 => "limited",
        4 => "full",
        _ => "unknown",
    }
}

/// Wi-Fi band from the channel frequency.
pub fn band(mhz: f64) -> &'static str {
    if mhz >= 5925.0 {
        "6 GHz"
    } else if mhz >= 4900.0 {
        "5 GHz"
    } else {
        "2.4 GHz"
    }
}

pub fn values(s: &State) -> Vec<TopicUpdate> {
    let mut out = vec![update(
        CONNECTIVITY,
        connectivity_name(s.root.num("Connectivity").unwrap_or(0.0)),
    )];

    let wifi = s.devices.values().find(|(dev, wireless)| {
        dev.num("DeviceType") == Some(DEVICE_WIFI)
            && wireless.is_some()
            && dev.num("State") == Some(100.0)
    });
    let wifi_value = match wifi {
        Some((dev, Some(wireless))) => {
            let ap = wireless
                .str("ActiveAccessPoint")
                .and_then(|p| s.access_points.get(p));
            match ap {
                Some(ap) => {
                    let freq = ap.num("Frequency");
                    Value::map([
                        (
                            "interface",
                            Value::from(dev.str("Interface").map(str::to_owned)),
                        ),
                        (
                            "ssid",
                            Value::from(ap.get("Ssid").and_then(super::props::Prop::as_bytes_str)),
                        ),
                        ("signal", Value::from(ap.num("Strength"))),
                        ("freqMHz", Value::from(freq)),
                        ("band", Value::from(freq.map(band))),
                        // NM reports kbit/s.
                        (
                            "bitrateMbps",
                            Value::from(wireless.num("Bitrate").map(|k| k / 1000.0)),
                        ),
                    ])
                }
                None => Value::unavailable("wifi-not-connected"),
            }
        }
        _ => Value::unavailable("wifi-not-connected"),
    };
    out.push(update(WIFI, wifi_value));

    let vpns: Vec<Value> = s
        .active
        .iter()
        .filter(|a| {
            a.flag("Vpn").unwrap_or(false) || matches!(a.str("Type"), Some("wireguard" | "vpn"))
        })
        .map(|a| {
            Value::map([
                ("name", Value::from(a.str("Id").map(str::to_owned))),
                ("type", Value::from(a.str("Type").map(str::to_owned))),
            ])
        })
        .collect();
    out.push(update(
        VPN,
        Value::map([
            ("active", Value::Bool(!vpns.is_empty())),
            ("connections", Value::List(vpns)),
        ]),
    ));

    let primary = s
        .root
        .str("PrimaryConnectionType")
        .filter(|t| !t.is_empty());
    out.push(update(
        PRIMARY,
        match primary {
            Some(t) => Value::map([(
                "type",
                Value::from(match t {
                    "802-11-wireless" => "wifi",
                    "802-3-ethernet" => "ethernet",
                    "wireguard" | "vpn" => "vpn",
                    "gsm" | "cdma" => "mobile",
                    "bluetooth" => "bluetooth",
                    other => other,
                }),
            )]),
            None => Value::unavailable("offline"),
        },
    ));
    out
}

async fn get_all(conn: &Connection, path: &str, iface: &str) -> Result<Props, String> {
    let reply = conn
        .call_method(
            Some(SERVICE),
            path,
            Some("org.freedesktop.DBus.Properties"),
            "GetAll",
            &(iface,),
        )
        .await
        .map_err(|e| e.to_string())?;
    let props: HashMap<String, OwnedVariant> =
        reply.body().deserialize().map_err(|e| e.to_string())?;
    Ok(from_variants(&props))
}

async fn fetch(conn: &Connection) -> Result<Vec<TopicUpdate>, String> {
    let root = get_all(conn, ROOT, SERVICE).await?;
    let mut state = State {
        devices: HashMap::new(),
        active: Vec::new(),
        access_points: HashMap::new(),
        root,
    };
    for path in state.root.strs("Devices") {
        let Ok(dev) = get_all(conn, &path, "org.freedesktop.NetworkManager.Device").await else {
            continue;
        };
        let wireless = if dev.num("DeviceType") == Some(DEVICE_WIFI) {
            get_all(
                conn,
                &path,
                "org.freedesktop.NetworkManager.Device.Wireless",
            )
            .await
            .ok()
        } else {
            None
        };
        if let Some(ap) = wireless
            .as_ref()
            .and_then(|w| w.str("ActiveAccessPoint"))
            .filter(|p| *p != "/")
            && let Ok(props) = get_all(conn, ap, "org.freedesktop.NetworkManager.AccessPoint").await
        {
            state.access_points.insert(ap.to_owned(), props);
        }
        state.devices.insert(path, (dev, wireless));
    }
    for path in state.root.strs("ActiveConnections") {
        if let Ok(a) = get_all(
            conn,
            &path,
            "org.freedesktop.NetworkManager.Connection.Active",
        )
        .await
        {
            state.active.push(a);
        }
    }
    Ok(values(&state))
}

pub async fn run(hub: Arc<Hub>) -> Result<(), String> {
    let conn = Connection::system().await.map_err(|e| e.to_string())?;
    while_subscribed(&hub, TOPICS, PERIOD, || {
        let conn = conn.clone();
        async move { fetch(&conn).await }
    })
    .await
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::panic)]

    use super::*;
    use crate::providers::props::fixture;

    fn reference_state() -> State {
        let m = "hp-i5-10300h";
        let mut devices = HashMap::new();
        for n in [1, 2, 3, 5] {
            let dev = fixture::get_all(m, &format!("nm-device-{n}"));
            let wireless = (n == 3).then(|| fixture::get_all(m, "nm-device-3-wireless"));
            devices.insert(
                format!("/org/freedesktop/NetworkManager/Devices/{n}"),
                (dev, wireless),
            );
        }
        State {
            root: fixture::get_all(m, "nm"),
            devices,
            active: vec![
                fixture::get_all(m, "nm-active-1"),
                fixture::get_all(m, "nm-active-3"),
            ],
            access_points: [(
                "/org/freedesktop/NetworkManager/AccessPoint/2213".to_owned(),
                fixture::get_all(m, "nm-ap-2213"),
            )]
            .into_iter()
            .collect(),
        }
    }

    fn get<'a>(v: &'a [TopicUpdate], topic: &str) -> &'a Value {
        &v.iter().find(|u| u.topic.as_str() == topic).unwrap().value
    }

    fn field<'a>(v: &'a Value, key: &str) -> &'a Value {
        match v {
            Value::Map(m) => m.get(key).unwrap_or_else(|| panic!("no {key} in {m:?}")),
            other => panic!("not a map: {other:?}"),
        }
    }

    #[test]
    fn reference_laptop_wifi() {
        let v = values(&reference_state());
        assert_eq!(get(&v, CONNECTIVITY), &Value::from("full"));
        let wifi = get(&v, WIFI);
        assert_eq!(field(wifi, "interface"), &Value::from("wlo1"));
        assert_eq!(field(wifi, "ssid"), &Value::from("redacted"));
        assert_eq!(field(wifi, "signal"), &Value::Num(66.0));
        assert_eq!(field(wifi, "band"), &Value::from("5 GHz"));
        assert_eq!(field(wifi, "bitrateMbps"), &Value::Num(866.7));
        assert_eq!(field(get(&v, VPN), "active"), &Value::Bool(false));
        assert_eq!(field(get(&v, PRIMARY), "type"), &Value::from("wifi"));
    }

    #[test]
    fn bands() {
        assert_eq!(band(2412.0), "2.4 GHz");
        assert_eq!(band(5260.0), "5 GHz");
        assert_eq!(band(5975.0), "6 GHz");
    }
}

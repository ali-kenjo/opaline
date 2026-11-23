//! UDisks2: drive health (NVMe and ATA SMART, unprivileged on this machine, ADR 0004), full
//! model names, and the eject / power-off commands (brief §6 "Storage").

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use opaline_ipc::{TopicUpdate, Value};
use zbus::{Connection, OwnedVariant, Variant};

use super::props::{Objects, Props, PropsExt, from_variants};
use crate::engine::{update, while_subscribed};
use crate::hub::Hub;

pub const HEALTH: &str = "storage.health";
/// UDisks2 itself refreshes SMART data every 10 minutes.
const PERIOD: Duration = Duration::from_secs(600);

const SERVICE: &str = "org.freedesktop.UDisks2";
const DRIVE: &str = "org.freedesktop.UDisks2.Drive";
const BLOCK: &str = "org.freedesktop.UDisks2.Block";
const PARTITION: &str = "org.freedesktop.UDisks2.Partition";
const NVME: &str = "org.freedesktop.UDisks2.NVMe.Controller";
const ATA: &str = "org.freedesktop.UDisks2.Drive.Ata";

#[derive(Debug, Clone, PartialEq)]
pub struct DriveInfo {
    pub path: String,
    /// Whole-disk block device name (`nvme0n1`, `sda`).
    pub block: Option<String>,
    pub model: Option<String>,
    pub bus: Option<String>,
    pub removable: bool,
    pub ejectable: bool,
    pub can_power_off: bool,
    pub nvme: Option<Props>,
    pub ata: Option<Props>,
    /// `SmartGetAttributes` of an NVMe controller.
    pub nvme_attrs: Option<Props>,
}

/// Drives in a `GetManagedObjects` reply, with their whole-disk block device.
pub fn drives(objects: &Objects) -> Vec<DriveInfo> {
    let blocks: HashMap<&str, String> = objects
        .values()
        .filter(|ifaces| !ifaces.contains_key(PARTITION))
        .filter_map(|ifaces| {
            let block = ifaces.get(BLOCK)?;
            let drive = block.str("Drive").filter(|d| *d != "/")?;
            let device = block.get("Device")?.as_bytes_str()?;
            Some((drive, device.trim_start_matches("/dev/").to_owned()))
        })
        .collect();
    objects
        .iter()
        .filter_map(|(path, ifaces)| {
            let drive = ifaces.get(DRIVE)?;
            Some(DriveInfo {
                path: path.clone(),
                block: blocks.get(path.as_str()).cloned(),
                model: drive
                    .str("Model")
                    .filter(|m| !m.is_empty())
                    .map(str::to_owned),
                bus: drive
                    .str("ConnectionBus")
                    .filter(|b| !b.is_empty())
                    .map(str::to_owned),
                removable: drive.flag("Removable").unwrap_or(false),
                ejectable: drive.flag("Ejectable").unwrap_or(false),
                can_power_off: drive.flag("CanPowerOff").unwrap_or(false),
                nvme: ifaces.get(NVME).cloned(),
                ata: ifaces.get(ATA).cloned(),
                nvme_attrs: None,
            })
        })
        .collect()
}

fn kelvin_to_c(k: f64) -> f64 {
    k - 273.15
}

/// One drive's health as shown in the storage widget's detail view.
pub fn health_value(d: &DriveInfo) -> Value {
    let mut e: Vec<(&str, Value)> = vec![
        ("model", Value::from(d.model.clone())),
        ("bus", Value::from(d.bus.clone())),
        ("removable", Value::Bool(d.removable)),
        ("ejectable", Value::Bool(d.ejectable)),
        ("canPowerOff", Value::Bool(d.can_power_off)),
    ];
    let mut warnings: Vec<Value> = Vec::new();
    let status = if let Some(n) = &d.nvme {
        let critical = n.strs("SmartCriticalWarning");
        if let Some(t) = n.num("SmartTemperature").filter(|t| *t > 0.0) {
            e.push(("tempC", Value::Num(kelvin_to_c(t))));
        }
        if let Some(h) = n.num("SmartPowerOnHours") {
            e.push(("powerOnHours", Value::Num(h)));
        }
        let a = d.nvme_attrs.as_ref();
        let attr = |k: &str| a.and_then(|a| a.num(k));
        let percent_used = attr("percent_used");
        let spare = attr("avail_spare");
        let spare_thresh = attr("spare_thresh");
        let media_errors = attr("media_errors");
        for (key, v) in [
            ("percentUsed", percent_used),
            ("availableSpare", spare),
            ("spareThreshold", spare_thresh),
            ("mediaErrors", media_errors),
            ("unsafeShutdowns", attr("unsafe_shutdowns")),
            ("powerCycles", attr("power_cycles")),
        ] {
            if let Some(v) = v {
                e.push((key, Value::Num(v)));
            }
        }
        // UDisks2 already converts NVMe data units (1000 × 512 bytes) to bytes.
        if let Some(bytes) = attr("total_data_written") {
            e.push(("writtenB", Value::Num(bytes)));
        }
        warnings.extend(critical.iter().map(|w| Value::from(w.as_str())));
        let low_spare = matches!((spare, spare_thresh), (Some(s), Some(t)) if s < t);
        if low_spare {
            warnings.push(Value::from("spare-below-threshold"));
        }
        if !critical.is_empty() || low_spare {
            "failing"
        } else if percent_used.is_some_and(|p| p >= 90.0) || media_errors.is_some_and(|m| m > 0.0) {
            if percent_used.is_some_and(|p| p >= 90.0) {
                warnings.push(Value::from("wear-high"));
            }
            if media_errors.is_some_and(|m| m > 0.0) {
                warnings.push(Value::from("media-errors"));
            }
            "warning"
        } else {
            "good"
        }
    } else if let Some(a) = &d.ata {
        let supported = a.flag("SmartSupported").unwrap_or(false);
        let enabled = a.flag("SmartEnabled").unwrap_or(false);
        if let Some(t) = a.num("SmartTemperature").filter(|t| *t > 0.0) {
            e.push(("tempC", Value::Num(kelvin_to_c(t))));
        }
        if let Some(s) = a.num("SmartPowerOnSeconds").filter(|s| *s > 0.0) {
            e.push(("powerOnHours", Value::Num((s / 3600.0).floor())));
        }
        let bad = a.num("SmartNumBadSectors").filter(|b| *b >= 0.0);
        let failing_attrs = a.num("SmartNumAttributesFailing").filter(|f| *f >= 0.0);
        if let Some(b) = bad {
            e.push(("badSectors", Value::Num(b)));
        }
        if let Some(f) = failing_attrs {
            e.push(("failingAttributes", Value::Num(f)));
        }
        if !supported || !enabled {
            warnings.push(Value::from(if supported {
                "smart-disabled"
            } else {
                "smart-unsupported"
            }));
            "unknown"
        } else if a.flag("SmartFailing").unwrap_or(false) {
            warnings.push(Value::from("smart-failing"));
            "failing"
        } else if bad.is_some_and(|b| b > 0.0) || failing_attrs.is_some_and(|f| f > 0.0) {
            if bad.is_some_and(|b| b > 0.0) {
                warnings.push(Value::from("bad-sectors"));
            }
            if failing_attrs.is_some_and(|f| f > 0.0) {
                warnings.push(Value::from("attributes-failing"));
            }
            "warning"
        } else {
            "good"
        }
    } else {
        warnings.push(Value::from("smart-unsupported"));
        "unknown"
    };
    e.push(("status", Value::from(status)));
    e.push(("warnings", Value::List(warnings)));
    Value::map(e)
}

/// Drives seen in the last listing, by block name, so commands only act on known drives.
#[derive(Debug, Clone)]
struct Known {
    path: String,
    ejectable: bool,
    can_power_off: bool,
}

static KNOWN: Mutex<BTreeMap<String, Known>> = Mutex::new(BTreeMap::new());

fn remember(drives: &[DriveInfo]) {
    let mut known = KNOWN.lock().unwrap_or_else(PoisonError::into_inner);
    known.clear();
    for d in drives {
        if let Some(block) = &d.block {
            known.insert(
                block.clone(),
                Known {
                    path: d.path.clone(),
                    ejectable: d.ejectable,
                    can_power_off: d.can_power_off,
                },
            );
        }
    }
}

async fn objects(conn: &Connection) -> Result<Objects, String> {
    let proxy = zbus::fdo::ObjectManagerProxy::builder(conn)
        .destination(SERVICE)
        .path("/org/freedesktop/UDisks2")
        .build()
        .await
        .map_err(|e| e.to_string())?;
    let managed = proxy
        .get_managed_objects()
        .await
        .map_err(|e| e.to_string())?;
    Ok(managed
        .iter()
        .map(|(path, ifaces)| {
            let ifaces = ifaces
                .iter()
                .map(|(name, props)| (name.to_string(), from_variants(props)))
                .collect();
            (path.to_string(), ifaces)
        })
        .collect())
}

async fn nvme_attributes(conn: &Connection, path: &str) -> Option<Props> {
    let options: HashMap<&str, Variant<'_>> = HashMap::new();
    let reply = conn
        .call_method(
            Some(SERVICE),
            path,
            Some(NVME),
            "SmartGetAttributes",
            &(options,),
        )
        .await
        .ok()?;
    let attrs: HashMap<String, OwnedVariant> = reply.body().deserialize().ok()?;
    Some(from_variants(&attrs))
}

async fn fetch(conn: &Connection) -> Result<Vec<TopicUpdate>, String> {
    let objects = objects(conn).await?;
    let mut list = drives(&objects);
    for d in &mut list {
        if d.nvme.is_some() {
            d.nvme_attrs = nvme_attributes(conn, &d.path).await;
        }
    }
    remember(&list);
    let map: BTreeMap<String, Value> = list
        .iter()
        .filter_map(|d| Some((d.block.clone()?, health_value(d))))
        .collect();
    Ok(vec![update(HEALTH, Value::Map(map))])
}

/// The supervised task: publishes `storage.health` while someone is subscribed.
pub async fn run(hub: Arc<Hub>) -> Result<(), String> {
    let conn = Connection::system().await.map_err(|e| e.to_string())?;
    while_subscribed(&hub, &[HEALTH], PERIOD, || {
        let conn = conn.clone();
        async move { fetch(&conn).await }
    })
    .await
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DriveAction {
    Eject,
    PowerOff,
}

/// Ejects or powers off a drive from the current listing. UDisks2 asks polkit, which may show
/// a password prompt for internal drives.
pub async fn drive_action(block: &str, action: DriveAction) -> Result<(), String> {
    let known = KNOWN
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get(block)
        .cloned()
        .ok_or_else(|| "unknown-drive".to_owned())?;
    let method = match action {
        DriveAction::Eject if known.ejectable => "Eject",
        DriveAction::PowerOff if known.can_power_off => "PowerOff",
        _ => return Err("not-supported".into()),
    };
    let conn = Connection::system().await.map_err(|e| e.to_string())?;
    let options: HashMap<&str, Variant<'_>> = HashMap::new();
    conn.call_method(
        Some(SERVICE),
        known.path.as_str(),
        Some(DRIVE),
        method,
        &(options,),
    )
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::panic, clippy::float_cmp)]

    use super::*;
    use crate::providers::props::{Prop, fixture};

    fn field<'a>(v: &'a Value, key: &str) -> &'a Value {
        match v {
            Value::Map(m) => m.get(key).unwrap_or_else(|| panic!("no {key} in {m:?}")),
            other => panic!("not a map: {other:?}"),
        }
    }

    #[test]
    fn reference_laptop_health() {
        let objects = fixture::objects("hp-i5-10300h", "udisks2-objects");
        let mut list = drives(&objects);
        list.sort_by(|a, b| a.block.cmp(&b.block));
        let blocks: Vec<_> = list.iter().map(|d| d.block.as_deref()).collect();
        assert_eq!(blocks, [Some("nvme0n1"), Some("sda")]);

        // NVMe with the attributes SmartGetAttributes returned during the inspection (SENSORS.md).
        let nvme = &mut list[0];
        nvme.nvme_attrs = Some(
            [
                ("percent_used", 16.0),
                ("avail_spare", 100.0),
                ("spare_thresh", 5.0),
                ("media_errors", 0.0),
                ("total_data_written", 3.0e13),
            ]
            .into_iter()
            .map(|(k, v)| (k.to_owned(), Prop::Num(v)))
            .collect(),
        );
        let h = health_value(nvme);
        assert_eq!(field(&h, "status"), &Value::from("good"));
        assert_eq!(
            field(&h, "model"),
            &Value::from("SAMSUNG MZVLQ512HALU-000H1")
        );
        assert_eq!(field(&h, "percentUsed"), &Value::Num(16.0));
        assert_eq!(field(&h, "writtenB"), &Value::Num(3.0e13));
        let Value::Num(t) = field(&h, "tempC") else {
            panic!()
        };
        assert!((t - 9.85).abs() < 0.01, "SmartTemperature 283 K");

        // The SATA SSD reports 4 bad sectors: a warning, shown honestly.
        let h = health_value(&list[1]);
        assert_eq!(field(&h, "status"), &Value::from("warning"));
        assert_eq!(field(&h, "badSectors"), &Value::Num(4.0));
        assert_eq!(
            field(&h, "warnings"),
            &Value::List(vec![Value::from("bad-sectors")])
        );
        assert_eq!(field(&h, "powerOnHours"), &Value::Num(13946.0));
        assert_eq!(field(&h, "model"), &Value::from("Samsung SSD 870 QVO 1TB"));
    }

    #[test]
    fn nvme_status_rules() {
        let mut d = DriveInfo {
            path: "/d".into(),
            block: Some("nvme0n1".into()),
            model: None,
            bus: None,
            removable: false,
            ejectable: false,
            can_power_off: false,
            nvme: Some(Props::new()),
            ata: None,
            nvme_attrs: None,
        };
        assert_eq!(field(&health_value(&d), "status"), &Value::from("good"));
        d.nvme_attrs = Some(
            [("percent_used".to_owned(), Prop::Num(95.0))]
                .into_iter()
                .collect(),
        );
        assert_eq!(field(&health_value(&d), "status"), &Value::from("warning"));
        d.nvme = Some(
            [(
                "SmartCriticalWarning".to_owned(),
                Prop::Strs(vec!["spare".into()]),
            )]
            .into_iter()
            .collect(),
        );
        assert_eq!(field(&health_value(&d), "status"), &Value::from("failing"));
        d.nvme = None;
        assert_eq!(field(&health_value(&d), "status"), &Value::from("unknown"));
    }
}

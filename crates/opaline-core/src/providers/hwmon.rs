//! hwmon discovery, shared by the CPU, storage, GPU and fan providers.

use crate::sysfs::Root;

const HWMON: &str = "/sys/class/hwmon";

/// One `temp*`/`fan*`/`power*` channel of a hwmon device.
#[derive(Debug, Clone, PartialEq)]
pub struct Channel {
    /// `temp1`, `fan2`, …
    pub id: String,
    /// The `*_label` file, if the driver provides one.
    pub label: Option<String>,
    /// Absolute path of the `*_input` file.
    pub input: String,
    /// `*_max` and `*_crit`, already scaled (°C for temperatures).
    pub max: Option<f64>,
    pub crit: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Device {
    /// `/sys/class/hwmon/hwmonN`
    pub dir: String,
    /// The driver name from the `name` file: `coretemp`, `k10temp`, `nvme`, `amdgpu`, …
    pub name: String,
    pub temps: Vec<Channel>,
    pub fans: Vec<Channel>,
}

/// Lists every hwmon device with its temperature and fan channels.
pub fn discover(root: &Root) -> Vec<Device> {
    root.list(HWMON)
        .into_iter()
        .filter_map(|entry| {
            let dir = format!("{HWMON}/{entry}");
            let name = root.read_trim(format!("{dir}/name"))?;
            let files = root.list(&dir);
            Some(Device {
                temps: channels(root, &dir, &files, "temp", 1000.0),
                fans: channels(root, &dir, &files, "fan", 1.0),
                dir,
                name,
            })
        })
        .collect()
}

fn channels(root: &Root, dir: &str, files: &[String], prefix: &str, scale: f64) -> Vec<Channel> {
    files
        .iter()
        .filter_map(|f| {
            let id = f.strip_suffix("_input")?;
            id.strip_prefix(prefix)?.parse::<u32>().ok()?;
            let read = |suffix: &str| {
                root.read_i64(format!("{dir}/{id}_{suffix}"))
                    .map(|v| v as f64 / scale)
            };
            Some(Channel {
                id: id.to_owned(),
                label: root
                    .read_trim(format!("{dir}/{id}_label"))
                    .filter(|l| !l.is_empty()),
                input: format!("{dir}/{f}"),
                max: read("max"),
                crit: read("crit"),
            })
        })
        .collect()
}

/// Parses a millidegree value (`45000\n`) into °C.
pub fn parse_millidegrees(bytes: &[u8]) -> Option<f64> {
    let text = std::str::from_utf8(bytes).ok()?.trim();
    text.parse::<i64>().ok().map(|v| v as f64 / 1000.0)
}

/// A temperature a working sensor can report. Some ACPI zones report placeholders like
/// 0.05 °C or 127 °C (SEN4 on the reference laptop), which must never be shown.
pub fn plausible_celsius(t: f64) -> bool {
    t.is_finite() && (1.0..=125.0).contains(&t)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sysfs::fixture;

    #[test]
    fn finds_the_reference_sensors() {
        let devices = discover(&fixture("hp-i5-10300h"));
        let names: Vec<&str> = devices.iter().map(|d| d.name.as_str()).collect();
        assert!(names.contains(&"coretemp"));
        assert!(names.contains(&"nvme"));
        let coretemp = devices.iter().find(|d| d.name == "coretemp");
        let coretemp = coretemp.map(|d| d.temps.clone()).unwrap_or_default();
        assert_eq!(coretemp.len(), 5);
        assert_eq!(coretemp[0].label.as_deref(), Some("Package id 0"));
        assert_eq!(coretemp[0].crit, Some(100.0));
        let hp = devices.iter().find(|d| d.name == "hp");
        assert_eq!(hp.map(|d| d.fans.len()), Some(2));
    }

    #[test]
    fn millidegrees_and_plausibility() {
        assert_eq!(parse_millidegrees(b"45000\n"), Some(45.0));
        assert_eq!(parse_millidegrees(b"x"), None);
        assert!(!plausible_celsius(0.05));
        assert!(plausible_celsius(45.0));
        assert!(!plausible_celsius(127.5));
    }
}

//! Monitor identity and geometry from `org.gnome.Mutter.DisplayConfig`.
//!
//! Verified on GNOME 50.1: `GetCurrentState` works for a normal session client and
//! reports `layout-mode = 1` (logical), so positions are already logical pixels.

use std::collections::HashMap;

use futures_util::StreamExt;
use opaline_ipc::MonitorInfo;
use zbus::{Connection, OwnedVariant, proxy};

/// `(connector, vendor, product, serial)`.
type MonitorSpec = (String, String, String, String);
/// `(id, width, height, refresh, preferred scale, supported scales, properties)`.
type Mode = (
    String,
    i32,
    i32,
    f64,
    f64,
    Vec<f64>,
    HashMap<String, OwnedVariant>,
);
type Physical = (MonitorSpec, Vec<Mode>, HashMap<String, OwnedVariant>);
/// `(x, y, scale, transform, primary, monitors, properties)`.
type Logical = (
    i32,
    i32,
    f64,
    u32,
    bool,
    Vec<MonitorSpec>,
    HashMap<String, OwnedVariant>,
);
type CurrentState = (
    u32,
    Vec<Physical>,
    Vec<Logical>,
    HashMap<String, OwnedVariant>,
);

#[proxy(
    interface = "org.gnome.Mutter.DisplayConfig",
    default_service = "org.gnome.Mutter.DisplayConfig",
    default_path = "/org/gnome/Mutter/DisplayConfig"
)]
trait DisplayConfig {
    fn get_current_state(&self) -> zbus::Result<CurrentState>;

    #[zbus(signal)]
    fn monitors_changed(&self) -> zbus::Result<()>;
}

/// Mutter's `layout-mode` property.
const LAYOUT_PHYSICAL: u32 = 2;

/// Reads the current monitors.
pub async fn current_monitors(conn: &Connection) -> zbus::Result<Vec<MonitorInfo>> {
    let proxy = DisplayConfigProxy::new(conn).await?;
    let state = proxy.get_current_state().await?;
    Ok(monitors_from_state(&state))
}

/// Calls `on_change` with the new monitor list every time Mutter reports a change.
/// Returns when the signal stream ends (the bus connection closed).
pub async fn watch_monitors<F>(conn: &Connection, mut on_change: F) -> zbus::Result<()>
where
    F: FnMut(Vec<MonitorInfo>),
{
    let proxy = DisplayConfigProxy::new(conn).await?;
    let mut changes = proxy.receive_monitors_changed().await?;
    while changes.next().await.is_some() {
        match proxy.get_current_state().await {
            Ok(state) => on_change(monitors_from_state(&state)),
            Err(error) => tracing::warn!(%error, "could not re-read monitors after a change"),
        }
    }
    Ok(())
}

fn bool_prop(props: &HashMap<String, OwnedVariant>, key: &str) -> bool {
    props
        .get(key)
        .and_then(|v| bool::try_from(v).ok())
        .unwrap_or(false)
}

fn u32_prop(props: &HashMap<String, OwnedVariant>, key: &str) -> Option<u32> {
    props.get(key).and_then(|v| u32::try_from(v).ok())
}

/// Turns the raw `GetCurrentState` reply into one entry per enabled monitor.
///
/// A logical monitor can contain several physical monitors when they mirror each other;
/// each still gets its own entry (and its own layer window) at the shared position.
fn monitors_from_state(state: &CurrentState) -> Vec<MonitorInfo> {
    let (_serial, physical, logical, props) = state;
    let physical_layout = u32_prop(props, "layout-mode") == Some(LAYOUT_PHYSICAL);

    let mut out = Vec::new();
    for (x, y, scale, transform, primary, specs, _) in logical {
        for spec in specs {
            let Some((_, modes, mon_props)) = physical.iter().find(|(s, _, _)| s.0 == spec.0)
            else {
                continue;
            };
            let Some(mode) = modes.iter().find(|m| bool_prop(&m.6, "is-current")) else {
                continue;
            };
            let (mut w, mut h) = (f64::from(mode.1), f64::from(mode.2));
            // Transforms 1, 3, 5 and 7 rotate by 90° or 270°.
            if transform % 2 == 1 {
                std::mem::swap(&mut w, &mut h);
            }
            if !physical_layout && *scale > 0.0 {
                w /= scale;
                h /= scale;
            }
            let (connector, vendor, product, serial) = spec;
            out.push(MonitorInfo {
                key: MonitorInfo::make_key(vendor, product, serial, connector),
                connector: connector.clone(),
                vendor: vendor.clone(),
                product: product.clone(),
                serial: serial.clone(),
                x: *x,
                y: *y,
                width: logical_px(w),
                height: logical_px(h),
                scale: *scale,
                primary: *primary,
                builtin: bool_prop(mon_props, "is-builtin"),
                work_area: None,
            });
        }
    }
    out.sort_by_key(|m| (m.x, m.y));
    out
}

#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn logical_px(v: f64) -> u32 {
    // Mutter keeps logical sizes integral for supported scales; round away float noise.
    v.round().clamp(0.0, f64::from(u32::MAX)) as u32
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    fn props(pairs: &[(&str, bool)]) -> HashMap<String, OwnedVariant> {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_owned(), OwnedVariant::from(*v)))
            .collect()
    }

    fn spec(connector: &str, vendor: &str, product: &str) -> MonitorSpec {
        (
            connector.into(),
            vendor.into(),
            product.into(),
            "0x00000000".into(),
        )
    }

    fn mode(w: i32, h: i32, current: bool) -> Mode {
        (
            format!("{w}x{h}@60"),
            w,
            h,
            60.0,
            1.0,
            vec![1.0, 1.25, 2.0],
            props(&[("is-current", current)]),
        )
    }

    /// The reference laptop: eDP-1 at 1.25 next to an HDMI monitor at 1.0.
    fn reference_state() -> CurrentState {
        let mut global = HashMap::new();
        global.insert("layout-mode".to_owned(), OwnedVariant::from(1u32));
        (
            1,
            vec![
                (
                    spec("HDMI-2", "MSI", "MAG 272F"),
                    vec![mode(1920, 1080, true), mode(1280, 720, false)],
                    props(&[("is-builtin", false)]),
                ),
                (
                    spec("eDP-1", "AUO", "0x82ed"),
                    vec![mode(1920, 1080, true)],
                    props(&[("is-builtin", true)]),
                ),
            ],
            vec![
                (
                    0,
                    0,
                    1.25,
                    0,
                    true,
                    vec![spec("eDP-1", "AUO", "0x82ed")],
                    HashMap::new(),
                ),
                (
                    1536,
                    0,
                    1.0,
                    0,
                    false,
                    vec![spec("HDMI-2", "MSI", "MAG 272F")],
                    HashMap::new(),
                ),
            ],
            global,
        )
    }

    #[test]
    fn reference_laptop_layout() {
        let monitors = monitors_from_state(&reference_state());
        assert_eq!(monitors.len(), 2);
        let edp = &monitors[0];
        assert_eq!(edp.connector, "eDP-1");
        assert_eq!((edp.x, edp.y, edp.width, edp.height), (0, 0, 1536, 864));
        assert!(edp.primary && edp.builtin);
        assert_eq!(edp.key, "AUO-0x82ed-0x00000000:eDP-1");
        let hdmi = &monitors[1];
        assert_eq!(
            (hdmi.x, hdmi.width, hdmi.height, hdmi.scale),
            (1536, 1920, 1080, 1.0)
        );
        assert!(!hdmi.primary && !hdmi.builtin);
    }

    #[test]
    fn rotated_monitor_swaps_width_and_height() {
        let mut state = reference_state();
        state.2[1].3 = 1; // 90°
        let hdmi = monitors_from_state(&state).pop().unwrap();
        assert_eq!((hdmi.width, hdmi.height), (1080, 1920));
    }

    #[test]
    fn physical_layout_mode_does_not_divide_by_scale() {
        let mut state = reference_state();
        state
            .3
            .insert("layout-mode".to_owned(), OwnedVariant::from(2u32));
        let edp = &monitors_from_state(&state)[0];
        assert_eq!((edp.width, edp.height), (1920, 1080));
    }

    #[test]
    fn monitor_without_current_mode_is_skipped() {
        let mut state = reference_state();
        state.1[0].1 = vec![mode(1920, 1080, false)];
        let monitors = monitors_from_state(&state);
        assert_eq!(monitors.len(), 1);
        assert_eq!(monitors[0].connector, "eDP-1");
    }
}

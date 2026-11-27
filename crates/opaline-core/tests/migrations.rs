//! Verifies that Opaline 1.1 configuration files (settings, styles, named styles, widgets, and
//! dual-monitor layouts) migrate to 2.0 with zero data loss and preserve the Classic 1.1 look
//! (brief §0.6, PLAN-2 task 3.8).
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::path::PathBuf;

fn fixture(rel: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/v1.1")
        .join(rel);
    std::fs::read_to_string(&path).unwrap()
}

#[test]
fn v1_1_settings_migrates_without_loss_and_preserves_classic_theme() {
    let raw: serde_json::Value = serde_json::from_str(&fixture("settings.json")).unwrap();
    let (migrated, writable) = opaline_core::store::migrate(raw);

    assert!(writable);
    assert_eq!(migrated.version, opaline_core::store::VERSION);
    assert_eq!(
        migrated.schema.as_deref(),
        Some(opaline_core::store::SCHEMA_URL)
    );
    // Upgraders keep Classic so nobody is forced into the new design (brief §0.6).
    assert_eq!(migrated.theme, opaline_core::store::CLASSIC_THEME);
    assert!(migrated.onboarding_done);
    assert_eq!(migrated.network.billing_day, 15);
    assert_eq!(
        migrated.weather.location.as_ref().map(|l| l.name.as_str()),
        Some("Example City")
    );
    assert_eq!(migrated.alerts.len(), 1);
    assert_eq!(migrated.alerts[0].id, "cpu-hot");

    // Global style preserved and blur rescaled: 60 + 0.4 * 25 = 70.
    assert_eq!(migrated.style.transparency, Some(70.0));
    assert_eq!(migrated.style.blur, Some(70.0));
    assert_eq!(migrated.style.rim, Some(60.0));
    assert_eq!(migrated.style.font_family.as_deref(), Some("Inter"));

    // Named styles preserved and blur rescaled: 60 + 0.4 * 50 = 80.
    assert_eq!(migrated.styles.len(), 2);
    let night = &migrated.styles["Night Glass"];
    assert_eq!(night.blur, Some(80.0));
    assert_eq!(night.accent_color.as_deref(), Some("#8f7cf0"));
    let minimal = &migrated.styles["Minimal Clear"];
    assert_eq!(minimal.icons, Some(false));
    assert_eq!(minimal.uppercase_labels, Some(true));

    // All 4 widgets + per-widget styles & content preserved; blurs rescaled 0→60, 100→100.
    assert_eq!(migrated.widgets.len(), 4);
    assert_eq!(migrated.widgets["a-clock"].style.blur, Some(60.0));
    assert_eq!(migrated.widgets["a-clock"].style.text_scale, Some(1.15));
    assert_eq!(
        migrated.widgets["a-clock"].content["format24h"],
        serde_json::json!(true)
    );
    assert_eq!(migrated.widgets["b-cpu"].style.blur, Some(100.0));
    assert_eq!(
        migrated.widgets["b-cpu"].style.border_color.as_deref(),
        Some("#f2903a")
    );
    assert_eq!(
        migrated.widgets["b-cpu"].content["title"],
        serde_json::json!("Processor")
    );
    assert_eq!(
        migrated.widgets["c-memory"].content["unit"],
        serde_json::json!("GiB")
    );
    assert_eq!(
        migrated.widgets["d-visualizer"].content["bands"],
        serde_json::json!(16)
    );

    assert_eq!(migrated.validate(), Ok(()));
}

#[test]
fn v1_1_layouts_migrates_without_loss() {
    let raw: serde_json::Value = serde_json::from_str(&fixture("layouts.json")).unwrap();
    let (layouts, writable) = opaline_core::layouts::migrate(raw);

    assert!(writable);
    assert_eq!(layouts.version, opaline_core::layouts::VERSION);
    assert_eq!(layouts.monitors.len(), 2);
    assert_eq!(layouts.monitors["REDACTED-PANEL-0001:eDP-1"].items.len(), 2);
    assert_eq!(layouts.monitors["REDACTED-EXT-0002:HDMI-2"].items.len(), 1);
    assert_eq!(layouts.validate(), Ok(()));
}

/// A `timers.json` written by 2.0.0/2.0.1 (no wall-clock anchors) still loads: every field is
/// kept, and running entries resume from their saved values (the downtime before the upgrade
/// can't be known) and from then on follow the wall clock.
#[test]
fn v2_0_timers_file_loads_and_resumes_from_its_saved_values() {
    use opaline_core::providers::timers::{TimerKind, load_store, tick_store};
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/v2.0/timers.json");
    let now = 1_795_800_000_000;
    let mut st = load_store(&path, now);
    assert_eq!(st.day_key, "2026-11-27");
    assert_eq!(st.items.len(), 3);
    let pomo = &st.items[0];
    assert_eq!(pomo.kind, TimerKind::Pomodoro);
    assert_eq!(pomo.pomo_completed_today, 3);
    assert!(pomo.running);
    assert_eq!(pomo.ends_at_ms, Some(now + 600_000));
    let sw = &st.items[2];
    assert_eq!(sw.laps_ms, vec![12_000, 30_000]);
    assert_eq!(sw.started_at_ms, Some(now - 42_000));
    assert_eq!(st.items[1].ends_at_ms, None);

    let tick = tick_store(&mut st, now + 2_000, 0);
    assert!(tick.finished.is_empty());
    assert_eq!(st.items[0].remaining_ms, 598_000);
    assert_eq!(st.items[2].elapsed_ms, 44_000);
}

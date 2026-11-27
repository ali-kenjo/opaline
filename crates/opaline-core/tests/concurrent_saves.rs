//! Overlapping settings and layout saves (the first start sends three at once): every patch must
//! survive, and the file on disk must match what core publishes.
//!
//! Core writes under `$XDG_CONFIG_HOME/opaline`, and changing the environment in-process needs
//! `unsafe`, so the outer test re-runs this test binary with `XDG_CONFIG_HOME` pointing at a temp
//! folder. The inner test refuses to run without that marker, so it can never touch a real config.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::process::Command;

use opaline_core::hub::Hub;
use opaline_ipc::BackendKind;
use serde_json::json;

const MARKER: &str = "OPALINE_TEST_ISOLATED_CONFIG";
const PATCHES: usize = 24;

#[test]
fn overlapping_settings_saves_keep_every_patch() {
    let dir = tempfile::tempdir().unwrap();
    let out = Command::new(std::env::current_exe().unwrap())
        .args([
            "inner_overlapping_saves",
            "--exact",
            "--ignored",
            "--nocapture",
        ])
        .env("XDG_CONFIG_HOME", dir.path())
        .env(MARKER, "1")
        .output()
        .unwrap();
    let log =
        String::from_utf8_lossy(&out.stdout).into_owned() + &String::from_utf8_lossy(&out.stderr);
    assert!(out.status.success(), "inner test failed:\n{log}");
    assert!(log.contains("1 passed"), "inner test didn't run:\n{log}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "run by overlapping_settings_saves_keep_every_patch in an isolated config dir"]
async fn inner_overlapping_saves() {
    assert!(
        std::env::var_os(MARKER).is_some(),
        "refusing to run outside the isolated config dir"
    );
    let hub = Hub::new(BackendKind::Instant, Vec::new());
    hub.init_settings(opaline_core::store::Settings::default(), true);

    let tasks: Vec<_> = (0..PATCHES)
        .map(|i| {
            let hub = hub.clone();
            tokio::spawn(async move {
                opaline_core::store::update(
                    &hub,
                    json!({ "widgets": { format!("w{i}"): { "kind": "clock" } } }),
                )
                .await
            })
        })
        .collect();
    for task in tasks {
        task.await.unwrap().unwrap();
    }

    let published = hub.settings();
    assert_eq!(
        published.widgets.len(),
        PATCHES,
        "a patch was lost in memory"
    );

    let dir = opaline_core::paths::config_dir().unwrap();
    let on_disk: serde_json::Value =
        serde_json::from_slice(&std::fs::read(dir.join("settings.json")).unwrap()).unwrap();
    assert_eq!(
        on_disk["widgets"].as_object().unwrap().len(),
        PATCHES,
        "the saved file lost a patch"
    );
    let leftovers: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .filter(|n| n != "settings.json")
        .collect();
    assert!(leftovers.is_empty(), "temp files left: {leftovers:?}");
}

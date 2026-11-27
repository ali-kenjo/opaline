//! Opaline core: everything except the Tauri glue.
//!
//! See `docs/ARCHITECTURE.md` §3.

pub mod alerts;
pub mod app_service;
pub mod automation;
pub mod autostart;
pub mod backup;
pub mod commands;
pub mod css;
pub mod ctl;
pub mod desktop;
pub mod diagnose;
pub mod displays;
pub mod dump;
pub mod engine;
pub mod fonts;
pub mod history;
pub mod http;
pub mod hub;
pub mod icons;
pub mod ipc_server;
pub mod json;
pub mod jsonpath;
pub mod layouts;
pub mod logging;
pub mod paths;
pub mod profiles;
pub mod providers;
pub mod rice;
pub mod secrets;
pub mod shortcuts;
pub mod sources;
pub mod store;
pub mod style;
pub mod sysfs;
pub mod themes;
pub mod updates;
pub mod watcher;
pub mod zip_pkg;

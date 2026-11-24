//! Opaline core: everything except the Tauri glue.
//!
//! See `docs/ARCHITECTURE.md` §3.

pub mod alerts;
pub mod app_service;
pub mod commands;
pub mod desktop;
pub mod diagnose;
pub mod displays;
pub mod dump;
pub mod engine;
pub mod fonts;
pub mod history;
pub mod http;
pub mod hub;
pub mod ipc_server;
pub mod json;
pub mod layouts;
pub mod logging;
pub mod paths;
pub mod providers;
pub mod shortcuts;
pub mod store;
pub mod style;
pub mod sysfs;

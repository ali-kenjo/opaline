//! Opaline core: everything except the Tauri glue.
//!
//! See `docs/ARCHITECTURE.md` §3.

pub mod app_service;
pub mod diagnose;
pub mod displays;
pub mod engine;
pub mod hub;
pub mod ipc_server;
pub mod logging;
pub mod paths;
pub mod providers;
pub mod sysfs;

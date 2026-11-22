//! Tokio runtimes. Core and layer use a small multi-thread runtime that Tauri also uses for its
//! async commands, so there is exactly one runtime per process (ARCHITECTURE §3.1).

use tokio::runtime::{Builder, Runtime};

const WORKER_THREADS: usize = 2;
const MAX_BLOCKING_THREADS: usize = 4;

/// Builds the process runtime and hands it to Tauri.
pub fn install() -> Option<Runtime> {
    match Builder::new_multi_thread()
        .worker_threads(WORKER_THREADS)
        .max_blocking_threads(MAX_BLOCKING_THREADS)
        .thread_name("opaline-rt")
        .enable_all()
        .build()
    {
        Ok(rt) => {
            tauri::async_runtime::set(rt.handle().clone());
            Some(rt)
        }
        Err(error) => {
            tracing::error!(%error, "could not start the async runtime");
            None
        }
    }
}

/// A single-threaded runtime for short-lived CLI modes.
pub fn current_thread() -> Option<Runtime> {
    match Builder::new_current_thread().enable_all().build() {
        Ok(rt) => Some(rt),
        Err(error) => {
            eprintln!("could not start the async runtime: {error}");
            None
        }
    }
}

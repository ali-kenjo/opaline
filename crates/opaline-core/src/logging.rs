//! `tracing` setup: journald (when available) plus a daily-rotated file in
//! `~/.local/state/opaline/logs/`. The filter comes from `OPALINE_LOG` (default `info`).

use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling::{Builder, Rotation};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{EnvFilter, Layer, fmt};

/// Keeps the background log writer alive; drop it last.
#[derive(Debug)]
pub struct LogGuard {
    _file: Option<WorkerGuard>,
}

/// Installs the global subscriber. `role` ("core", "layer") prefixes the log file name and the
/// journald identifier. Never fails: if a sink can't be set up, logging continues without it.
pub fn init(role: &str) -> LogGuard {
    let filter =
        || EnvFilter::try_from_env("OPALINE_LOG").unwrap_or_else(|_| EnvFilter::new("info"));

    let mut file_guard = None;
    let file_layer = crate::paths::state_dir()
        .ok()
        .map(|dir| dir.join("logs"))
        .and_then(|dir| {
            Builder::new()
                .rotation(Rotation::DAILY)
                .filename_prefix(format!("opaline-{role}"))
                .filename_suffix("log")
                .max_log_files(7)
                .build(dir)
                .ok()
        })
        .map(|appender| {
            let (writer, guard) = tracing_appender::non_blocking(appender);
            file_guard = Some(guard);
            fmt::layer()
                .with_writer(writer)
                .with_ansi(false)
                .with_filter(filter())
        });

    let journald_layer = tracing_journald::layer().ok().map(|l| {
        l.with_syslog_identifier(format!("opaline-{role}"))
            .with_filter(filter())
    });

    // Interactive runs (a terminal) also log to stderr.
    let stderr_layer = std::io::IsTerminal::is_terminal(&std::io::stderr()).then(|| {
        fmt::layer()
            .with_writer(std::io::stderr)
            .with_filter(filter())
    });

    // A second init (tests) is harmless; ignore the error.
    let _ = tracing_subscriber::registry()
        .with(file_layer)
        .with(journald_layer)
        .with(stderr_layer)
        .try_init();

    LogGuard { _file: file_guard }
}

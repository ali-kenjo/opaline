//! `opaline`: one binary, several roles (docs/ARCHITECTURE.md §1).

mod core_mode;
mod instant;
mod layer;
mod runtime;

use std::process::ExitCode;

use clap::{Parser, ValueEnum};
use opaline_core::app_service::AppRequest;

#[derive(Debug, Parser)]
#[command(
    name = "opaline",
    version,
    about = "Glass widgets for your Ubuntu desktop"
)]
struct Cli {
    /// Run as the widget layer renderer (started by core or by the desktop-integration helper).
    #[arg(long)]
    layer: bool,

    /// Desktop-integration backend for --layer.
    #[arg(long, value_enum, default_value_t = Backend::Instant, requires = "layer")]
    backend: Backend,

    /// Print a redacted JSON inventory of this system for bug reports, then exit.
    #[arg(long, conflicts_with = "layer")]
    diagnose: bool,

    /// Sample every sensor for two seconds and print the topics as JSON (optionally only those
    /// starting with PREFIX, e.g. `cpu.`), to compare with reference tools.
    #[arg(long, value_name = "PREFIX", num_args = 0..=1, default_missing_value = "", conflicts_with_all = ["layer", "diagnose"])]
    dump: Option<String>,

    /// Ask the running Opaline to show the widgets above all windows.
    #[arg(long, group = "request")]
    peek: bool,

    /// Ask the running Opaline to enter Edit mode (also what a second launch does).
    #[arg(long, group = "request")]
    edit: bool,

    /// Ask the running Opaline to open Settings.
    #[arg(long, group = "request")]
    settings: bool,

    /// Ask the running Opaline to quit.
    #[arg(long, group = "request")]
    quit: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum Backend {
    Native,
    Instant,
}

impl Cli {
    fn request(&self) -> Option<AppRequest> {
        if self.peek {
            Some(AppRequest::Peek)
        } else if self.edit {
            Some(AppRequest::Edit)
        } else if self.settings {
            Some(AppRequest::OpenSettings)
        } else if self.quit {
            Some(AppRequest::Quit)
        } else {
            None
        }
    }
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    if cli.diagnose {
        return diagnose();
    }
    if let Some(prefix) = &cli.dump {
        return dump(prefix);
    }
    if cli.layer {
        let _log = opaline_core::logging::init("layer");
        return layer::run(cli.backend);
    }
    let _log = opaline_core::logging::init("core");
    core_mode::run(cli.request())
}

#[allow(clippy::print_stdout)] // printing the topics is the whole point of --dump
fn dump(prefix: &str) -> ExitCode {
    let Some(rt) = runtime::current_thread() else {
        return ExitCode::FAILURE;
    };
    let prefix = (!prefix.is_empty()).then_some(prefix);
    let topics = rt.block_on(opaline_core::dump::dump(prefix));
    match serde_json::to_string_pretty(&topics) {
        Ok(json) => {
            println!("{json}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("could not serialise the topics: {error}");
            ExitCode::FAILURE
        }
    }
}

#[allow(clippy::print_stdout)] // printing the report is the whole point of --diagnose
fn diagnose() -> ExitCode {
    let Some(rt) = runtime::current_thread() else {
        return ExitCode::FAILURE;
    };
    let report = rt.block_on(opaline_core::diagnose::collect());
    match serde_json::to_string_pretty(&report) {
        Ok(json) => {
            println!("{json}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("could not serialise the report: {error}");
            ExitCode::FAILURE
        }
    }
}

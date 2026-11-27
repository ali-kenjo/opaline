//! `opaline`: one binary, several roles (docs/ARCHITECTURE.md §1).

mod core_mode;
mod ctl;
mod instant;
mod layer;
mod runtime;
mod shell;

use std::process::ExitCode;

use clap::{Parser, Subcommand, ValueEnum};
use opaline_core::app_service::AppRequest;

#[derive(Debug, Subcommand)]
enum TopCommand {
    /// Control a running Opaline instance over D-Bus (settings, widgets, profiles, automation).
    Ctl(ctl::CtlArgs),
    /// Validate a plugin or package folder (manifest, entry, permissions, CSS, size limits).
    Validate {
        /// Path to the package folder containing `plugin.json`.
        dir: std::path::PathBuf,
    },
    /// Validate and pack a plugin folder into a `.opaline-plugin` ZIP archive.
    Pack {
        /// Path to the package folder containing `plugin.json`.
        dir: std::path::PathBuf,
        /// Optional output archive path (defaults to `<id>-<version>.opaline-plugin`).
        #[arg(long, short)]
        out: Option<std::path::PathBuf>,
    },
}

#[derive(Debug, Parser)]
#[command(
    name = "opaline",
    version,
    about = "Glass widgets for your Ubuntu desktop"
)]
struct Cli {
    #[command(subcommand)]
    command: Option<TopCommand>,
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

    /// Ask the running Opaline to open the first-run Onboarding flow.
    #[arg(long, group = "request")]
    onboarding: bool,

    /// Start without user CSS, theme CSS, custom sources, or plugins (brief §5.3).
    #[arg(long, conflicts_with = "layer")]
    safe_mode: bool,

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
        } else if self.onboarding {
            Some(AppRequest::OpenOnboarding)
        } else if self.quit {
            Some(AppRequest::Quit)
        } else {
            None
        }
    }
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match cli.command {
        Some(TopCommand::Ctl(args)) => return ctl::run(args),
        Some(TopCommand::Validate { dir }) => return validate_pkg(&dir),
        Some(TopCommand::Pack { dir, out }) => return pack_pkg(&dir, out.as_deref()),
        None => {}
    }
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
    core_mode::run(cli.request(), cli.safe_mode)
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

#[allow(clippy::print_stdout)]
fn validate_pkg(dir: &std::path::Path) -> ExitCode {
    match opaline_core::plugins::validate_dir(dir) {
        Ok(manifest) => {
            match serde_json::to_string_pretty(&manifest) {
                Ok(json) => println!("{json}"),
                Err(_) => println!(
                    "Valid plugin: {} ({})",
                    manifest.id, manifest.plugin_version
                ),
            }
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("opaline validate: {error}");
            ExitCode::FAILURE
        }
    }
}

#[allow(clippy::print_stdout)]
fn pack_pkg(dir: &std::path::Path, out: Option<&std::path::Path>) -> ExitCode {
    match opaline_core::plugins::pack_dir(dir, out) {
        Ok(report) => {
            match serde_json::to_string_pretty(&report) {
                Ok(json) => println!("{json}"),
                Err(_) => println!("Packed {} -> {}", report.id, report.output_path),
            }
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("opaline pack: {error}");
            ExitCode::FAILURE
        }
    }
}

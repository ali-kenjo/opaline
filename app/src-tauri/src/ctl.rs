//! `opaline ctl` CLI parser and runner over session D-Bus (PLAN-2 8.4).

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Args, Subcommand};
use opaline_core::ctl::{self, CtlOp};

#[derive(Debug, Args)]
pub struct CtlArgs {
    /// Emit machine-readable JSON output.
    #[arg(long, global = true)]
    pub json: bool,

    #[command(subcommand)]
    pub cmd: CtlCmd,
}

#[derive(Debug, Subcommand)]
pub enum CtlCmd {
    /// Show running Opaline status (backend, theme, look, profile, monitors).
    Status,
    /// Read a setting or style key by dotted or JSON-pointer path.
    Get { path: String },
    /// Set a setting or style key by dotted or JSON-pointer path.
    Set { path: String, value: String },
    /// Manage placed widgets on the desktop.
    Widgets {
        #[command(subcommand)]
        cmd: WidgetsCmd,
    },
    /// Manage desktop profiles.
    Profile {
        #[command(subcommand)]
        cmd: ProfileCmd,
    },
    /// Get or switch the active theme.
    Theme { id: Option<String> },
    /// Get or switch the active desktop look (`glass`, `clear`, `tinted`, `dark`, `light`, `dimmed`).
    Look { look: Option<String> },
    /// Manage user variables (`var.<name>`).
    Var {
        #[command(subcommand)]
        cmd: VarCmd,
    },
    /// Dispatch a named widget action.
    Action { widget_id: String, action: String },
    /// Raise the widget layer on all monitors or a single monitor.
    Peek {
        #[arg(long)]
        monitor: Option<String>,
    },
    /// Toggle Edit mode.
    Edit,
    /// Export settings and layouts backup JSON (secrets excluded).
    Export {
        #[arg(long, short)]
        out: Option<PathBuf>,
    },
    /// Import a settings and layouts backup JSON file.
    Import { file: PathBuf },
    /// Inspect or resume automation rules.
    Automation {
        #[command(subcommand)]
        cmd: AutomationCmd,
    },
    /// Print shell completion script (`bash`, `zsh`, or `fish`).
    Completions { shell: String },
}

#[derive(Debug, Subcommand)]
pub enum WidgetsCmd {
    List,
    Add {
        kind: String,
        #[arg(long, default_value = "")]
        monitor: String,
        #[arg(long, default_value_t = 0)]
        x: i32,
        #[arg(long, default_value_t = 0)]
        y: i32,
        #[arg(long, default_value_t = 4)]
        w: i32,
        #[arg(long, default_value_t = 2)]
        h: i32,
    },
    Remove {
        id: String,
    },
    Move {
        id: String,
        #[arg(long, default_value = "")]
        monitor: String,
        #[arg(long)]
        x: i32,
        #[arg(long)]
        y: i32,
        #[arg(long)]
        w: i32,
        #[arg(long)]
        h: i32,
    },
    Toggle {
        id: String,
    },
}

#[derive(Debug, Subcommand)]
pub enum ProfileCmd {
    List,
    Use { id: String },
    Save { id: String, name: Option<String> },
    Delete { id: String },
}

#[derive(Debug, Subcommand)]
pub enum VarCmd {
    Set { name: String, value: String },
}

#[derive(Debug, Subcommand)]
pub enum AutomationCmd {
    Status,
    Resume,
}

#[allow(clippy::print_stdout)]
pub fn run(args: CtlArgs) -> ExitCode {
    if let CtlCmd::Completions { shell } = &args.cmd {
        match ctl::completion_script(shell) {
            Some(script) => {
                print!("{script}");
                return ExitCode::SUCCESS;
            }
            None => {
                eprintln!("opaline ctl: unsupported shell '{shell}' (expected bash, zsh, or fish)");
                return ExitCode::FAILURE;
            }
        }
    }

    let export_out = match &args.cmd {
        CtlCmd::Export { out } => out.clone(),
        _ => None,
    };

    let op = match args.cmd {
        CtlCmd::Status => CtlOp::Status,
        CtlCmd::Get { path } => CtlOp::Get { path },
        CtlCmd::Set { path, value } => CtlOp::Set {
            path,
            raw_value: value,
        },
        CtlCmd::Widgets { cmd } => match cmd {
            WidgetsCmd::List => CtlOp::WidgetsList,
            WidgetsCmd::Add {
                kind,
                monitor,
                x,
                y,
                w,
                h,
            } => CtlOp::WidgetsAdd {
                kind,
                monitor,
                x,
                y,
                w,
                h,
            },
            WidgetsCmd::Remove { id } => CtlOp::WidgetsRemove { id },
            WidgetsCmd::Move {
                id,
                monitor,
                x,
                y,
                w,
                h,
            } => CtlOp::WidgetsMove {
                id,
                monitor,
                x,
                y,
                w,
                h,
            },
            WidgetsCmd::Toggle { id } => CtlOp::WidgetsToggle { id },
        },
        CtlCmd::Profile { cmd } => match cmd {
            ProfileCmd::List => CtlOp::ProfileList,
            ProfileCmd::Use { id } => CtlOp::ProfileUse { id },
            ProfileCmd::Save { id, name } => CtlOp::ProfileSave {
                name: name.unwrap_or_else(|| id.clone()),
                id,
            },
            ProfileCmd::Delete { id } => CtlOp::ProfileDelete { id },
        },
        CtlCmd::Theme { id } => CtlOp::Theme { id },
        CtlCmd::Look { look } => CtlOp::Look { look },
        CtlCmd::Var {
            cmd: VarCmd::Set { name, value },
        } => CtlOp::VarSet {
            name,
            raw_value: value,
        },
        CtlCmd::Action { widget_id, action } => CtlOp::Action { widget_id, action },
        CtlCmd::Peek { monitor } => CtlOp::Peek { monitor },
        CtlCmd::Edit => CtlOp::Edit,
        CtlCmd::Export { .. } => CtlOp::Export,
        CtlCmd::Import { file } => match std::fs::read_to_string(&file) {
            Ok(json) => CtlOp::Import { json },
            Err(error) => {
                eprintln!("opaline ctl: could not read {}: {error}", file.display());
                return ExitCode::FAILURE;
            }
        },
        CtlCmd::Automation { cmd } => match cmd {
            AutomationCmd::Status => CtlOp::AutomationStatus,
            AutomationCmd::Resume => CtlOp::AutomationResume,
        },
        CtlCmd::Completions { .. } => return ExitCode::SUCCESS,
    };

    let Some(rt) = crate::runtime::current_thread() else {
        return ExitCode::FAILURE;
    };
    match rt.block_on(ctl::execute(op)) {
        Ok(payload) => {
            if let Some(path) = export_out {
                if let Err(error) = std::fs::write(&path, &payload) {
                    eprintln!("opaline ctl: could not write {}: {error}", path.display());
                    return ExitCode::FAILURE;
                }
                if args.json {
                    println!(
                        "{}",
                        serde_json::json!({ "ok": true, "file": path.display().to_string() })
                    );
                } else {
                    println!("Exported backup to {}", path.display());
                }
            } else {
                println!("{}", ctl::format_output(&payload, args.json));
            }
            ExitCode::SUCCESS
        }
        Err(error) => {
            if args.json {
                println!("{}", serde_json::json!({ "ok": false, "error": error }));
            } else {
                eprintln!("opaline ctl: {error}");
            }
            ExitCode::FAILURE
        }
    }
}

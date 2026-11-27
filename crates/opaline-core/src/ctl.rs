//! `opaline ctl` client operations over session D-Bus (`io.github.ali_kenjo.Opaline1`)
//! and bash / zsh / fish completion scripts (PLAN-2 8.4, brief §10).

use serde_json::Value as Json;
use zbus::Connection;

use crate::app_service::OpalineProxy;

/// All `opaline ctl` commands routed over session D-Bus.
#[derive(Debug, Clone)]
pub enum CtlOp {
    Status,
    Get {
        path: String,
    },
    Set {
        path: String,
        raw_value: String,
    },
    WidgetsList,
    WidgetsAdd {
        kind: String,
        monitor: String,
        x: i32,
        y: i32,
        w: i32,
        h: i32,
    },
    WidgetsRemove {
        id: String,
    },
    WidgetsMove {
        id: String,
        monitor: String,
        x: i32,
        y: i32,
        w: i32,
        h: i32,
    },
    WidgetsToggle {
        id: String,
    },
    ProfileList,
    ProfileUse {
        id: String,
    },
    ProfileSave {
        id: String,
        name: String,
    },
    ProfileDelete {
        id: String,
    },
    Theme {
        id: Option<String>,
    },
    Look {
        look: Option<String>,
    },
    VarSet {
        name: String,
        raw_value: String,
    },
    Action {
        widget_id: String,
        action: String,
    },
    Peek {
        monitor: Option<String>,
    },
    Edit,
    Export,
    Import {
        json: String,
    },
    AutomationStatus,
    AutomationResume,
}

/// Parses a CLI value as JSON if valid, else wraps it as a JSON string (ergonomic for `ctl set`).
pub fn coerce_json_value(raw: &str) -> String {
    match serde_json::from_str::<Json>(raw) {
        Ok(_) => raw.to_owned(),
        Err(_) => serde_json::to_string(raw).unwrap_or_else(|_| "\"\"".into()),
    }
}

/// Executes one `opaline ctl` operation over the session D-Bus and returns a JSON payload string.
pub async fn execute(op: CtlOp) -> Result<String, String> {
    let conn = Connection::session()
        .await
        .map_err(|e| format!("could not connect to session D-Bus: {e}"))?;
    let proxy = OpalineProxy::new(&conn)
        .await
        .map_err(|e| format!("could not reach Opaline on D-Bus: {e}"))?;

    let map_err = |e: zbus::Error| format!("Opaline D-Bus call failed: {e}");

    match op {
        CtlOp::Status => proxy.get_status().await.map_err(map_err),
        CtlOp::Get { path } => proxy.get_setting(&path).await.map_err(map_err),
        CtlOp::Set { path, raw_value } => {
            let val = coerce_json_value(&raw_value);
            proxy.set_setting(&path, &val).await.map_err(map_err)
        }
        CtlOp::WidgetsList => proxy.list_widgets().await.map_err(map_err),
        CtlOp::WidgetsAdd {
            kind,
            monitor,
            x,
            y,
            w,
            h,
        } => proxy
            .add_widget(&kind, &monitor, x, y, w, h)
            .await
            .map_err(map_err),
        CtlOp::WidgetsRemove { id } => proxy.remove_widget(&id).await.map_err(map_err),
        CtlOp::WidgetsMove {
            id,
            monitor,
            x,
            y,
            w,
            h,
        } => proxy
            .move_widget(&id, &monitor, x, y, w, h)
            .await
            .map_err(map_err),
        CtlOp::WidgetsToggle { id } => proxy.toggle_widget(&id).await.map_err(map_err),
        CtlOp::ProfileList => proxy.list_profiles().await.map_err(map_err),
        CtlOp::ProfileUse { id } => proxy.set_profile(&id).await.map_err(map_err),
        CtlOp::ProfileSave { id, name } => proxy.save_profile(&id, &name).await.map_err(map_err),
        CtlOp::ProfileDelete { id } => proxy.delete_profile(&id).await.map_err(map_err),
        CtlOp::Theme { id: Some(id) } => proxy.set_theme(&id).await.map_err(map_err),
        CtlOp::Theme { id: None } => proxy.get_setting("theme").await.map_err(map_err),
        CtlOp::Look { look: Some(l) } => proxy.set_look(&l).await.map_err(map_err),
        CtlOp::Look { look: None } => proxy.get_setting("appearance.look").await.map_err(map_err),
        CtlOp::VarSet { name, raw_value } => {
            let val = coerce_json_value(&raw_value);
            proxy.set_variable(&name, &val).await.map_err(map_err)
        }
        CtlOp::Action { widget_id, action } => proxy
            .run_widget_action(&widget_id, &action)
            .await
            .map_err(map_err),
        CtlOp::Peek { monitor: Some(c) } => {
            proxy.peek_monitor(&c).await.map_err(map_err)?;
            Ok(serde_json::json!({ "ok": true, "monitor": c }).to_string())
        }
        CtlOp::Peek { monitor: None } => {
            proxy.peek().await.map_err(map_err)?;
            Ok(serde_json::json!({ "ok": true }).to_string())
        }
        CtlOp::Edit => {
            proxy.edit().await.map_err(map_err)?;
            Ok(serde_json::json!({ "ok": true }).to_string())
        }
        CtlOp::Export => proxy.export_backup().await.map_err(map_err),
        CtlOp::Import { json } => proxy.import_backup(&json).await.map_err(map_err),
        CtlOp::AutomationStatus => proxy.automation_status().await.map_err(map_err),
        CtlOp::AutomationResume => proxy.resume_automation().await.map_err(map_err),
    }
}

/// Formats a JSON payload for stdout (`--json` prints compact/pretty JSON; otherwise human text).
pub fn format_output(json_str: &str, as_json: bool) -> String {
    let Ok(val) = serde_json::from_str::<Json>(json_str) else {
        return json_str.to_owned();
    };
    if as_json {
        return serde_json::to_string_pretty(&val).unwrap_or_else(|_| json_str.to_owned());
    }
    match &val {
        Json::String(s) => s.clone(),
        Json::Number(n) => n.to_string(),
        Json::Bool(b) => b.to_string(),
        Json::Null => "null".into(),
        _ => serde_json::to_string_pretty(&val).unwrap_or_else(|_| json_str.to_owned()),
    }
}

/// Generates shell completion scripts for `bash`, `zsh`, or `fish`.
pub fn completion_script(shell: &str) -> Option<&'static str> {
    match shell {
        "bash" => Some(BASH_COMPLETION),
        "zsh" => Some(ZSH_COMPLETION),
        "fish" => Some(FISH_COMPLETION),
        _ => None,
    }
}

pub const BASH_COMPLETION: &str = r#"_opaline() {
  local cur prev words cword
  COMPREPLY=()
  cur="${COMP_WORDS[COMP_CWORD]}"
  prev="${COMP_WORDS[COMP_CWORD-1]}"

  if [[ ${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "ctl --peek --edit --settings --onboarding --safe-mode --diagnose --dump --quit --help --version" -- "${cur}") )
    return 0
  fi

  if [[ ${COMP_WORDS[1]} == "ctl" ]]; then
    if [[ ${COMP_CWORD} -eq 2 ]]; then
      COMPREPLY=( $(compgen -W "status get set widgets profile theme look var action peek edit export import automation completions" -- "${cur}") )
      return 0
    fi
    case "${COMP_WORDS[2]}" in
      widgets)
        COMPREPLY=( $(compgen -W "list add remove move toggle" -- "${cur}") ) ;;
      profile)
        COMPREPLY=( $(compgen -W "list use save delete" -- "${cur}") ) ;;
      look)
        COMPREPLY=( $(compgen -W "glass clear tinted dark light dimmed" -- "${cur}") ) ;;
      theme)
        COMPREPLY=( $(compgen -W "opaline crystal bloom instrument air terminal neon paper mono classic" -- "${cur}") ) ;;
      var)
        COMPREPLY=( $(compgen -W "set" -- "${cur}") ) ;;
      automation)
        COMPREPLY=( $(compgen -W "status resume" -- "${cur}") ) ;;
      completions)
        COMPREPLY=( $(compgen -W "bash zsh fish" -- "${cur}") ) ;;
    esac
  fi
}
complete -F _opaline opaline
"#;

pub const ZSH_COMPLETION: &str = r#"#compdef opaline

_opaline() {
  local -a cmds ctl_cmds
  cmds=(
    'ctl:Control a running Opaline instance over D-Bus'
    '--peek:Raise widgets above all windows'
    '--edit:Toggle Edit mode'
    '--settings:Open Settings'
    '--onboarding:Open Onboarding'
    '--safe-mode:Start without user CSS, custom sources, or plugins'
    '--diagnose:Print redacted system diagnostics JSON'
    '--dump:Dump live sensor topics as JSON'
    '--quit:Quit Opaline'
  )
  ctl_cmds=(
    'status:Show running status'
    'get:Get a setting by JSON path'
    'set:Set a setting by JSON path'
    'widgets:List, add, remove, move, or toggle widgets'
    'profile:List, activate, save, or delete profiles'
    'theme:Get or switch active theme'
    'look:Get or switch desktop look'
    'var:Set a variable topic'
    'action:Run a widget action'
    'peek:Peek all monitors or one monitor'
    'edit:Toggle Edit mode'
    'export:Export settings and layouts backup'
    'import:Import a backup JSON file'
    'automation:Inspect or resume automation rules'
    'completions:Print bash, zsh, or fish completion script'
  )
  if (( CURRENT == 2 )); then
    _describe 'command' cmds
  elif [[ $words[2] == ctl && CURRENT == 3 ]]; then
    _describe 'ctl command' ctl_cmds
  elif [[ $words[2] == ctl && $words[3] == look ]]; then
    compadd glass clear tinted dark light dimmed
  elif [[ $words[2] == ctl && $words[3] == theme ]]; then
    compadd opaline crystal bloom instrument air terminal neon paper mono classic
  elif [[ $words[2] == ctl && $words[3] == widgets ]]; then
    compadd list add remove move toggle
  elif [[ $words[2] == ctl && $words[3] == profile ]]; then
    compadd list use save delete
  elif [[ $words[2] == ctl && $words[3] == automation ]]; then
    compadd status resume
  elif [[ $words[2] == ctl && $words[3] == completions ]]; then
    compadd bash zsh fish
  fi
}

_opaline "$@"
"#;

pub const FISH_COMPLETION: &str = r#"complete -c opaline -n "__fish_use_subcommand" -a ctl -d "Control a running Opaline instance"
complete -c opaline -n "__fish_use_subcommand" -l peek -d "Peek at the widgets"
complete -c opaline -n "__fish_use_subcommand" -l edit -d "Toggle Edit mode"
complete -c opaline -n "__fish_use_subcommand" -l settings -d "Open Settings"
complete -c opaline -n "__fish_use_subcommand" -l safe-mode -d "Start in safe mode"
complete -c opaline -n "__fish_use_subcommand" -l diagnose -d "Print redacted diagnostics"
complete -c opaline -n "__fish_use_subcommand" -l quit -d "Quit Opaline"

set -l ctl_sub "status get set widgets profile theme look var action peek edit export import automation completions"
complete -c opaline -n "__fish_seen_subcommand_from ctl; and not __fish_seen_subcommand_from $ctl_sub" -a "$ctl_sub"
complete -c opaline -n "__fish_seen_subcommand_from widgets" -a "list add remove move toggle"
complete -c opaline -n "__fish_seen_subcommand_from profile" -a "list use save delete"
complete -c opaline -n "__fish_seen_subcommand_from look" -a "glass clear tinted dark light dimmed"
complete -c opaline -n "__fish_seen_subcommand_from theme" -a "opaline crystal bloom instrument air terminal neon paper mono classic"
complete -c opaline -n "__fish_seen_subcommand_from automation" -a "status resume"
complete -c opaline -n "__fish_seen_subcommand_from completions" -a "bash zsh fish"
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coerces_json_and_bare_strings() {
        assert_eq!(coerce_json_value("true"), "true");
        assert_eq!(coerce_json_value("42"), "42");
        assert_eq!(coerce_json_value("clear"), "\"clear\"");
        assert_eq!(coerce_json_value(r#"{"a":1}"#), r#"{"a":1}"#);
    }

    #[test]
    fn generates_all_three_shell_completions() {
        assert!(completion_script("bash").is_some_and(|s| s.contains("complete -F _opaline")));
        assert!(completion_script("zsh").is_some_and(|s| s.contains("#compdef opaline")));
        assert!(completion_script("fish").is_some_and(|s| s.contains("complete -c opaline")));
        assert!(completion_script("csh").is_none());
    }
}

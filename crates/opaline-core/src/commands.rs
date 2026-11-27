//! Executes commands from the layer (End task, Docker, media, eject, power mode). Each one is
//! validated by the provider that owns the thing it acts on (ARCHITECTURE §3.7).

use std::sync::Arc;

use opaline_ipc::{Command, CommandResult, Value};

use crate::hub::Hub;

use crate::providers::media::{self, MediaAction};
use crate::providers::udisks::{self, DriveAction};
use crate::providers::upower;

pub async fn execute(hub: &Arc<Hub>, command: Command) -> CommandResult {
    tracing::info!(?command, "command");
    let result: Result<Option<Value>, String> = match command {
        Command::UpdateSettings { patch } => {
            crate::store::update(hub, crate::json::patch_to_json(&patch))
                .await
                .map(|()| None)
        }
        Command::UpdateLayouts { layouts } => {
            crate::layouts::update(hub, crate::json::patch_to_json(&layouts))
                .await
                .map(|()| None)
        }
        Command::History { series, seconds } => {
            let shared = hub.history();
            let result = tokio::task::spawn_blocking(move || {
                let in_mem = shared
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .query(&series, seconds);
                let (step_s, values) = if seconds > 86_400 {
                    crate::history::query_rollup(&series, seconds)
                        .ok()
                        .filter(|(_, v)| !v.is_empty())
                        .or(in_mem)
                        .unwrap_or((60, Vec::new()))
                } else {
                    in_mem.unwrap_or((1, Vec::new()))
                };
                Value::map([
                    ("stepS", Value::Num(step_s as f64)),
                    (
                        "values",
                        Value::Nums(values.into_iter().map(f64::from).collect()),
                    ),
                ])
            })
            .await
            .map_err(|e| e.to_string());
            result.map(Some)
        }
        Command::GeocodeSearch { query, language } => {
            crate::providers::weather::geocode(&query, &language)
                .await
                .map(Some)
        }
        Command::ListFonts => crate::fonts::list().await.map(Some),
        Command::SetRaised { raised } => {
            crate::desktop::set_raised(hub, raised).await.map(|()| None)
        }
        Command::ReleaseFocus => crate::desktop::release_focus(hub).await.map(|()| None),
        Command::OpenSettings => {
            hub.request(crate::app_service::AppRequest::OpenSettings);
            Ok(None)
        }
        Command::RunSourceNow { id } => match hub.sources() {
            Some(mgr) => mgr.run_now(&id, hub).await.map(Some),
            None => Err("sources-unavailable".into()),
        },
        Command::SetVariable { name, value } => match hub.sources() {
            Some(mgr) => {
                let json = crate::json::to_json(&value);
                mgr.set_variable(&name, json, hub).map(|()| None)
            }
            None => Err("sources-unavailable".into()),
        },
        Command::SaveCustomWidget { widget } => match hub.sources() {
            Some(mgr) => {
                let json = crate::json::to_json(&widget);
                match serde_json::from_value::<crate::sources::CustomWidgetPackage>(json) {
                    Ok(pkg) => mgr.save_custom_widget(pkg, hub).map(|()| None),
                    Err(e) => Err(format!("invalid-custom-widget: {e}")),
                }
            }
            None => Err("sources-unavailable".into()),
        },
        Command::DeleteCustomWidget { id } => match hub.sources() {
            Some(mgr) => mgr.delete_custom_widget(&id, hub).map(|()| None),
            None => Err("sources-unavailable".into()),
        },
        Command::ControlToggle { control, enabled } => {
            crate::providers::controls::set_toggle(hub, &control, enabled)
                .await
                .map(|()| None)
        }
        Command::ControlSetSlider {
            control,
            percent,
            target,
        } => crate::providers::controls::set_slider(hub, &control, percent, target.as_deref())
            .await
            .map(|()| None),
        Command::LaunchTarget { kind, target } => {
            crate::providers::controls::launch_target(&kind, &target)
                .await
                .map(|()| None)
        }
        Command::NoteSave {
            id,
            body,
            expected_sha256,
        } => crate::providers::notes::save_note(hub, &id, &body, expected_sha256.as_deref())
            .map(|()| None),
        Command::NoteToggleCheckbox { id, line } => {
            crate::providers::notes::toggle_checkbox(hub, &id, line).map(|()| None)
        }
        Command::TodoAdd {
            text,
            priority,
            due,
        } => crate::providers::todos::add_todo(hub, &text, priority.as_deref(), due.as_deref())
            .map(|()| None),
        Command::TodoToggle { index } => {
            crate::providers::todos::toggle_todo(hub, index).map(|()| None)
        }
        Command::TodoDelete { index } => {
            crate::providers::todos::delete_todo(hub, index).map(|()| None)
        }
        Command::TimerAction {
            action,
            id,
            label,
            duration_s,
            kind,
        } => crate::providers::timers::apply_action(
            hub,
            &action,
            &id,
            label.as_deref(),
            duration_s,
            kind.as_deref(),
        )
        .map(|()| None),
        Command::HaToggleEntity {
            base_url,
            entity_id,
            secret_name,
            allow_local_http,
        } => crate::providers::integrations::ha_toggle_entity(
            &base_url,
            &entity_id,
            &secret_name,
            allow_local_http,
        )
        .await
        .map(|()| None),
        Command::N8nSetWorkflowActive {
            base_url,
            workflow_id,
            active,
            secret_name,
            allow_local_http,
        } => crate::providers::integrations::n8n_set_workflow_active(
            &base_url,
            &workflow_id,
            active,
            &secret_name,
            allow_local_http,
        )
        .await
        .map(|()| None),
        Command::FetchFeed { url } => crate::providers::integrations::fetch_feed(&url)
            .await
            .map(Some),
        other => run(other).await.map(|()| None),
    };
    match result {
        Ok(None) => CommandResult::Ok,
        Ok(Some(value)) => CommandResult::Data { value },
        Err(reason) => {
            tracing::warn!(%reason, "command failed");
            CommandResult::Err { reason }
        }
    }
}

async fn run(command: Command) -> Result<(), String> {
    match command {
        Command::DriveEject { drive } => udisks::drive_action(&drive, DriveAction::Eject).await,
        Command::DrivePowerOff { drive } => {
            udisks::drive_action(&drive, DriveAction::PowerOff).await
        }
        Command::SetPowerProfile { profile } => upower::set_profile(&profile).await,
        Command::Media { player, action } => {
            let action = match action {
                opaline_ipc::MediaAction::Play => MediaAction::Play,
                opaline_ipc::MediaAction::Pause => MediaAction::Pause,
                opaline_ipc::MediaAction::PlayPause => MediaAction::PlayPause,
                opaline_ipc::MediaAction::Next => MediaAction::Next,
                opaline_ipc::MediaAction::Previous => MediaAction::Previous,
            };
            media::control(&player, action).await
        }
        Command::MediaSeek {
            player,
            position_us,
        } => media::set_position(&player, position_us).await,
        Command::MediaShuffle { player, shuffle } => media::set_shuffle(&player, shuffle).await,
        Command::MediaLoop { player, status } => media::set_loop_status(&player, &status).await,
        Command::MediaVolume { player, volume } => media::set_volume(&player, volume).await,
        Command::EndTask { pid, start, force } => {
            crate::providers::processes::signal(pid, start, force)
        }
        Command::Container { id, action } => {
            use crate::providers::docker::{self, ContainerAction as A};
            let action = match action {
                opaline_ipc::ContainerAction::Start => A::Start,
                opaline_ipc::ContainerAction::Stop => A::Stop,
                opaline_ipc::ContainerAction::Restart => A::Restart,
            };
            docker::container_action(&id, action).await
        }
        Command::StartDockerDesktop => crate::providers::docker::start_desktop().await,
        Command::UpdateSettings { .. }
        | Command::UpdateLayouts { .. }
        | Command::GeocodeSearch { .. }
        | Command::History { .. }
        | Command::ListFonts
        | Command::SetRaised { .. }
        | Command::ReleaseFocus
        | Command::OpenSettings
        | Command::RunSourceNow { .. }
        | Command::SetVariable { .. }
        | Command::SaveCustomWidget { .. }
        | Command::DeleteCustomWidget { .. }
        | Command::ControlToggle { .. }
        | Command::ControlSetSlider { .. }
        | Command::LaunchTarget { .. }
        | Command::NoteSave { .. }
        | Command::NoteToggleCheckbox { .. }
        | Command::TodoAdd { .. }
        | Command::TodoToggle { .. }
        | Command::TodoDelete { .. }
        | Command::TimerAction { .. }
        | Command::HaToggleEntity { .. }
        | Command::N8nSetWorkflowActive { .. }
        | Command::FetchFeed { .. } => Err("handled-above".into()),
    }
}

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
        | Command::SetRaised { .. } => Err("handled-above".into()),
    }
}

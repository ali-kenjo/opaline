//! Executes commands from the layer (End task, Docker, media, eject, power mode). Each one is
//! validated by the provider that owns the thing it acts on (ARCHITECTURE §3.7).

use opaline_ipc::{Command, CommandResult};

use crate::providers::udisks::{self, DriveAction};
use crate::providers::upower;

pub async fn execute(command: Command) -> CommandResult {
    tracing::info!(?command, "command");
    let result = match command {
        Command::DriveEject { drive } => udisks::drive_action(&drive, DriveAction::Eject).await,
        Command::DrivePowerOff { drive } => {
            udisks::drive_action(&drive, DriveAction::PowerOff).await
        }
        Command::SetPowerProfile { profile } => upower::set_profile(&profile).await,
    };
    match result {
        Ok(()) => CommandResult::Ok,
        Err(reason) => {
            tracing::warn!(%reason, "command failed");
            CommandResult::Err { reason }
        }
    }
}

//! Every sensor provider (brief §6, docs/SENSORS.md).

pub mod audio;
pub mod calendar;
pub mod cpu;
pub mod desktop_settings;
pub mod docker;
pub mod fans;
pub mod gpu;
pub mod hwmon;
pub mod latency;
pub mod media;
pub mod memory;
pub mod network;
pub mod nm;
pub mod processes;
pub mod props;
pub mod psi;
pub mod public_ip;
pub mod storage;
pub mod udisks;
pub mod upower;
pub mod usage;
pub mod wallpaper;
pub mod weather;

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use crate::engine::{Provider, supervise};
use crate::hub::Hub;
use crate::sysfs::Root;

/// The polled providers, in the order Diagnostics lists them.
pub fn polled() -> Vec<Box<dyn Provider>> {
    let root = Root::system();
    vec![
        Box::new(cpu::Cpu::new(root.clone())),
        Box::new(memory::Memory::new(root.clone())),
        Box::new(gpu::Gpu::new(root.clone())),
        Box::new(storage::Storage::new(root.clone())),
        Box::new(network::Network::new(root.clone())),
        Box::new(fans::Fans::new(&root)),
        Box::new(processes::Processes::new(root)),
    ]
}

/// Topics of the event-driven providers (for `--dump` and Diagnostics).
pub const ASYNC_TOPICS: &[&str] = &[
    udisks::HEALTH,
    nm::WIFI,
    nm::CONNECTIVITY,
    nm::VPN,
    nm::PRIMARY,
    latency::LATENCY,
    usage::USAGE,
    upower::BATTERY,
    upower::BATTERY_PERCENT,
    upower::AC,
    upower::PROFILE,
    upower::PERIPHERALS,
    desktop_settings::CLOCK,
    desktop_settings::APPEARANCE,
    desktop_settings::LOCKED,
    audio::STATE,
    media::PLAYER,
    media::PLAYERS,
    docker::STATE,
    docker::CONTAINERS,
    weather::CURRENT,
    weather::HOURLY,
    weather::DAILY,
    weather::AIR,
    public_ip::PUBLIC_IP,
    calendar::EVENTS,
    wallpaper::MONITORS,
    wallpaper::SOURCE,
];

type Task = Pin<Box<dyn Future<Output = ()> + Send>>;

/// Runs every event-driven provider under supervision until core shuts down.
pub async fn run_async(hub: Arc<Hub>) {
    macro_rules! task {
        ($id:literal, $run:path) => {{
            let hub2 = hub.clone();
            Box::pin(supervise(hub.clone(), $id, move || $run(hub2.clone()))) as Task
        }};
    }
    let tasks: Vec<Task> = vec![
        task!("udisks", udisks::run),
        task!("networkmanager", nm::run),
        task!("latency", latency::run),
        task!("data-usage", usage::run),
        task!("upower", upower::run),
        task!("desktop-settings", desktop_settings::run),
        task!("screen-lock", desktop_settings::track_lock),
        task!("audio", audio::run),
        task!("mpris", media::run),
        task!("docker", docker::run),
        task!("weather", weather::run),
        task!("public-ip", public_ip::run),
        task!("calendar", calendar::run),
        task!("wallpaper", wallpaper::run),
    ];
    futures_util::future::join_all(tasks).await;
}

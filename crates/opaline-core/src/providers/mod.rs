//! Every sensor provider (brief §6, docs/SENSORS.md).

pub mod cpu;
pub mod gpu;
pub mod hwmon;
pub mod latency;
pub mod memory;
pub mod network;
pub mod nm;
pub mod props;
pub mod psi;
pub mod storage;
pub mod udisks;
pub mod usage;

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
        Box::new(network::Network::new(root)),
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
    ];
    futures_util::future::join_all(tasks).await;
}

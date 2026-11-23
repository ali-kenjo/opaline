//! Every sensor provider (brief §6, docs/SENSORS.md).

pub mod cpu;
pub mod gpu;
pub mod hwmon;
pub mod memory;
pub mod psi;

use crate::engine::Provider;
use crate::sysfs::Root;

/// The polled providers, in the order Diagnostics lists them.
pub fn polled() -> Vec<Box<dyn Provider>> {
    let root = Root::system();
    vec![
        Box::new(cpu::Cpu::new(root.clone())),
        Box::new(memory::Memory::new(root.clone())),
        Box::new(gpu::Gpu::new(root)),
    ]
}

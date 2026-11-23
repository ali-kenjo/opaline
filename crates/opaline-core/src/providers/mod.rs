//! Every sensor provider (brief §6, docs/SENSORS.md).

pub mod loadavg;

use crate::engine::Provider;

/// The polled providers, in the order Diagnostics lists them.
pub fn polled() -> Vec<Box<dyn Provider>> {
    vec![Box::new(loadavg::LoadAvg)]
}

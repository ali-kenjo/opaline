//! Provider health and cost, as shown in `--diagnose` and Settings → Diagnostics.

use std::time::Duration;

use serde::Serialize;

use super::Cost;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum Health {
    /// Not sampled yet (nobody subscribed).
    Idle,
    Ok,
    /// The last sample failed or panicked; retried after a backoff.
    Failed {
        error: String,
        failures: u32,
        retry_in_ms: u64,
    },
    /// A sample has been running for longer than the tick allows; the provider is skipped
    /// until it returns.
    Stuck {
        running_ms: u64,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ProviderStatus {
    pub health: Health,
    pub cost: Option<Cost>,
    /// Exponential moving average of the time one sample takes, in microseconds.
    pub sample_us: Option<u64>,
    pub samples: u64,
}

impl ProviderStatus {
    pub fn new(cost: Option<Cost>) -> Self {
        Self {
            health: Health::Idle,
            cost,
            sample_us: None,
            samples: 0,
        }
    }

    /// Records a successful sample that took `took`.
    pub fn record(&mut self, took: Duration) {
        let us = u64::try_from(took.as_micros()).unwrap_or(u64::MAX);
        // EMA with α = 1/8: smooth, but a provider that gets slower shows it within seconds.
        self.sample_us = Some(match self.sample_us {
            Some(avg) => avg - avg / 8 + us / 8,
            None => us,
        });
        self.samples += 1;
        self.health = Health::Ok;
    }
}

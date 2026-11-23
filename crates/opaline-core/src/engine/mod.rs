//! The sensor engine: providers, the sampler that drives them, and supervision of the
//! event-driven ones (ARCHITECTURE §3.2–3.3).

mod provider;
mod sampler;
mod status;
mod supervise;

pub use provider::{Cost, Probe, Provider, ProviderError, SampleCx, TopicDesc, update};
pub use sampler::{Sampler, interval_for};
pub use status::{Health, ProviderStatus};
pub use supervise::supervise;

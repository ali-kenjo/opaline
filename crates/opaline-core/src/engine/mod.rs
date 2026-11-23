//! The sensor engine: providers, the sampler that drives them, and supervision of the
//! event-driven ones (ARCHITECTURE §3.2–3.3).

mod provider;
mod sampler;
mod status;
mod supervise;
mod watch;

pub use provider::{Cost, Probe, Provider, ProviderError, SampleCx, TopicDesc, update};
pub use sampler::{RELEASE_AFTER, Sampler, interval_for};
pub use status::{Health, ProviderStatus};
pub use supervise::supervise;
pub use watch::while_subscribed;

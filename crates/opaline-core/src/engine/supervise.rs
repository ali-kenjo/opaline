//! Supervision for event-driven providers (D-Bus, PipeWire, Docker): each runs as a task that
//! is restarted with backoff when it fails or panics.

use std::future::Future;
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::{Health, ProviderStatus};
use crate::hub::Hub;

const MIN_BACKOFF: Duration = Duration::from_secs(5);
const MAX_BACKOFF: Duration = Duration::from_secs(300);
/// A run that lasted this long resets the backoff.
const HEALTHY_RUN: Duration = Duration::from_secs(120);

/// Runs `make()` until it returns `Ok(())`. An `Err` or a panic is logged, recorded in the
/// provider's status and retried after 5 s, doubling up to 5 min.
pub async fn supervise<F, Fut>(hub: Arc<Hub>, id: &'static str, mut make: F)
where
    F: FnMut() -> Fut + Send + 'static,
    Fut: Future<Output = Result<(), String>> + Send + 'static,
{
    let mut backoff = MIN_BACKOFF;
    let mut failures = 0u32;
    loop {
        hub.set_provider_status(id, running(None));
        let started = Instant::now();
        let error = match tokio::spawn(make()).await {
            Ok(Ok(())) => return,
            Ok(Err(error)) => error,
            Err(join) if join.is_panic() => format!("panicked: {}", panic_text(join.into_panic())),
            Err(_) => return, // cancelled: core is shutting down
        };
        if started.elapsed() >= HEALTHY_RUN {
            backoff = MIN_BACKOFF;
            failures = 0;
        }
        failures = failures.saturating_add(1);
        tracing::warn!(provider = id, %error, ?backoff, "provider failed; restarting");
        hub.set_provider_status(
            id,
            ProviderStatus {
                health: Health::Failed {
                    error,
                    failures,
                    retry_in_ms: u64::try_from(backoff.as_millis()).unwrap_or(u64::MAX),
                },
                ..running(None)
            },
        );
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(MAX_BACKOFF);
    }
}

fn running(cost: Option<super::Cost>) -> ProviderStatus {
    ProviderStatus {
        health: Health::Ok,
        ..ProviderStatus::new(cost)
    }
}

pub(super) fn panic_text(payload: Box<dyn std::any::Any + Send>) -> String {
    payload
        .downcast_ref::<&str>()
        .map(|s| (*s).to_owned())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "unknown panic".to_owned())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::panic)]

    use std::sync::atomic::{AtomicU32, Ordering};

    use opaline_ipc::BackendKind;

    use super::*;

    #[tokio::test(start_paused = true)]
    async fn a_panicking_provider_is_restarted_and_reported() {
        let hub = Hub::new(BackendKind::Instant, Vec::new());
        let runs = Arc::new(AtomicU32::new(0));
        let counter = runs.clone();
        let task = tokio::spawn(supervise(hub.clone(), "flaky", move || {
            let n = counter.fetch_add(1, Ordering::SeqCst);
            async move {
                if n == 0 {
                    panic!("boom");
                }
                Ok(())
            }
        }));
        tokio::time::sleep(Duration::from_secs(1)).await;
        let status = hub.provider_statuses().remove("flaky").unwrap();
        assert!(matches!(status.health, Health::Failed { failures: 1, .. }));
        task.await.unwrap();
        assert_eq!(runs.load(Ordering::SeqCst), 2);
    }
}

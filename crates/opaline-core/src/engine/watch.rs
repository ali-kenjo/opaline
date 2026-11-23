//! A loop for event-driven and slow async providers: fetch while someone is subscribed.

use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use opaline_ipc::TopicUpdate;
use tokio::sync::Notify;

use crate::hub::Hub;

/// Calls `fetch` whenever one of `topics` has a subscriber: at once, then every `period`, and
/// again when the subscriptions change. Sleeps without wake-ups while none of them is wanted.
/// Returns an error (for the supervisor) if `fetch` fails.
pub async fn while_subscribed<F, Fut>(
    hub: &Arc<Hub>,
    topics: &[&str],
    period: Duration,
    fetch: F,
) -> Result<(), String>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<Vec<TopicUpdate>, String>>,
{
    while_subscribed_notified(hub, topics, period, &Notify::new(), fetch).await
}

/// Like [`while_subscribed`], but also fetches when `wake` is notified (a D-Bus signal said
/// something changed), so event-driven sources don't need a short period.
pub async fn while_subscribed_notified<F, Fut>(
    hub: &Arc<Hub>,
    topics: &[&str],
    period: Duration,
    wake: &Notify,
    mut fetch: F,
) -> Result<(), String>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<Vec<TopicUpdate>, String>>,
{
    let mut changes = hub.watch_subscriptions();
    loop {
        changes.mark_unchanged();
        if !topics.iter().any(|t| hub.is_subscribed(t)) {
            changes
                .changed()
                .await
                .map_err(|_| "hub closed".to_owned())?;
            continue;
        }
        let wanted: Vec<String> = topics
            .iter()
            .filter(|t| hub.is_subscribed(t))
            .map(|t| (*t).to_owned())
            .collect();
        let updates = fetch().await?;
        hub.publish(
            updates
                .into_iter()
                .filter(|u| wanted.iter().any(|w| w == u.topic.as_str()))
                .collect(),
        );
        tokio::select! {
            () = tokio::time::sleep(period) => {}
            () = wake.notified() => {}
            changed = changes.changed() => {
                changed.map_err(|_| "hub closed".to_owned())?;
            }
        }
    }
}

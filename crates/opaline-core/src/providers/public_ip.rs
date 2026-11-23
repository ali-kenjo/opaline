//! Public IP address: opt-in (off by default, brief §2.8), cached for 10 minutes.

use std::sync::Arc;
use std::time::Duration;

use opaline_ipc::Value;

use crate::engine::update;
use crate::hub::Hub;

pub const PUBLIC_IP: &str = "network.publicIp";
const CACHE_FOR: Duration = Duration::from_secs(600);
/// ipify: no account, a plain JSON answer. Only contacted when the user turned this on.
const SERVICE: &str = "https://api.ipify.org?format=json";

pub fn parse(json: &serde_json::Value) -> Option<String> {
    let ip = json.get("ip")?.as_str()?;
    ip.parse::<std::net::IpAddr>().ok().map(|a| a.to_string())
}

pub async fn run(hub: Arc<Hub>) -> Result<(), String> {
    let mut subs = hub.watch_subscriptions();
    let mut settings = hub.watch_settings();
    loop {
        subs.mark_unchanged();
        settings.mark_unchanged();
        let wanted = hub.is_subscribed(PUBLIC_IP);
        if wanted {
            let value = if hub.settings().network.public_ip {
                match crate::http::get_json(SERVICE)
                    .await
                    .ok()
                    .as_ref()
                    .and_then(parse)
                {
                    Some(ip) => {
                        Value::map([("ip", Value::from(ip)), ("source", Value::from("ipify"))])
                    }
                    None => Value::unavailable("offline"),
                }
            } else {
                Value::unavailable("disabled-in-settings")
            };
            hub.publish(vec![update(PUBLIC_IP, value)]);
        }
        tokio::select! {
            () = tokio::time::sleep(CACHE_FOR), if wanted => {}
            c = subs.changed() => c.map_err(|_| "hub closed".to_owned())?,
            c = settings.changed() => c.map_err(|_| "hub closed".to_owned())?,
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn parses_only_addresses() {
        assert_eq!(
            parse(&json!({"ip": "203.0.113.7"})),
            Some("203.0.113.7".into())
        );
        assert_eq!(
            parse(&json!({"ip": "2001:db8::1"})),
            Some("2001:db8::1".into())
        );
        assert_eq!(parse(&json!({"ip": "<script>"})), None);
    }
}

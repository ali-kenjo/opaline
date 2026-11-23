//! Peek and Edit shortcuts in Instant mode through the GlobalShortcuts portal (GNOME 48+),
//! held by core (brief §5.2). In Native mode the shell helper registers them instead, so the
//! portal session lives only while the backend is Instant. No X11 key grabs.

use std::collections::HashMap;
use std::sync::Arc;

use futures_util::StreamExt;
use opaline_ipc::BackendKind;
use tokio::sync::mpsc;
use zbus::{Connection, MatchRule, MessageStream, OwnedVariant, Variant};

use crate::app_service::AppRequest;
use crate::hub::Hub;

const PORTAL: &str = "org.freedesktop.portal.Desktop";
const PORTAL_PATH: &str = "/org/freedesktop/portal/desktop";
const IFACE: &str = "org.freedesktop.portal.GlobalShortcuts";

/// Our shortcuts: id, description, preferred trigger in the XDG shortcuts format (modifiers
/// CTRL, ALT, SHIFT, NUM, LOGO; GNOME shows "Disabled" for anything else). The user can change
/// them in GNOME Settings.
pub const SHORTCUTS: [(&str, &str, &str); 2] = [
    ("peek", "Peek at the widgets", "LOGO+ALT+w"),
    ("edit", "Edit widgets", "LOGO+ALT+e"),
];

/// The request object path the portal will use for `token` (portal spec, "Request").
pub fn request_path(unique_name: &str, token: &str) -> String {
    let sender = unique_name.trim_start_matches(':').replace('.', "_");
    format!("/org/freedesktop/portal/desktop/request/{sender}/{token}")
}

fn token(kind: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.subsec_nanos());
    format!("opaline_{kind}_{nanos}")
}

/// Calls a portal method that answers through a Request object, and waits for its Response.
async fn request(
    conn: &Connection,
    method: &str,
    kind: &str,
    body: impl serde::Serialize + zbus::zvariant::DynamicType,
    handle_token: &str,
) -> Result<HashMap<String, OwnedVariant>, String> {
    let unique = conn.unique_name().ok_or("no unique bus name")?.to_string();
    let path = request_path(&unique, handle_token);
    let rule = MatchRule::builder()
        .msg_type(zbus::message::Type::Signal)
        .interface("org.freedesktop.portal.Request")
        .member("Response")
        .path(path.as_str())
        .build()
        .map_err(|e| e.to_string())?;
    let mut responses = MessageStream::for_match_rule(rule, conn, None)
        .await
        .map_err(|e| e.to_string())?;
    conn.call_method(Some(PORTAL), PORTAL_PATH, Some(IFACE), method, &body)
        .await
        .map_err(|e| format!("{method}: {e}"))?;
    // The user may answer GNOME's "Add Keyboard Shortcuts" dialog much later.
    let msg = tokio::time::timeout(std::time::Duration::from_secs(30 * 60), responses.next())
        .await
        .map_err(|_| format!("{method}: no answer"))?
        .ok_or("response stream ended")?
        .map_err(|e| e.to_string())?;
    let (code, results): (u32, HashMap<String, OwnedVariant>) =
        msg.body().deserialize().map_err(|e| e.to_string())?;
    if code != 0 {
        // 1 = the user cancelled (e.g. declined the shortcut dialog), 2 = other error.
        return Err(format!("{method} ({kind}) answered {code}"));
    }
    Ok(results)
}

fn session_handle(results: &HashMap<String, OwnedVariant>) -> Option<String> {
    let v = results.get("session_handle")?;
    String::try_from(v.clone()).ok().or_else(|| {
        zbus::OwnedObjectPath::try_from(v.clone())
            .ok()
            .map(|p| p.to_string())
    })
}

/// One portal session: create, bind, then forward activations until `stop` resolves.
async fn session(
    conn: &Connection,
    requests: &mpsc::UnboundedSender<AppRequest>,
    stop: impl std::future::Future<Output = ()>,
) -> Result<(), String> {
    // Tell the portal who we are (a host app has no sandbox app ID), so GNOME can remember the
    // user's answer and list the shortcuts under Opaline in Settings.
    let none: HashMap<&str, Variant<'_>> = HashMap::new();
    if let Err(error) = conn
        .call_method(
            Some(PORTAL),
            PORTAL_PATH,
            Some("org.freedesktop.host.portal.Registry"),
            "Register",
            &(crate::app_service::BUS_NAME, none),
        )
        .await
    {
        tracing::debug!(%error, "portal registry not available");
    }
    let create_token = token("create");
    let session_token = token("session");
    let opts: HashMap<&str, Variant<'_>> = HashMap::from([
        ("handle_token", Variant::from(create_token.as_str())),
        (
            "session_handle_token",
            Variant::from(session_token.as_str()),
        ),
    ]);
    let created = request(conn, "CreateSession", "create", (opts,), &create_token).await?;
    let handle = session_handle(&created).ok_or("no session handle")?;
    let session_path = zbus::ObjectPath::try_from(handle.as_str()).map_err(|e| e.to_string())?;

    let bind_token = token("bind");
    let shortcuts: Vec<(&str, HashMap<&str, Variant<'_>>)> = SHORTCUTS
        .iter()
        .map(|(id, description, trigger)| {
            (
                *id,
                HashMap::from([
                    ("description", Variant::from(*description)),
                    ("preferred_trigger", Variant::from(*trigger)),
                ]),
            )
        })
        .collect();
    let bind_opts: HashMap<&str, Variant<'_>> =
        HashMap::from([("handle_token", Variant::from(bind_token.as_str()))]);
    request(
        conn,
        "BindShortcuts",
        "bind",
        (&session_path, shortcuts, "", bind_opts),
        &bind_token,
    )
    .await?;
    tracing::info!("global shortcuts bound through the portal");

    let rule = MatchRule::builder()
        .msg_type(zbus::message::Type::Signal)
        .interface(IFACE)
        .member("Activated")
        .build()
        .map_err(|e| e.to_string())?;
    let mut activated = MessageStream::for_match_rule(rule, conn, None)
        .await
        .map_err(|e| e.to_string())?;
    tokio::pin!(stop);
    loop {
        tokio::select! {
            () = &mut stop => break,
            msg = activated.next() => {
                let Some(Ok(msg)) = msg else { break };
                let Ok((from, id, _ts, _opts)) = msg
                    .body()
                    .deserialize::<(zbus::OwnedObjectPath, String, u64, HashMap<String, OwnedVariant>)>()
                else {
                    continue;
                };
                if from.as_str() != handle {
                    continue;
                }
                let request = match id.as_str() {
                    "peek" => Some(AppRequest::Peek),
                    "edit" => Some(AppRequest::Edit),
                    _ => None,
                };
                if let Some(r) = request {
                    let _ = requests.send(r);
                }
            }
        }
    }
    // Close the session so the helper's keybindings can take over in Native mode.
    let _ = conn
        .call_method(
            Some(PORTAL),
            session_path.as_str(),
            Some("org.freedesktop.portal.Session"),
            "Close",
            &(),
        )
        .await;
    tracing::info!("global shortcuts released");
    Ok(())
}

/// Holds the portal shortcuts while the backend is Instant, for as long as core runs.
pub async fn run(conn: Connection, hub: Arc<Hub>, requests: mpsc::UnboundedSender<AppRequest>) {
    let mut backend = hub.watch_backend();
    loop {
        let current = *backend.borrow_and_update();
        if current == BackendKind::Instant {
            let mut watch = backend.clone();
            let stop = async move {
                let _ = watch.wait_for(|b| *b != BackendKind::Instant).await;
            };
            if let Err(error) = session(&conn, &requests, stop).await {
                // No portal, an old portal, or the user said no: the tray and the app grid
                // still offer Peek and Edit.
                tracing::warn!(%error, "global shortcuts unavailable");
                if backend
                    .wait_for(|b| *b != BackendKind::Instant)
                    .await
                    .is_err()
                {
                    return;
                }
            }
        } else if backend.changed().await.is_err() {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_paths_follow_the_portal_spec() {
        assert_eq!(
            request_path(":1.234", "opaline_create_5"),
            "/org/freedesktop/portal/desktop/request/1_234/opaline_create_5"
        );
    }
}

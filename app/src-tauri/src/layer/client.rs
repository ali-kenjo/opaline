//! IPC client: connects to core (retrying while core isn't up yet), keeps the windows in sync
//! with core's monitor list, and forwards data to the windows.

use std::sync::Arc;
use std::time::Duration;

use opaline_ipc::{
    ClientMsg, CoreEvent, FrameKind, Hello, PROTOCOL_VERSION, Role, ServerMsg, read_frame,
    write_message,
};
use tauri::AppHandle;
use tokio::net::UnixStream;
use tokio::sync::mpsc;

use super::bridge::{Bridge, ConnState, LayerEvent};
use super::windows;

const MIN_BACKOFF: Duration = Duration::from_millis(100);
const MAX_BACKOFF: Duration = Duration::from_secs(2);
/// After a protocol mismatch, core is a different version; retry slowly until it restarts.
const REJECTED_RETRY: Duration = Duration::from_secs(5);

pub async fn run(
    app: AppHandle,
    bridge: Arc<Bridge>,
    mut outgoing: mpsc::UnboundedReceiver<ClientMsg>,
) {
    let path = match opaline_ipc::paths::socket_path() {
        Ok(path) => path,
        Err(error) => {
            tracing::error!(%error, "no runtime directory; the layer can't reach core");
            bridge.set_connection(ConnState::Rejected("no-runtime-dir".into()));
            return;
        }
    };
    let mut attempt = 0u32;
    let mut backoff = MIN_BACKOFF;
    loop {
        attempt = attempt.saturating_add(1);
        bridge.set_connection(ConnState::Connecting(attempt));
        match UnixStream::connect(&path).await {
            Ok(stream) => {
                backoff = MIN_BACKOFF;
                match session(&app, &bridge, stream, &mut outgoing).await {
                    Ok(()) => tracing::info!("core closed the connection"),
                    Err(SessionError::Rejected(reason)) => {
                        tracing::warn!(reason, "core rejected the layer");
                        bridge.set_connection(ConnState::Rejected(reason));
                        tokio::time::sleep(REJECTED_RETRY).await;
                        continue;
                    }
                    Err(error) => tracing::warn!(%error, "IPC session ended"),
                }
            }
            Err(error) => tracing::debug!(%error, attempt, "core not reachable yet"),
        }
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(MAX_BACKOFF);
    }
}

#[derive(Debug, thiserror::Error)]
enum SessionError {
    #[error(transparent)]
    Ipc(#[from] opaline_ipc::IpcError),
    #[error("rejected: {0}")]
    Rejected(String),
    #[error("core did not answer with Welcome")]
    UnexpectedFirstMessage,
}

async fn session(
    app: &AppHandle,
    bridge: &Bridge,
    stream: UnixStream,
    outgoing: &mut mpsc::UnboundedReceiver<ClientMsg>,
) -> Result<(), SessionError> {
    let (mut reader, mut writer) = stream.into_split();
    let mut scratch = Vec::with_capacity(1024);
    let hello = ClientMsg::Hello(Hello {
        protocol: PROTOCOL_VERSION,
        role: Role::Layer,
        pid: std::process::id(),
        app_version: env!("CARGO_PKG_VERSION").to_owned(),
    });
    write_message(&mut writer, &hello, &mut scratch).await?;

    let welcome = match read_frame(&mut reader).await? {
        Some(frame) => frame.decode_message::<ServerMsg>()?,
        None => return Ok(()),
    };
    let welcome = match welcome {
        ServerMsg::Welcome(welcome) => welcome,
        ServerMsg::Rejected {
            reason,
            core_protocol,
        } => {
            return Err(SessionError::Rejected(format!(
                "{reason:?} (core protocol {core_protocol}, layer protocol {PROTOCOL_VERSION})"
            )));
        }
        _ => return Err(SessionError::UnexpectedFirstMessage),
    };
    tracing::info!(core = %welcome.core_version, backend = ?welcome.backend, monitors = welcome.monitors.len(), "connected to core");

    windows::sync(app, bridge, &welcome.monitors, welcome.backend);
    bridge.set_connection(ConnState::Connected {
        core_version: welcome.core_version,
        backend: welcome.backend,
    });

    // Anything queued while disconnected is stale; current subscriptions are replayed instead.
    while outgoing.try_recv().is_ok() {}
    for topic in bridge.topics() {
        let msg = ClientMsg::Subscribe {
            topic,
            class: opaline_ipc::ActivityClass::Interactive,
        };
        write_message(&mut writer, &msg, &mut scratch).await?;
    }

    // `read_frame` isn't cancel-safe, so reading runs on its own task.
    let (incoming_tx, mut incoming) = mpsc::channel(32);
    let reader_task = tokio::spawn(async move {
        loop {
            let frame = read_frame(&mut reader).await;
            let done = !matches!(frame, Ok(Some(_)));
            if incoming_tx.send(frame).await.is_err() || done {
                break;
            }
        }
    });

    let result = loop {
        tokio::select! {
            frame = incoming.recv() => match frame {
                None | Some(Ok(None)) => break Ok(()),
                Some(Err(error)) => break Err(error.into()),
                Some(Ok(Some(frame))) if frame.kind == FrameKind::Message => {
                    match frame.decode_message::<ServerMsg>() {
                        Ok(msg) => handle(app, bridge, msg, welcome.backend),
                        Err(error) => break Err(error.into()),
                    }
                }
                // Spectrum frames are routed to the visualizer in Phase 3.
                Some(Ok(Some(_))) => {}
            },
            msg = outgoing.recv() => match msg {
                Some(msg) => write_message(&mut writer, &msg, &mut scratch).await?,
                None => break Ok(()),
            },
        }
    };
    reader_task.abort();
    result
}

fn handle(app: &AppHandle, bridge: &Bridge, msg: ServerMsg, backend: opaline_ipc::BackendKind) {
    match msg {
        ServerMsg::Update(batch) => bridge.broadcast(&LayerEvent::Update {
            seq: batch.seq,
            at_ms: batch.at_ms,
            updates: batch.updates,
        }),
        ServerMsg::Event(event) => {
            if let CoreEvent::MonitorsChanged { monitors } = &event {
                windows::sync(app, bridge, monitors, backend);
            }
            bridge.broadcast(&LayerEvent::CoreEvent { event });
        }
        ServerMsg::Pong { .. } | ServerMsg::Welcome(_) | ServerMsg::Rejected { .. } => {}
    }
}

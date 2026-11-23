//! IPC server for layer clients (ARCHITECTURE §3.7).

use std::collections::HashMap;
use std::io;
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use opaline_ipc::{
    ActivityClass, ClientMsg, FrameKind, PROTOCOL_VERSION, RejectReason, ServerMsg, Topic, Welcome,
    read_frame, write_message,
};
use tokio::io::AsyncWrite;
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::{broadcast, mpsc};

use crate::hub::Hub;

const HELLO_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, thiserror::Error)]
pub enum BindError {
    #[error("another Opaline core is already listening on {0}")]
    AlreadyRunning(PathBuf),
    #[error("could not prepare the IPC socket: {0}")]
    Io(#[from] io::Error),
    #[error(transparent)]
    Ipc(#[from] opaline_ipc::IpcError),
}

/// Creates `$XDG_RUNTIME_DIR/opaline/` (`0700`) and binds `ipc.sock` (`0600`). A stale socket
/// left by a crashed core is removed; a live one is an error.
pub async fn bind_default() -> Result<UnixListener, BindError> {
    bind(&opaline_ipc::paths::socket_path()?).await
}

pub async fn bind(path: &Path) -> Result<UnixListener, BindError> {
    if let Some(dir) = path.parent() {
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(dir)?;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    }
    if path.exists() {
        if UnixStream::connect(path).await.is_ok() {
            return Err(BindError::AlreadyRunning(path.to_owned()));
        }
        std::fs::remove_file(path)?;
    }
    let listener = UnixListener::bind(path)?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    Ok(listener)
}

/// Accepts clients forever. Each client runs on its own task; a broken client never affects
/// the others or core.
pub async fn serve(hub: Arc<Hub>, listener: UnixListener) {
    let own_uid = rustix::process::getuid().as_raw();
    loop {
        let (stream, _) = match listener.accept().await {
            Ok(conn) => conn,
            Err(error) => {
                tracing::warn!(%error, "IPC accept failed");
                tokio::time::sleep(Duration::from_millis(200)).await;
                continue;
            }
        };
        match stream.peer_cred() {
            Ok(cred) if cred.uid() == own_uid => {}
            Ok(cred) => {
                tracing::warn!(uid = cred.uid(), "rejected IPC client from another user");
                continue;
            }
            Err(error) => {
                tracing::warn!(%error, "rejected IPC client without credentials");
                continue;
            }
        }
        let hub = hub.clone();
        tokio::spawn(async move {
            if let Err(error) = handle_client(hub, stream).await {
                tracing::info!(%error, "IPC client disconnected with an error");
            }
        });
    }
}

#[derive(Debug, thiserror::Error)]
enum ClientError {
    #[error(transparent)]
    Ipc(#[from] opaline_ipc::IpcError),
    #[error("no Hello within {HELLO_TIMEOUT:?}")]
    HelloTimeout,
    #[error("first message was not Hello")]
    HelloExpected,
    #[error("client speaks protocol {0}, core speaks {PROTOCOL_VERSION}")]
    ProtocolMismatch(u16),
}

/// The client's subscriptions; dropped with the client's task, however it ends.
struct Subscriptions {
    hub: Arc<Hub>,
    topics: HashMap<Topic, ActivityClass>,
}

impl Subscriptions {
    /// Subscribes, or changes the class of an existing subscription. Returns whether the topic
    /// is new for this client.
    fn set(&mut self, topic: Topic, class: ActivityClass) -> bool {
        match self.topics.insert(topic.clone(), class) {
            Some(old) if old == class => false,
            Some(old) => {
                self.hub.subscribe(&topic, class);
                self.hub.unsubscribe(&topic, old);
                false
            }
            None => {
                self.hub.subscribe(&topic, class);
                true
            }
        }
    }

    fn remove(&mut self, topic: &Topic) {
        if let Some(class) = self.topics.remove(topic) {
            self.hub.unsubscribe(topic, class);
        }
    }

    /// Covered and idle subscribers get history and alerts, but nothing is pushed to them
    /// (brief §5.4).
    fn pushes(&self, topic: &Topic) -> bool {
        !self.hub.locked()
            && !self.hub.all_covered()
            && self
                .topics
                .get(topic)
                .is_some_and(|class| *class >= ActivityClass::Ambient)
    }
}

impl Drop for Subscriptions {
    fn drop(&mut self) {
        for (topic, class) in &self.topics {
            self.hub.unsubscribe(topic, *class);
        }
    }
}

async fn send<W: AsyncWrite + Unpin>(
    w: &mut W,
    msg: &ServerMsg,
    scratch: &mut Vec<u8>,
) -> Result<(), ClientError> {
    Ok(write_message(w, msg, scratch).await?)
}

async fn handle_client(hub: Arc<Hub>, stream: UnixStream) -> Result<(), ClientError> {
    let (mut reader, mut writer) = stream.into_split();
    let mut scratch = Vec::with_capacity(4096);

    let first = tokio::time::timeout(HELLO_TIMEOUT, read_frame(&mut reader))
        .await
        .map_err(|_| ClientError::HelloTimeout)??;
    let hello = match first.map(|f| f.decode_message::<ClientMsg>()) {
        Some(Ok(ClientMsg::Hello(hello))) => hello,
        _ => {
            let reject = ServerMsg::Rejected {
                reason: RejectReason::HelloExpected,
                core_protocol: PROTOCOL_VERSION,
            };
            send(&mut writer, &reject, &mut scratch).await?;
            return Err(ClientError::HelloExpected);
        }
    };
    if hello.protocol != PROTOCOL_VERSION {
        let reject = ServerMsg::Rejected {
            reason: RejectReason::ProtocolMismatch,
            core_protocol: PROTOCOL_VERSION,
        };
        send(&mut writer, &reject, &mut scratch).await?;
        return Err(ClientError::ProtocolMismatch(hello.protocol));
    }
    tracing::info!(pid = hello.pid, role = ?hello.role, version = %hello.app_version, "IPC client connected");

    // Subscribe to the broadcasts before sending Welcome so nothing is missed in between.
    let mut updates = hub.updates();
    let mut events = hub.events();
    let mut spectrum = hub.spectrum();
    let welcome = ServerMsg::Welcome(Welcome {
        protocol: PROTOCOL_VERSION,
        core_version: env!("CARGO_PKG_VERSION").to_owned(),
        backend: hub.backend(),
        monitors: hub.monitors(),
    });
    send(&mut writer, &welcome, &mut scratch).await?;

    // `read_frame` isn't cancel-safe, so reading happens on its own task.
    let (incoming_tx, mut incoming) = mpsc::channel::<Result<ClientMsg, opaline_ipc::IpcError>>(32);
    let reader_task = tokio::spawn(async move {
        loop {
            let msg = match read_frame(&mut reader).await {
                Ok(Some(frame)) if frame.kind == FrameKind::Message => frame.decode_message(),
                Ok(Some(_)) => continue, // clients never send spectrum frames; ignore
                Ok(None) => break,
                Err(error) => Err(error),
            };
            let failed = msg.is_err();
            if incoming_tx.send(msg).await.is_err() || failed {
                break;
            }
        }
    });

    let mut subs = Subscriptions {
        hub: hub.clone(),
        topics: HashMap::new(),
    };
    // Commands run on their own tasks; their results come back through this channel.
    let (results_tx, mut results) = mpsc::channel::<(u32, opaline_ipc::CommandResult)>(16);
    let result = loop {
        tokio::select! {
            msg = incoming.recv() => match msg {
                None => break Ok(()),
                Some(Err(error)) => break Err(error.into()),
                Some(Ok(ClientMsg::Subscribe { topic, class })) => {
                    tracing::debug!(%topic, ?class, "subscribe");
                    let new = subs.set(topic.clone(), class);
                    // Give a new subscriber the current value at once instead of waiting a tick.
                    if new && subs.pushes(&topic)
                        && let Some(value) = hub.latest(&topic)
                    {
                        let msg = ServerMsg::Update(opaline_ipc::UpdateBatch {
                            seq: 0,
                            at_ms: crate::hub::now_ms(),
                            updates: vec![opaline_ipc::TopicUpdate { topic, value }],
                        });
                        send(&mut writer, &msg, &mut scratch).await?;
                    }
                }
                Some(Ok(ClientMsg::Unsubscribe { topic })) => subs.remove(&topic),
                Some(Ok(ClientMsg::Command { id, command })) => {
                    let tx = results_tx.clone();
                    let hub = hub.clone();
                    tokio::spawn(async move {
                        let result = crate::commands::execute(&hub, command).await;
                        let _ = tx.send((id, result)).await;
                    });
                }
                Some(Ok(ClientMsg::Ping { nonce })) => {
                    send(&mut writer, &ServerMsg::Pong { nonce }, &mut scratch).await?;
                }
                Some(Ok(ClientMsg::Hello(_))) => {
                    tracing::debug!("ignoring a repeated Hello");
                }
            },
            batch = updates.recv() => match batch {
                Ok(batch) => {
                    let wanted: Vec<_> = batch
                        .updates
                        .iter()
                        .filter(|u| subs.pushes(&u.topic))
                        .cloned()
                        .collect();
                    if !wanted.is_empty() {
                        let msg = ServerMsg::Update(opaline_ipc::UpdateBatch {
                            seq: batch.seq,
                            at_ms: batch.at_ms,
                            updates: wanted,
                        });
                        send(&mut writer, &msg, &mut scratch).await?;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    tracing::debug!(skipped, "client lagged; skipping to newest data");
                }
                Err(broadcast::error::RecvError::Closed) => break Ok(()),
            },
            frame = spectrum.recv() => match frame {
                Ok(frame) => {
                    if subs.pushes(&Topic::new(crate::providers::audio::SPECTRUM)) {
                        opaline_ipc::write_spectrum(&mut writer, &frame, &mut scratch).await?;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => break Ok(()),
            },
            Some((id, result)) = results.recv() => {
                send(&mut writer, &ServerMsg::CommandResult { id, result }, &mut scratch).await?;
            }
            event = events.recv() => match event {
                Ok(event) => send(&mut writer, &ServerMsg::Event(event), &mut scratch).await?,
                Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => break Ok(()),
            },
        }
    };
    reader_task.abort();
    result
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    use super::*;
    use opaline_ipc::{ActivityClass, BackendKind, CoreEvent, Hello, Role, TopicUpdate, Value};

    async fn start() -> (Arc<Hub>, PathBuf, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("opaline").join("ipc.sock");
        let listener = bind(&path).await.unwrap();
        let hub = Hub::new(BackendKind::Instant, Vec::new());
        tokio::spawn(serve(hub.clone(), listener));
        (hub, path, dir)
    }

    async fn recv(stream: &mut UnixStream) -> ServerMsg {
        tokio::time::timeout(Duration::from_secs(2), read_frame(stream))
            .await
            .expect("timed out")
            .unwrap()
            .unwrap()
            .decode_message()
            .unwrap()
    }

    async fn hello(stream: &mut UnixStream, protocol: u16) {
        let msg = ClientMsg::Hello(Hello {
            protocol,
            role: Role::Layer,
            pid: std::process::id(),
            app_version: "test".into(),
        });
        write_message(stream, &msg, &mut Vec::new()).await.unwrap();
    }

    #[tokio::test]
    async fn socket_and_directory_are_private() {
        let (_hub, path, _dir) = start().await;
        let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&path), 0o600);
        assert_eq!(mode(path.parent().unwrap()), 0o700);
    }

    #[tokio::test]
    async fn second_bind_is_refused_while_the_first_lives() {
        let (_hub, path, _dir) = start().await;
        assert!(matches!(
            bind(&path).await,
            Err(BindError::AlreadyRunning(_))
        ));
    }

    #[tokio::test]
    async fn stale_socket_is_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("opaline").join("ipc.sock");
        drop(bind(&path).await.unwrap());
        assert!(path.exists());
        bind(&path).await.unwrap();
    }

    #[tokio::test]
    async fn handshake_subscription_and_events() {
        let (hub, path, _dir) = start().await;
        let mut stream = UnixStream::connect(&path).await.unwrap();
        hello(&mut stream, PROTOCOL_VERSION).await;
        assert!(matches!(recv(&mut stream).await, ServerMsg::Welcome(_)));

        let topic = Topic::new("system.loadavg");
        let sub = ClientMsg::Subscribe {
            topic: topic.clone(),
            class: ActivityClass::Interactive,
        };
        write_message(&mut stream, &sub, &mut Vec::new())
            .await
            .unwrap();
        // Wait until the server has processed the subscription.
        for _ in 0..100 {
            if hub.is_subscribed("system.loadavg") {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(hub.is_subscribed("system.loadavg"));

        hub.publish(vec![
            TopicUpdate {
                topic: Topic::new("not.subscribed"),
                value: Value::Num(1.0),
            },
            TopicUpdate {
                topic: topic.clone(),
                value: Value::Nums(vec![0.1, 0.2, 0.3]),
            },
        ]);
        match recv(&mut stream).await {
            ServerMsg::Update(batch) => {
                assert_eq!(batch.updates.len(), 1);
                assert_eq!(batch.updates[0].topic, topic);
            }
            other => panic!("expected an update, got {other:?}"),
        }

        hub.emit(CoreEvent::EditRequested);
        assert_eq!(
            recv(&mut stream).await,
            ServerMsg::Event(CoreEvent::EditRequested)
        );

        drop(stream);
        for _ in 0..100 {
            if !hub.is_subscribed("system.loadavg") {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(
            !hub.is_subscribed("system.loadavg"),
            "disconnect must drop subscriptions"
        );
    }

    #[tokio::test]
    async fn protocol_mismatch_is_rejected_politely() {
        let (_hub, path, _dir) = start().await;
        let mut stream = UnixStream::connect(&path).await.unwrap();
        hello(&mut stream, PROTOCOL_VERSION + 1).await;
        assert_eq!(
            recv(&mut stream).await,
            ServerMsg::Rejected {
                reason: RejectReason::ProtocolMismatch,
                core_protocol: PROTOCOL_VERSION
            }
        );
    }

    #[tokio::test]
    async fn garbage_client_does_not_take_the_server_down() {
        let (_hub, path, _dir) = start().await;
        {
            use tokio::io::AsyncWriteExt;
            let mut bad = UnixStream::connect(&path).await.unwrap();
            bad.write_all(&[0xff, 0xff, 0xff, 0x7f, 1, 2, 3])
                .await
                .unwrap();
        }
        let mut good = UnixStream::connect(&path).await.unwrap();
        hello(&mut good, PROTOCOL_VERSION).await;
        assert!(matches!(recv(&mut good).await, ServerMsg::Welcome(_)));
    }
}
